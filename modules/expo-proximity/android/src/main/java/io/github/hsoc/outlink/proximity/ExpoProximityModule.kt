package io.github.hsoc.outlink.proximity

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.annotation.SuppressLint
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Log
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.zip.Inflater
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
private const val DEFAULT_ATT_MTU = 23
private const val MAXIMUM_ATT_MTU = 517
private const val ATT_CHARACTERISTIC_OVERHEAD_BYTES = 3
private const val GATT_MAXIMUM_ATTRIBUTE_VALUE_BYTES = 512
private const val MAXIMUM_WIRE_BYTES = 128 * 1024

internal fun maximumGattFrameSize(mtu: Int): Int = min(
  GATT_MAXIMUM_ATTRIBUTE_VALUE_BYTES,
  mtu - ATT_CHARACTERISTIC_OVERHEAD_BYTES,
)

@SuppressLint("MissingPermission")
class ExpoProximityModule : Module() {
  private val SERVICE_UUID = UUID.fromString("F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C")
  private val MAILBOX_UUID = UUID.fromString("A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D")
  private val handler = Handler(Looper.getMainLooper())
  private var gattServer: BluetoothGattServer? = null
  private var serverMailbox: BluetoothGattCharacteristic? = null
  private val gatts = mutableMapOf<String, BluetoothGatt>()
  private val mailboxes = mutableMapOf<String, BluetoothGattCharacteristic>()
  private val subscribedDevices = mutableMapOf<String, android.bluetooth.BluetoothDevice>()
  private val mtuByEndpoint = mutableMapOf<String, Int>()
  private val signalEmittedAtByEndpoint = mutableMapOf<String, Long>()
  private val writeQueues = mutableMapOf<String, ArrayDeque<ByteArray>>()
  private val writePromises = mutableMapOf<String, Promise>()
  private val connectionGenerations = mutableMapOf<String, Long>()
  private val activeConnectionEndpoints = mutableSetOf<String>()
  private var scanStopRunnable: Runnable? = null
  private val isScanning get() = discoveryConnections.isScanning
  private var advertiseCallback: AdvertiseCallback? = null
  private val discoveryConnections = DiscoveryConnectionQueue(
    schedule = { task, delayMs -> handler.postDelayed(task, delayMs) },
    cancel = { task -> handler.removeCallbacks(task) },
  )

  private val manager: BluetoothManager?
    get() = appContext.reactContext?.getSystemService(BluetoothManager::class.java)
  private val adapter get() = manager?.adapter

