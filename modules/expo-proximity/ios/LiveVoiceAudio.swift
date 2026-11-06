import AVFoundation
import Foundation

final class LiveVoiceAudio {
  let queue = DispatchQueue(label: "io.github.hsoc.outlink.live-audio")
  private let captureSlots = DispatchSemaphore(value: 2)
  private var capture: AVAudioEngine?
  private var playback: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var decoder: AVAudioConverter?
  private var scheduled = 0

  private let pcm = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)
  private let aac = AVAudioFormat(settings: [
    AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
  ])

  func start(emit: @escaping (Data) -> Void) throws {
    guard capture == nil else { throw AudioError.busy }
    guard let pcm, let aac else { throw AudioError.unavailable }
    stopPlayback()
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
    try session.setActive(true)
    let engine = AVAudioEngine()
    let input = engine.inputNode, format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0,
      let resampler = AVAudioConverter(from: format, to: pcm),
      let encoder = AVAudioConverter(from: pcm, to: aac)
    else {
      try? session.setActive(false)
      throw AudioError.unavailable
    }
    encoder.bitRate = 16000
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self, weak engine] buffer, _ in
      guard let self, let engine, self.captureSlots.wait(timeout: .now()) == .success else { return }
      guard let copy = Self.copy(buffer) else { self.captureSlots.signal(); return }
      self.queue.async {
        defer { self.captureSlots.signal() }
        guard self.capture === engine else { return }
        let capacity = AVAudioFrameCount(ceil(Double(copy.frameLength) * 16000 / format.sampleRate)) + 32
        guard let mono = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: capacity) else { return }
        if !Self.convert(resampler, from: copy, to: mono) || mono.frameLength == 0 { return }
        let encoded = AVAudioCompressedBuffer(format: aac, packetCapacity: 8, maximumPacketSize: max(512, encoder.maximumOutputPacketSize))
        guard Self.convert(encoder, from: mono, to: encoded), let descriptions = encoded.packetDescriptions else { return }
        for index in 0..<Int(encoded.packetCount) {
          let packet = descriptions[index]
          let start = Int(packet.mStartOffset), length = Int(packet.mDataByteSize)
          guard start >= 0, length > 0, length <= 512, start + length <= Int(encoded.byteLength) else { continue }
          emit(Data(bytes: encoded.data.advanced(by: start), count: length))
        }
      }
    }
    do {
      try engine.start()
      capture = engine
      queue.asyncAfter(deadline: .now() + 15) { [weak self, weak engine] in
        if let engine, self?.capture === engine { self?.stopCapture() }
      }
    } catch {
      input.removeTap(onBus: 0)
      try? session.setActive(false)
      throw error
    }
  }

  func stopCapture() {
    guard let engine = capture else { return }
    capture = nil
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }

  func play(_ frame: Data) throws {
    guard capture == nil, frame.count > 0, frame.count <= 512, scheduled < 6 else { return }
    guard let pcm, let aac else { throw AudioError.unavailable }
    if player == nil {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .default)
      try session.setActive(true)
      guard let converter = AVAudioConverter(from: aac, to: pcm) else { throw AudioError.unavailable }
      let engine = AVAudioEngine(), node = AVAudioPlayerNode()
      engine.attach(node)
      engine.connect(node, to: engine.mainMixerNode, format: pcm)
      do { try engine.start() } catch {
        try? session.setActive(false)
        throw error
      }
      node.play()
      playback = engine; player = node; decoder = converter
    }
    guard let node = player, let decoder,
      let output = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: 2048)
    else { return }
    let input = AVAudioCompressedBuffer(format: aac, packetCapacity: 1, maximumPacketSize: frame.count)
    input.packetCount = 1
    input.byteLength = UInt32(frame.count)
    input.packetDescriptions?.pointee = AudioStreamPacketDescription(
      mStartOffset: 0, mVariableFramesInPacket: 0, mDataByteSize: UInt32(frame.count)
    )
    frame.copyBytes(to: input.data.assumingMemoryBound(to: UInt8.self), count: frame.count)
    guard Self.convert(decoder, from: input, to: output), output.frameLength > 0 else { return }
    scheduled += 1
    node.scheduleBuffer(output, completionCallbackType: .dataPlayedBack) { [weak self, weak node] _ in
      guard let self else { return }
      self.queue.async {
        if let node, self.player === node { self.scheduled = max(0, self.scheduled - 1) }
      }
    }
  }

  func stopPlayback() {
    guard let engine = playback else { return }
    player?.stop()
    player = nil
    decoder = nil
    playback = nil
    scheduled = 0
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }

  private static func convert(_ converter: AVAudioConverter, from input: AVAudioBuffer, to output: AVAudioBuffer) -> Bool {
    var supplied = false
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, state in
      if supplied { state.pointee = .noDataNow; return nil }
      supplied = true
      state.pointee = .haveData
      return input
    }
    return status != .error && error == nil
  }

  private static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let result = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return nil }
    result.frameLength = buffer.frameLength
    let source = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
    let destination = UnsafeMutableAudioBufferListPointer(result.mutableAudioBufferList)
    for index in source.indices {
      guard let input = source[index].mData, let output = destination[index].mData else { return nil }
      memcpy(output, input, Int(source[index].mDataByteSize))
    }
    return result
  }

  private enum AudioError: Error { case busy, unavailable }
}
