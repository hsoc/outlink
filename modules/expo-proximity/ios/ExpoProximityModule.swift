import Compression
import CoreBluetooth
import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

private let maximumWireBytes = 128 * 1024
private let maximumIndicationsPerTurn = 16

private struct PendingWrite {
  let frames: [Data]
  var nextIndex: Int
}

public final class ExpoProximityModule: Module {
  private let serviceUUID = CBUUID(string: "F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C")
  private let mailboxUUID = CBUUID(string: "A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D")
  private let bluetoothQueue = DispatchQueue(label: "io.github.hsoc.outlink.proximity.bluetooth")
  private lazy var bluetoothDelegate = ExpoProximityBluetoothDelegate(owner: self)
  private var central: CBCentralManager?
  private var peripheralManager: CBPeripheralManager?
  private var mailboxCharacteristic: CBMutableCharacteristic?
  private var peripherals: [String: CBPeripheral] = [:]
  private var serviceDiscoveryEndpoints = Set<String>()
  private var mailboxByEndpoint: [String: CBCharacteristic] = [:]
  private var subscribedCentrals: [String: CBCentral] = [:]
  private var rssiByEndpoint: [String: Int] = [:]
  private var signalEmittedAtByEndpoint: [String: TimeInterval] = [:]
  private var pendingWrites: [String: PendingWrite] = [:]
  private var writeResolvers: [String: () -> Void] = [:]
  private var writeRejecters: [String: (Error) -> Void] = [:]
  private var connectionGenerations: [String: UInt64] = [:]
  private var activeConnectionEndpoints = Set<String>()
  private var pendingScanDurationMs: Int?
  private var scanIsContinuous = false
  private var scanGeneration = 0
  private var advertisingRequested = false

  private func discoverPeerServices(_ peripheral: CBPeripheral) {
    guard serviceDiscoveryEndpoints.insert(peripheral.identifier.uuidString).inserted else { return }
    peripheral.discoverServices([serviceUUID])
  }

  private func trace(_ message: @autoclosure () -> String) {
    #if DEBUG
    print("[nearby-native] \(message())")
    #endif
  }