  override fun definition() = ModuleDefinition {
    Name("ExpoProximity")
    AsyncFunction("copyTextAsync") { text: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Application unavailable")
      val clipboard = context.getSystemService(ClipboardManager::class.java) ?: throw IllegalStateException("Clipboard unavailable")
      clipboard.setPrimaryClip(ClipData.newPlainText("Outlink", text))
    }
    AsyncFunction("backgroundRunningAsync") { ConnectivityService.running }
    AsyncFunction("backgroundTokenAsync") { ConnectivityService.token }
    AsyncFunction("stopBackgroundAsync") {
      appContext.reactContext?.stopService(Intent(appContext.reactContext, ConnectivityService::class.java))
      Unit
    }
    AsyncFunction("startBackgroundAsync") { title: String, body: String, stop: String, promise: Promise ->
      handler.post {
        val context = appContext.reactContext
        if (context == null || appContext.currentActivity == null) {
          promise.reject("ERR_BACKGROUND", "Open Outlink to start background connectivity", null)
        } else if (ConnectivityService.running) {
          promise.resolve()
        } else {
          try {
            val intent = Intent(context, ConnectivityService::class.java)
              .putExtra("title", title.take(128)).putExtra("body", body.take(256)).putExtra("stop", stop.take(64))
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            val deadline = SystemClock.elapsedRealtime() + 5_000L
            fun confirm() {
              if (ConnectivityService.running) promise.resolve()
              else if (SystemClock.elapsedRealtime() >= deadline) {
                context.stopService(intent)
                promise.reject("ERR_BACKGROUND", "Background connectivity could not start; check notifications and Bluetooth permissions", null)
              } else handler.postDelayed({ confirm() }, 50L)
            }
            confirm()
          } catch (error: Exception) {
            promise.reject("ERR_BACKGROUND", "Background connectivity could not start", error)
          }
        }
      }
    }
    OnDestroy {
      appContext.reactContext?.let { it.stopService(Intent(it, ConnectivityService::class.java)) }
    }

    Events("onPeer", "onSignal", "onMessage", "onConnection", "onBluetoothState")

    AsyncFunction("configureProtocolAsync") { mode: String, promise: Promise ->
      handler.post {
        if (mode != "bitchat" || gattServer != null || activeConnectionEndpoints.isNotEmpty()) {
          promise.reject("ERR_PROXIMITY_MODE", "Stop Bluetooth before changing protocol.", null)
        } else { promise.resolve() }
      }
    }
    AsyncFunction("maximumFrameSizeAsync") { endpoint: String, promise: Promise ->
      handler.post { promise.resolve(maximumGattFrameSize(mtuByEndpoint[endpoint.drop(2)] ?: DEFAULT_ATT_MTU)) }
    }
    AsyncFunction("inflateRawAsync") { value: String, size: Int ->
      require(size in 1..128 * 1024) { "Invalid compressed size" }
      val compressed = Base64.decode(value, Base64.NO_WRAP)
      require(compressed.size <= 128 * 1024) { "Compressed payload too large" }
      val inflater = Inflater(true)
      try {
        inflater.setInput(compressed)
        val output = ByteArray(size + 1)
        val count = inflater.inflate(output)
        require(count == size && inflater.finished() && inflater.remaining == 0) { "Invalid compressed payload" }
        Base64.encodeToString(output.copyOf(size), Base64.NO_WRAP)
      } finally { inflater.end() }
    }

    AsyncFunction("startAdvertisingAsync") { promise: Promise ->
      handler.post {
        try {
          openServerAndAdvertise()
          promise.resolve()
        } catch (error: Exception) {
          promise.reject("ERR_PROXIMITY_START", error.message, error)
        }
      }
    }

    AsyncFunction("startScanAsync") { scanDurationMs: Int, promise: Promise ->
      handler.post {
        try {
          openServerAndAdvertise()
          startScan(scanDurationMs)
          promise.resolve()
        } catch (error: Exception) {
          promise.reject("ERR_PROXIMITY_SCAN", error.message, error)
        }
      }
    }

    AsyncFunction("stopScanAsync") { promise: Promise ->
      handler.post {
        stopScan()
        promise.resolve()
      }
    }

    AsyncFunction("stopSessionAsync") { promise: Promise ->
      handler.post {
        appContext.reactContext?.let { it.stopService(Intent(it, ConnectivityService::class.java)) }
        stopScan()
        discoveryConnections.stopSession()
        rejectAllWrites("ERR_PROXIMITY_STOPPED", "The nearby session stopped.")
        val callback = advertiseCallback
        advertiseCallback = null
        if (callback != null) adapter?.bluetoothLeAdvertiser?.stopAdvertising(callback)
        gatts.values.forEach { it.close() }
        gatts.clear()
        mailboxes.clear()
        subscribedDevices.clear()
        serverMailbox = null
        mtuByEndpoint.clear()
        signalEmittedAtByEndpoint.clear()
        activeConnectionEndpoints.clear()
        gattServer?.close()
        gattServer = null
        promise.resolve()
      }
    }

    AsyncFunction("disconnectAsync") { endpointId: String, promise: Promise ->
      handler.post {
        val rawEndpoint = endpointId.drop(2)
        discoveryConnections.remove(rawEndpoint)
        rejectWrite(endpointId, "ERR_PROXIMITY_DISCONNECTED", "The nearby peer disconnected.")
        if (endpointId.startsWith("c:")) {
          activeConnectionEndpoints.remove(endpointId)
          mailboxes.remove(rawEndpoint)
          gatts.remove(rawEndpoint)?.let {
            it.disconnect()
            it.close()
          }
        } else if (endpointId.startsWith("p:")) {
          subscribedDevices.remove(endpointId)?.let { device ->
            gattServer?.cancelConnection(device)
          }
        }
        promise.resolve()
      }
    }

    AsyncFunction("sendAsync") { endpointId: String, payload: String, promise: Promise ->
      handler.post {
        val bytes = try {
          Base64.decode(payload, Base64.NO_WRAP)
        } catch (error: IllegalArgumentException) {
          promise.reject("ERR_PROXIMITY_PACKET", "The nearby packet is not valid base64.", error)
          return@post
        }
        if (bytes.size > MAXIMUM_WIRE_BYTES) {
          promise.reject("ERR_PROXIMITY_TOO_LARGE", "The nearby message is too large.", null)
          return@post
        }
        if (endpointId in writeQueues || endpointId in writePromises) {
          promise.reject("ERR_PROXIMITY_BUSY", "Another nearby message is already being sent to this peer.", null)
          return@post
        }
        val rawEndpoint = endpointId.drop(2)
        val negotiatedMtu = mtuByEndpoint[rawEndpoint] ?: DEFAULT_ATT_MTU
        val maximumFrameSize = maximumGattFrameSize(negotiatedMtu)
        if (maximumFrameSize <= 0) {
          promise.reject("ERR_PROXIMITY_MTU", "The negotiated BLE MTU is too small.", null)
          return@post
        }
        if (bytes.size > maximumFrameSize) {
          promise.reject("ERR_PROXIMITY_TOO_LARGE", "The Bitchat frame exceeds the negotiated BLE MTU.", null)
          return@post
        }
        val queue = ArrayDeque<ByteArray>()
        queue.add(bytes)
        writeQueues[endpointId] = queue
        writePromises[endpointId] = promise
        if (endpointId.startsWith("c:")) {
          val gatt = gatts[rawEndpoint]
          val mailbox = mailboxes[rawEndpoint]
          if (gatt == null || mailbox == null) {
            writeQueues.remove(endpointId)
            writePromises.remove(endpointId)
            promise.reject("ERR_PROXIMITY_OFFLINE", "The nearby peer is not connected.", null)
            return@post
          }
          writeNext(endpointId, gatt, mailbox)
        } else if (endpointId.startsWith("p:") && subscribedDevices[endpointId] != null) {
          indicateNext(endpointId)
        } else {
          writeQueues.remove(endpointId)
          writePromises.remove(endpointId)
          promise.reject("ERR_PROXIMITY_OFFLINE", "The nearby peer is not connected.", null)
        }
      }
    }
  }