  public func definition() -> ModuleDefinition {
    Name("ExpoProximity")
    AsyncFunction("copyTextAsync") { (text: String, promise: Promise) in
      DispatchQueue.main.async {
        UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: text]], options: [.localOnly: true])
        promise.resolve(nil)
      }
    }
    Events("onPeer", "onSignal", "onMessage", "onConnection", "onBluetoothState")

    AsyncFunction("configureProtocolAsync") { (mode: String, promise: Promise) in
      self.bluetoothQueue.async {
        guard mode == "bitchat", !self.advertisingRequested,
          self.activeConnectionEndpoints.isEmpty else {
          promise.reject("ERR_PROXIMITY_MODE", "Stop Bluetooth before changing protocol."); return
        }
        promise.resolve()
      }
    }
    AsyncFunction("maximumFrameSizeAsync") { (endpoint: String, promise: Promise) in
      self.bluetoothQueue.async {
        if endpoint.hasPrefix("c:"), let peer = self.peripherals[String(endpoint.dropFirst(2))] {
          promise.resolve(peer.maximumWriteValueLength(for: .withResponse))
        } else if let peer = self.subscribedCentrals[endpoint] {
          promise.resolve(peer.maximumUpdateValueLength)
        } else { promise.reject("ERR_PROXIMITY_OFFLINE", "Bluetooth peer is offline.") }
      }
    }
    AsyncFunction("inflateRawAsync") { (value: String, size: Int, promise: Promise) in
      guard size > 0, size <= 128 * 1024, let input = Data(base64Encoded: value), !input.isEmpty, input.count <= 128 * 1024 else {
        promise.reject("ERR_PROXIMITY_COMPRESSION", "Invalid compressed size."); return
      }
      var output = Data(count: size + 1)
      let written = output.withUnsafeMutableBytes { destination in
        input.withUnsafeBytes { source in
          compression_decode_buffer(destination.bindMemory(to: UInt8.self).baseAddress!, size + 1,
            source.bindMemory(to: UInt8.self).baseAddress!, input.count, nil, COMPRESSION_ZLIB)
        }
      }
      guard written == size else { promise.reject("ERR_PROXIMITY_COMPRESSION", "Invalid compressed payload."); return }
      promise.resolve(output.prefix(size).base64EncodedString())
    }

    AsyncFunction("startAdvertisingAsync") { (promise: Promise) in
      self.bluetoothQueue.async {
        self.advertisingRequested = true
        self.ensureManagers()
        self.emitCurrentBluetoothState()
        self.configurePeripheralIfReady()
        promise.resolve()
      }
    }

    AsyncFunction("startScanAsync") { (scanDurationMs: Int, promise: Promise) in
      self.bluetoothQueue.async {
        self.ensureManagers()
        self.emitCurrentBluetoothState()
        self.startScan(durationMs: scanDurationMs)
        promise.resolve()
      }
    }

    AsyncFunction("stopScanAsync") { (promise: Promise) in
      self.bluetoothQueue.async {
        self.stopScan()
        promise.resolve()
      }
    }

    AsyncFunction("stopSessionAsync") { (promise: Promise) in
      self.bluetoothQueue.async {
        self.advertisingRequested = false
        self.stopScan()
        self.rejectAllWrites(message: "The nearby session stopped.")
        for peripheral in self.peripherals.values { self.central?.cancelPeripheralConnection(peripheral) }
        self.peripheralManager?.stopAdvertising()
        self.peripheralManager?.removeAllServices()
        self.mailboxCharacteristic = nil
        self.peripherals.removeAll()
        self.serviceDiscoveryEndpoints.removeAll()
        self.mailboxByEndpoint.removeAll()
        self.subscribedCentrals.removeAll()
        self.rssiByEndpoint.removeAll()
        self.signalEmittedAtByEndpoint.removeAll()
        self.activeConnectionEndpoints.removeAll()
        promise.resolve()
      }
    }

    AsyncFunction("disconnectAsync") { (endpointId: String, promise: Promise) in
      self.bluetoothQueue.async {
        self.rejectWrite(endpointId: endpointId, message: "The nearby peer disconnected.")
        if endpointId.hasPrefix("c:") {
          self.activeConnectionEndpoints.remove(endpointId)
          let rawEndpoint = String(endpointId.dropFirst(2))
          if let peripheral = self.peripherals.removeValue(forKey: rawEndpoint) {
            self.central?.cancelPeripheralConnection(peripheral)
          }
          self.serviceDiscoveryEndpoints.remove(rawEndpoint)
          self.mailboxByEndpoint.removeValue(forKey: rawEndpoint)
        } else if endpointId.hasPrefix("p:") {
          // CoreBluetooth does not let a Peripheral force-disconnect a
          // subscribed Central. Keep the transport route and reactivate a new
          // logical generation if that Central writes another request.
          self.activeConnectionEndpoints.remove(endpointId)
          self.trace(
            "logical responder disconnect endpoint=\(endpointId) generation=\(self.connectionGenerations[endpointId] ?? 0) route=\(self.subscribedCentrals[endpointId] != nil)"
          )
        }
        promise.resolve()
      }
    }

    AsyncFunction("sendAsync") { (endpointId: String, payload: String, promise: Promise) in
      self.bluetoothQueue.async {
        guard let bytes = Data(base64Encoded: payload) else {
          promise.reject("ERR_PROXIMITY_PACKET", "The nearby packet is not valid base64.")
          return
        }
        guard bytes.count <= maximumWireBytes else {
          promise.reject("ERR_PROXIMITY_TOO_LARGE", "The nearby message is too large.")
          return
        }
        self.trace(
          "outbound packet endpoint=\(endpointId) generation=\(self.connectionGenerations[endpointId] ?? 0) type=\(bytes.count > 1 ? String(format: "0x%02x", bytes[1]) : "truncated") bytes=\(bytes.count)"
        )
        guard self.pendingWrites[endpointId] == nil else {
          promise.reject("ERR_PROXIMITY_BUSY", "Another nearby message is already being sent to this peer.")
          return
        }
        let maximumFrameSize: Int
        if endpointId.hasPrefix("c:"),
          let peripheral = self.peripherals[String(endpointId.dropFirst(2))],
          peripheral.state == .connected,
          self.mailboxByEndpoint[String(endpointId.dropFirst(2))] != nil
        {
          maximumFrameSize = peripheral.maximumWriteValueLength(for: .withResponse)
        } else if endpointId.hasPrefix("p:"), let central = self.subscribedCentrals[endpointId] {
          maximumFrameSize = central.maximumUpdateValueLength
        } else {
          promise.reject("ERR_PROXIMITY_OFFLINE", "The nearby peer is not connected.")
          return
        }
        guard bytes.count <= maximumFrameSize else {
          promise.reject("ERR_PROXIMITY_TOO_LARGE", "The Bitchat frame exceeds the negotiated BLE MTU.")
          return
        }
        let frames = [bytes]
        self.pendingWrites[endpointId] = PendingWrite(frames: frames, nextIndex: 0)
        self.writeResolvers[endpointId] = { promise.resolve() }
        self.writeRejecters[endpointId] = { error in
          promise.reject("ERR_PROXIMITY_WRITE", error.localizedDescription)
        }
        if endpointId.hasPrefix("c:") {
          let rawEndpoint = String(endpointId.dropFirst(2))
          self.writeNext(
            endpointId: endpointId,
            peripheral: self.peripherals[rawEndpoint]!,
            characteristic: self.mailboxByEndpoint[rawEndpoint]!
          )
        } else {
          self.indicateNext(endpointId: endpointId)
        }
      }
    }
  }

  private func ensureManagers() {
    if central == nil { central = CBCentralManager(delegate: bluetoothDelegate, queue: bluetoothQueue) }
    if peripheralManager == nil {
      peripheralManager = CBPeripheralManager(delegate: bluetoothDelegate, queue: bluetoothQueue)
    }
  }

  private func emitCurrentBluetoothState() {
    if let state = central?.state ?? peripheralManager?.state {
      sendEvent("onBluetoothState", ["state": stateName(state)])
    }
  }

  private func startScan(durationMs: Int) {
    pendingScanDurationMs = durationMs
    guard central?.state == .poweredOn else { return }
    if durationMs <= 0, central?.isScanning == true, scanIsContinuous { return }
    pendingScanDurationMs = nil
    scanIsContinuous = durationMs <= 0
    scanGeneration += 1
    let generation = scanGeneration
    central?.stopScan()
    central?.scanForPeripherals(
      withServices: [serviceUUID],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: durationMs <= 0]
    )
    if durationMs > 0 {
      bluetoothQueue.asyncAfter(deadline: .now() + .milliseconds(max(1_000, durationMs))) { [weak self] in
        guard let self, self.scanGeneration == generation else { return }
        self.central?.stopScan()
        self.scanIsContinuous = false
      }
    }
  }

  private func stopScan() {
    pendingScanDurationMs = nil
    scanIsContinuous = false
    scanGeneration += 1
    central?.stopScan()
  }

  private func configurePeripheralIfReady() {
    guard advertisingRequested, let manager = peripheralManager, manager.state == .poweredOn else { return }
    manager.stopAdvertising()
    manager.removeAllServices()
    let mailbox = CBMutableCharacteristic(
      type: mailboxUUID,
      properties: [.write, .writeWithoutResponse, .notify],
      value: nil,
      permissions: [.writeable]
    )
    let service = CBMutableService(type: serviceUUID, primary: true)
    service.characteristics = [mailbox]
    mailboxCharacteristic = mailbox
    manager.add(service)
  }

  fileprivate func centralManagerDidUpdateState(_ central: CBCentralManager) {
    sendEvent("onBluetoothState", ["state": stateName(central.state)])
    if central.state == .poweredOn, let durationMs = pendingScanDurationMs {
      startScan(durationMs: durationMs)
    }
  }

  fileprivate func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    sendEvent("onBluetoothState", ["state": stateName(peripheral.state)])
    if advertisingRequested {
      if peripheral.state == .poweredOn {
        configurePeripheralIfReady()
      }
    }
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard advertisingRequested, error == nil else { return }
    peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceUUID]])
  }

  fileprivate func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi RSSI: NSNumber)
  {
    let endpoint = peripheral.identifier.uuidString
    recordSignal(endpoint: endpoint, rssi: RSSI.intValue)
    peripherals[endpoint] = peripheral
    peripheral.delegate = bluetoothDelegate
    if peripheral.state == .disconnected {
      central.connect(peripheral)
    } else if peripheral.state == .connected, mailboxByEndpoint[endpoint] == nil {
      discoverPeerServices(peripheral)
    }
  }

  fileprivate func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let endpoint = peripheral.identifier.uuidString
    let endpointId = "c:\(endpoint)"
    let generation = activateConnectionGeneration(endpointId: endpointId)
    sendEvent("onConnection", [
      "endpointId": endpointId, "state": "connected", "generation": generation,
    ])
    discoverPeerServices(peripheral)
  }

  fileprivate func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?)
  {
    let endpoint = peripheral.identifier.uuidString
    serviceDiscoveryEndpoints.remove(endpoint)
    mailboxByEndpoint.removeValue(forKey: endpoint)
    let endpointId = "c:\(endpoint)"
    let generation = connectionGenerations[endpointId] ?? 0
    activeConnectionEndpoints.remove(endpointId)
    rejectWrite(endpointId: endpointId, message: "The nearby peer disconnected.")
    sendEvent("onConnection", [
      "endpointId": endpointId, "state": "disconnected", "generation": generation,
    ])
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil else {
      serviceDiscoveryEndpoints.remove(peripheral.identifier.uuidString)
      return
    }
    for service in peripheral.services ?? [] where service.uuid == serviceUUID {
      peripheral.discoverCharacteristics([mailboxUUID], for: service)
    }
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
    guard invalidatedServices.contains(where: { $0.uuid == serviceUUID }) else { return }
    let rawEndpoint = peripheral.identifier.uuidString
    let endpoint = "c:\(rawEndpoint)"
    let generation = connectionGenerations[endpoint] ?? 0
    activeConnectionEndpoints.remove(endpoint)
    serviceDiscoveryEndpoints.remove(rawEndpoint)
    mailboxByEndpoint.removeValue(forKey: rawEndpoint)
    rejectWrite(endpointId: endpoint, message: "The nearby peer changed its GATT service.")
    central?.cancelPeripheralConnection(peripheral)
    sendEvent("onConnection", [
      "endpointId": endpoint, "state": "disconnected", "generation": generation,
    ])
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
    error: Error?)
  {
    guard error == nil else {
      serviceDiscoveryEndpoints.remove(peripheral.identifier.uuidString)
      return
    }
    let endpoint = peripheral.identifier.uuidString
    for characteristic in service.characteristics ?? [] {
      if characteristic.uuid == mailboxUUID {
        mailboxByEndpoint[endpoint] = characteristic
        peripheral.setNotifyValue(true, for: characteristic)
      }
    }
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?)
  {
    trace(
      "notification state endpoint=c:\(peripheral.identifier.uuidString) notifying=\(characteristic.isNotifying) error=\(error?.localizedDescription ?? "none")"
    )
    if error == nil, characteristic.uuid == mailboxUUID, characteristic.isNotifying {
      let endpoint = "c:\(peripheral.identifier.uuidString)"
      sendEvent("onPeer", ["endpointId": endpoint, "generation": connectionGenerations[endpoint] ?? 0,
        "rssi": rssiByEndpoint[peripheral.identifier.uuidString] ?? 0])
      return
    }
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?)
  {
    guard error == nil, let value = characteristic.value else { return }
    let endpoint = "c:\(peripheral.identifier.uuidString)"
    if characteristic.uuid == mailboxUUID {
      accept(frame: value, endpointId: endpoint)
    }
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    peripheral.respond(to: request, withResult: .requestNotSupported)
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for request in requests where request.characteristic.uuid == mailboxUUID {
      let endpointId = "p:\(request.central.identifier.uuidString)"
      trace(
        "write request endpoint=\(endpointId) bytes=\(request.value?.count ?? 0) active=\(activeConnectionEndpoints.contains(endpointId)) route=\(subscribedCentrals[endpointId] != nil) generation=\(connectionGenerations[endpointId] ?? 0)"
      )
      if let value = request.value {
        accept(
          frame: value,
          endpointId: endpointId,
          central: request.central
        )
      }
      peripheral.respond(to: request, withResult: .success)
    }
  }

  private func accept(frame: Data, endpointId: String, central: CBCentral? = nil) {
    if let central, endpointId.hasPrefix("p:") {
      // The subscription callback is not guaranteed to repeat when the
      // operating system reuses a GATT link. A write itself proves the route
      // is live and supplies the Central needed for the response indication.
      subscribedCentrals[endpointId] = central
    }
    let generation: UInt64
    if endpointId.hasPrefix("p:"),
      central != nil,
      !activeConnectionEndpoints.contains(endpointId)
    {
      generation = activateConnectionGeneration(endpointId: endpointId)
      trace("reactivated responder endpoint=\(endpointId) generation=\(generation)")
      sendEvent("onConnection", [
        "endpointId": endpointId, "state": "connected", "generation": generation,
      ])
    } else {
      guard let currentGeneration = connectionGenerations[endpointId] else { return }
      generation = currentGeneration
    }
    guard frame.count >= 22, frame.count <= maximumWireBytes else { return }
    sendEvent("onMessage", ["endpointId": endpointId, "generation": generation,
      "payload": frame.base64EncodedString()])
  }

  private func rejectWrite(endpointId: String, message: String) {
    pendingWrites.removeValue(forKey: endpointId)
    writeResolvers.removeValue(forKey: endpointId)
    writeRejecters.removeValue(forKey: endpointId)?(
      NSError(domain: "ExpoProximity", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    )
  }

  private func rejectAllWrites(message: String) {
    for endpointId in Array(writeRejecters.keys) {
      rejectWrite(endpointId: endpointId, message: message)
    }
    pendingWrites.removeAll()
    writeResolvers.removeAll()
  }

  private func writeNext(endpointId: String, peripheral: CBPeripheral, characteristic: CBCharacteristic) {
    guard var pending = pendingWrites[endpointId], pending.nextIndex < pending.frames.count else {
      pendingWrites.removeValue(forKey: endpointId)
      writeResolvers.removeValue(forKey: endpointId)?()
      writeRejecters.removeValue(forKey: endpointId)
      return
    }
    let frame = pending.frames[pending.nextIndex]
    pending.nextIndex += 1
    pendingWrites[endpointId] = pending
    peripheral.writeValue(frame, for: characteristic, type: .withResponse)
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic,
    error: Error?)
  {
    let endpoint = "c:\(peripheral.identifier.uuidString)"
    if let error {
      pendingWrites.removeValue(forKey: endpoint)
      writeResolvers.removeValue(forKey: endpoint)
      writeRejecters.removeValue(forKey: endpoint)?(error)
      return
    }
    writeNext(endpointId: endpoint, peripheral: peripheral, characteristic: characteristic)
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic)
  {
    guard characteristic.uuid == mailboxUUID else { return }
    let endpoint = "p:\(central.identifier.uuidString)"
    subscribedCentrals[endpoint] = central
    let generation = activateConnectionGeneration(endpointId: endpoint)
    sendEvent("onPeer", ["endpointId": endpoint, "generation": generation])
    trace("subscribed endpoint=\(endpoint) generation=\(generation)")
    sendEvent("onConnection", [
      "endpointId": endpoint, "state": "connected", "generation": generation,
    ])
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
    didUnsubscribeFrom characteristic: CBCharacteristic)
  {
    guard characteristic.uuid == mailboxUUID else { return }
    let endpoint = "p:\(central.identifier.uuidString)"
    let generation = connectionGenerations[endpoint] ?? 0
    trace("unsubscribed endpoint=\(endpoint) generation=\(generation)")
    activeConnectionEndpoints.remove(endpoint)
    subscribedCentrals.removeValue(forKey: endpoint)
    rejectWrite(endpointId: endpoint, message: "The nearby peer disconnected.")
    sendEvent("onConnection", [
      "endpointId": endpoint, "state": "disconnected", "generation": generation,
    ])
  }

  fileprivate func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    for endpoint in Array(pendingWrites.keys) where endpoint.hasPrefix("p:") {
      indicateNext(endpointId: endpoint)
    }
  }

  private func indicateNext(endpointId: String) {
    guard let manager = peripheralManager, let characteristic = mailboxCharacteristic,
      let central = subscribedCentrals[endpointId]
    else { return }
    var sent = 0
    while sent < maximumIndicationsPerTurn {
      guard var pending = pendingWrites[endpointId] else { return }
      guard pending.nextIndex < pending.frames.count else {
        pendingWrites.removeValue(forKey: endpointId)
        writeResolvers.removeValue(forKey: endpointId)?()
        writeRejecters.removeValue(forKey: endpointId)
        return
      }
      let frame = pending.frames[pending.nextIndex]
      guard manager.updateValue(frame, for: characteristic, onSubscribedCentrals: [central]) else { return }
      pending.nextIndex += 1
      pendingWrites[endpointId] = pending
      sent += 1
    }
    bluetoothQueue.async { [weak self] in self?.indicateNext(endpointId: endpointId) }
  }

  private func stateName(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "poweredOn"
    case .poweredOff: return "poweredOff"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .resetting: return "resetting"
    default: return "unknown"
    }
  }

  private func activateConnectionGeneration(endpointId: String) -> UInt64 {
    if activeConnectionEndpoints.contains(endpointId) {
      return connectionGenerations[endpointId] ?? 0
    }
    activeConnectionEndpoints.insert(endpointId)
    let next = (connectionGenerations[endpointId] ?? 0) + 1
    connectionGenerations[endpointId] = next
    return next
  }

  private func recordSignal(endpoint: String, rssi: Int) {
    guard rssi != 127 else { return }
    rssiByEndpoint[endpoint] = rssi
    let now = ProcessInfo.processInfo.systemUptime
    if let lastEmission = signalEmittedAtByEndpoint[endpoint], now - lastEmission < 1 { return }
    signalEmittedAtByEndpoint[endpoint] = now
    sendEvent("onSignal", ["endpointId": "c:\(endpoint)", "rssi": rssi])
  }

}

private final class ExpoProximityBluetoothDelegate: NSObject, CBCentralManagerDelegate,
  CBPeripheralManagerDelegate, CBPeripheralDelegate
{
  private weak var owner: ExpoProximityModule?

  init(owner: ExpoProximityModule) {
    self.owner = owner
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    owner?.centralManagerDidUpdateState(central)
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    owner?.peripheralManagerDidUpdateState(peripheral)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    owner?.peripheralManager(peripheral, didAdd: service, error: error)
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi RSSI: NSNumber)
  {
    owner?.centralManager(central, didDiscover: peripheral, advertisementData: advertisementData, rssi: RSSI)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    owner?.centralManager(central, didConnect: peripheral)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?)
  {
    owner?.centralManager(central, didDisconnectPeripheral: peripheral, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    owner?.peripheral(peripheral, didDiscoverServices: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
    owner?.peripheral(peripheral, didModifyServices: invalidatedServices)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
    error: Error?)
  {
    owner?.peripheral(peripheral, didDiscoverCharacteristicsFor: service, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?)
  {
    owner?.peripheral(peripheral, didUpdateValueFor: characteristic, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?)
  {
    owner?.peripheral(
      peripheral,
      didUpdateNotificationStateFor: characteristic,
      error: error
    )
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    owner?.peripheralManager(peripheral, didReceiveRead: request)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    owner?.peripheralManager(peripheral, didReceiveWrite: requests)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic)
  {
    owner?.peripheralManager(peripheral, central: central, didSubscribeTo: characteristic)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
    didUnsubscribeFrom characteristic: CBCharacteristic)
  {
    owner?.peripheralManager(peripheral, central: central, didUnsubscribeFrom: characteristic)
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    owner?.peripheralManagerIsReady(toUpdateSubscribers: peripheral)
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic,
    error: Error?)
  {
    owner?.peripheral(peripheral, didWriteValueFor: characteristic, error: error)
  }
}