  private fun openServerAndAdvertise() {
    val bluetoothManager = manager ?: error("Bluetooth is unavailable")
    val bluetoothAdapter = adapter ?: error("Bluetooth is unavailable")
    sendEvent("onBluetoothState", mapOf("state" to if (bluetoothAdapter.isEnabled) "poweredOn" else "poweredOff"))
    if (!bluetoothAdapter.isEnabled) error("Bluetooth is powered off")
    if (gattServer == null) {
      val server = bluetoothManager.openGattServer(appContext.reactContext, serverCallback)
      val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
      val mailbox = BluetoothGattCharacteristic(
        MAILBOX_UUID,
        BluetoothGattCharacteristic.PROPERTY_WRITE or
          BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
        BluetoothGattCharacteristic.PERMISSION_WRITE,
      )
      mailbox.addDescriptor(
        BluetoothGattDescriptor(
          CCCD_UUID,
          BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
        ),
      )
      service.addCharacteristic(mailbox)
      serverMailbox = mailbox
      if (!server.addService(service)) error("Unable to publish the nearby GATT service")
      gattServer = server
    }
    // The callback owns both the pending start and the active advertisement.
    // Scanning can start before onStartSuccess arrives; it must not restart it.
    if (advertiseCallback != null) return

    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
      .setConnectable(true)
      .build()
    val data = AdvertiseData.Builder().addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val advertiser = bluetoothAdapter.bluetoothLeAdvertiser ?: error("BLE advertising is unavailable")
    val callback = createAdvertiseCallback()
    advertiseCallback = callback
    try {
      advertiser.startAdvertising(settings, data, callback)
    } catch (error: Exception) {
      advertiseCallback = null
      throw error
    }
  }

  private fun startScan(durationMs: Int) {
    val bluetoothAdapter = adapter ?: error("Bluetooth is unavailable")
    if (!bluetoothAdapter.isEnabled) return
    if (durationMs <= 0 && isScanning && scanStopRunnable == null) return
    val scanner = bluetoothAdapter.bluetoothLeScanner ?: error("BLE scanning is unavailable")
    scanStopRunnable?.let(handler::removeCallbacks)
    scanStopRunnable = null
    scanner.stopScan(scanCallback)
    discoveryConnections.stopScan()
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val settings = ScanSettings.Builder()
      .setScanMode(
        if (durationMs <= 0) ScanSettings.SCAN_MODE_LOW_LATENCY
        else ScanSettings.SCAN_MODE_LOW_POWER,
      )
      .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
      .build()
    scanner.startScan(listOf(filter), settings, scanCallback)
    discoveryConnections.startScan()
    if (durationMs > 0) {
      val stop = Runnable {
        scanner.stopScan(scanCallback)
        discoveryConnections.stopScan()
        scanStopRunnable = null
      }
      scanStopRunnable = stop
      handler.postDelayed(stop, max(1_000, durationMs).toLong())
    }
  }

  private fun stopScan() {
    if (!isScanning) return
    scanStopRunnable?.let(handler::removeCallbacks)
    scanStopRunnable = null
    adapter?.bluetoothLeScanner?.stopScan(scanCallback)
    discoveryConnections.stopScan()
  }

  private fun createAdvertiseCallback() = object : AdvertiseCallback() {
    override fun onStartFailure(errorCode: Int) {
      handler.post {
        if (advertiseCallback !== this) return@post
        advertiseCallback = null
        Log.w("OutlinkNearby", "BLE advertising failed ($errorCode)")
      }
    }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      handler.post {
        if (!isScanning) return@post
        val endpoint = result.device.address
        recordSignal(endpoint, result.rssi)
        if (gatts[endpoint] != null) return@post
        // CoreBluetooth may leave its Central connection pending if Android
        // opens the opposite link first. Allow inbound discovery to win, then
        // attach our GATT client to that same link. Jitter also separates two
        // Android peers; a bounded fallback still discovers passive devices.
        discoveryConnections.enqueue(endpoint, Random.nextLong(2_500, 4_000)) {
          if (gattServer == null || gatts[endpoint] != null) {
            return@enqueue
          }
          val context = appContext.reactContext ?: return@enqueue
          try {
            gatts[endpoint] = result.device.connectGatt(
              context, false, clientCallback, android.bluetooth.BluetoothDevice.TRANSPORT_LE,
            )
          } catch (error: Exception) {
            Log.w("OutlinkNearby", "BLE discovery connection could not start", error)
          }
        }
      }
    }
  }

  private val clientCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      val endpoint = gatt.device.address
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        gatts[endpoint] = gatt
        val endpointId = "c:$endpoint"
        val generation = activateConnectionGeneration(endpointId)
        sendEvent("onConnection", mapOf("endpointId" to endpointId, "state" to "connected", "generation" to generation))
        if (!gatt.requestMtu(MAXIMUM_ATT_MTU)) gatt.discoverServices()
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        mailboxes.remove(endpoint)
        mtuByEndpoint.remove(endpoint)
        gatts.remove(endpoint)
        gatt.close()
        val endpointId = "c:$endpoint"
        val generation = connectionGenerations[endpointId] ?: 0
        activeConnectionEndpoints.remove(endpointId)
        rejectWrite(endpointId, "ERR_PROXIMITY_DISCONNECTED", "The nearby peer disconnected.")
        sendEvent("onConnection", mapOf("endpointId" to endpointId, "state" to "disconnected", "generation" to generation))
      }
    }

    override fun onServiceChanged(gatt: BluetoothGatt) {
      val endpoint = gatt.device.address
      val endpointId = "c:$endpoint"
      val generation = connectionGenerations[endpointId] ?: 0
      activeConnectionEndpoints.remove(endpointId)
      mailboxes.remove(endpoint)
      mtuByEndpoint.remove(endpoint)
      gatts.remove(endpoint)
      rejectWrite(endpointId, "ERR_PROXIMITY_DISCONNECTED", "The nearby peer changed its GATT service.")
      gatt.disconnect()
      gatt.close()
      sendEvent("onConnection", mapOf("endpointId" to endpointId, "state" to "disconnected", "generation" to generation))
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      mtuByEndpoint[gatt.device.address] =
        if (status == BluetoothGatt.GATT_SUCCESS) mtu else DEFAULT_ATT_MTU
      gatt.discoverServices()
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) return
      val service = gatt.getService(SERVICE_UUID) ?: return
      val endpoint = gatt.device.address
      val mailbox = service.getCharacteristic(MAILBOX_UUID) ?: return
      mailboxes[endpoint] = mailbox
      if (!subscribeToMailbox(gatt, mailbox)) gatt.disconnect()
    }

    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (descriptor.uuid != CCCD_UUID) return
      if (descriptor.characteristic.uuid == MAILBOX_UUID && status == BluetoothGatt.GATT_SUCCESS) {
        sendEvent("onPeer", mapOf("endpointId" to "c:${gatt.device.address}",
          "generation" to (connectionGenerations["c:${gatt.device.address}"] ?: 0L)))
      }
    }

    @Deprecated("Deprecated in Android 13")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (characteristic.uuid == MAILBOX_UUID) emitMailbox("c:${gatt.device.address}", characteristic.value)
    }

    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (characteristic.uuid == MAILBOX_UUID) emitMailbox("c:${gatt.device.address}", value)
    }

    override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      val endpoint = "c:${gatt.device.address}"
      if (status != BluetoothGatt.GATT_SUCCESS) {
        writeQueues.remove(endpoint)
        writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_WRITE", "BLE write failed ($status).", null)
        return
      }
      writeNext(endpoint, gatt, characteristic)
    }
  }

  private fun recordSignal(endpoint: String, rssi: Int) {
    if (rssi == 127) return
    val now = SystemClock.elapsedRealtime()
    val lastEmission = signalEmittedAtByEndpoint[endpoint]
    if (lastEmission != null && now - lastEmission < 1_000) return
    signalEmittedAtByEndpoint[endpoint] = now
    sendEvent("onSignal", mapOf("endpointId" to "c:$endpoint", "rssi" to rssi))
  }

  private fun emitMailbox(endpoint: String, value: ByteArray?) {
    val frame = value ?: return
    acceptFrame(endpoint, frame)
  }

  private fun subscribeToMailbox(
    gatt: BluetoothGatt,
    mailbox: BluetoothGattCharacteristic,
  ): Boolean {
    gatt.setCharacteristicNotification(mailbox, true)
    val descriptor = mailbox.getDescriptor(CCCD_UUID) ?: return false
    return writeDescriptor(gatt, descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
  }

  private fun writeDescriptor(
    gatt: BluetoothGatt,
    descriptor: BluetoothGattDescriptor,
    value: ByteArray,
  ): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      gatt.writeDescriptor(descriptor, value) == BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      run {
        descriptor.value = value
        gatt.writeDescriptor(descriptor)
      }
    }
  }

  /** Recent Android versions reject oversized characteristic values by throwing
   * on the caller thread instead of reporting a failed GATT status. */
  private inline fun safelyStartGattOperation(operation: () -> Boolean): Boolean {
    return try {
      operation()
    } catch (_: IllegalArgumentException) {
      false
    }
  }

  private fun writeNext(endpoint: String, gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
    val queue = writeQueues[endpoint]
    val frame = queue?.removeFirstOrNull()
    if (frame == null) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.resolve()
      return
    }
    characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
    val started = safelyStartGattOperation {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gatt.writeCharacteristic(characteristic, frame, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        run {
          characteristic.value = frame
          gatt.writeCharacteristic(characteristic)
        }
      }
    }
    if (!started) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_WRITE", "BLE write could not start.", null)
    }
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: android.bluetooth.BluetoothDevice, status: Int, newState: Int) {
      val endpoint = "p:${device.address}"
      handler.post {
        if (newState == BluetoothProfile.STATE_CONNECTED && gatts[device.address] == null) {
          discoveryConnections.defer(device.address, 10_000)
        }
      }
      if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        val generation = connectionGenerations[endpoint] ?: 0
        activeConnectionEndpoints.remove(endpoint)
        subscribedDevices.remove(endpoint)
        rejectWrite(endpoint, "ERR_PROXIMITY_DISCONNECTED", "The nearby peer disconnected.")
        sendEvent("onConnection", mapOf("endpointId" to endpoint, "state" to "disconnected", "generation" to generation))
      }
    }

    override fun onMtuChanged(device: android.bluetooth.BluetoothDevice, mtu: Int) {
      mtuByEndpoint[device.address] = mtu
    }

    override fun onCharacteristicReadRequest(device: android.bluetooth.BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic) {
      gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, offset, null)
    }

    override fun onCharacteristicWriteRequest(device: android.bluetooth.BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) {
      if (characteristic.uuid == MAILBOX_UUID) {
        val endpoint = "p:${device.address}"
        subscribedDevices[endpoint] = device
        if (endpoint !in activeConnectionEndpoints) {
          val generation = activateConnectionGeneration(endpoint)
          sendEvent("onConnection", mapOf("endpointId" to endpoint, "state" to "connected", "generation" to generation))
        }
        acceptFrame(endpoint, value)
      }
      if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
    }

    override fun onDescriptorWriteRequest(device: android.bluetooth.BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) {
      if (descriptor.uuid == CCCD_UUID) {
        val endpoint = "p:${device.address}"
        if (descriptor.characteristic.uuid == MAILBOX_UUID) {
          if (value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
            subscribedDevices[endpoint] = device
            val generation = activateConnectionGeneration(endpoint)
            sendEvent("onConnection", mapOf("endpointId" to endpoint, "state" to "connected", "generation" to generation))
            sendEvent("onPeer", mapOf("endpointId" to endpoint, "generation" to generation))
          } else {
            subscribedDevices.remove(endpoint)
          }
        }
        @Suppress("DEPRECATION")
        run { descriptor.value = value }
      }
      if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
    }

    override fun onNotificationSent(device: android.bluetooth.BluetoothDevice, status: Int) {
      val endpoint = "p:${device.address}"
      if (status != BluetoothGatt.GATT_SUCCESS) {
        writeQueues.remove(endpoint)
        writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_WRITE", "BLE notification failed ($status).", null)
        return
      }
      indicateNext(endpoint)
    }
  }

  private fun indicateNext(endpoint: String) {
    val device = subscribedDevices[endpoint]
    val characteristic = serverMailbox
    val frame = writeQueues[endpoint]?.removeFirstOrNull()
    if (device == null || characteristic == null) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_OFFLINE", "The nearby peer is not connected.", null)
      return
    }
    if (frame == null) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.resolve()
      return
    }
    val started = safelyStartGattOperation {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gattServer?.notifyCharacteristicChanged(device, characteristic, false, frame) == BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        run {
          characteristic.value = frame
          gattServer?.notifyCharacteristicChanged(device, characteristic, false) == true
        }
      }
    }
    if (!started) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_WRITE", "BLE indication could not start.", null)
    }
  }

  private fun acceptFrame(endpoint: String, frame: ByteArray) {
    val generation = connectionGenerations[endpoint] ?: return
    if (frame.size in 22..MAXIMUM_WIRE_BYTES) sendEvent("onMessage", mapOf("endpointId" to endpoint,
      "generation" to generation, "payload" to Base64.encodeToString(frame, Base64.NO_WRAP)))
  }

  private fun activateConnectionGeneration(endpoint: String): Long {
    if (endpoint in activeConnectionEndpoints) return connectionGenerations[endpoint] ?: 0
    activeConnectionEndpoints.add(endpoint)
    val next = (connectionGenerations[endpoint] ?: 0) + 1
    connectionGenerations[endpoint] = next
    return next
  }

  private fun rejectWrite(endpoint: String, code: String, message: String) {
    writeQueues.remove(endpoint)
    writePromises.remove(endpoint)?.reject(code, message, null)
  }

  private fun rejectAllWrites(code: String, message: String) {
    val promises = writePromises.values.toList()
    writePromises.clear()
    writeQueues.clear()
    promises.forEach { it.reject(code, message, null) }
  }
}
