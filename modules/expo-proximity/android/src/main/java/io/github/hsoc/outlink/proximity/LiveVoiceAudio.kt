package io.github.hsoc.outlink.proximity

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaRecorder
import android.os.SystemClock
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

internal class LiveVoiceAudio {
  private data class Capture(val recorder: AudioRecord, val running: AtomicBoolean)
  @Volatile private var capture: Capture? = null
  private val playbackLock = Any()
  private var decoder: MediaCodec? = null
  private var track: AudioTrack? = null
  private var playbackSamples = 0L

  @SuppressLint("MissingPermission")
  @Synchronized
  fun start(emit: (ByteArray) -> Unit) {
    check(capture == null) { "Microphone is already active" }
    stopPlayback()
    val size = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    check(size > 0) { "Microphone format unavailable" }
    val recorder = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT, maxOf(size, FRAME_BYTES * 2))
    val encoder = try { MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC) }
    catch (error: Exception) { recorder.release(); throw error }
    try {
      check(recorder.state == AudioRecord.STATE_INITIALIZED)
      val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RATE, 1)
      format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      format.setInteger(MediaFormat.KEY_BIT_RATE, 16000)
      encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      encoder.start()
      recorder.startRecording()
      check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING)
    } catch (error: Exception) {
      encoder.release(); recorder.release(); throw error
    }
    val current = Capture(recorder, AtomicBoolean(true))
    capture = current
    Thread({ captureLoop(current, encoder, emit) }, "OutlinkLiveVoice").start()
  }

  private fun captureLoop(current: Capture, encoder: MediaCodec, emit: (ByteArray) -> Unit) {
    val input = ByteArray(FRAME_BYTES)
    val info = MediaCodec.BufferInfo()
    val started = SystemClock.elapsedRealtime()
    var samples = 0L
    try {
      while (current.running.get() && SystemClock.elapsedRealtime() - started < 15000) {
        val count = current.recorder.read(input, 0, input.size)
        if (count <= 0 || !current.running.get()) break
        val slot = encoder.dequeueInputBuffer(10000)
        if (slot >= 0) {
          encoder.getInputBuffer(slot)?.apply { clear(); put(input, 0, count) }
          encoder.queueInputBuffer(slot, 0, count, samples * 1000000 / RATE, 0)
          samples += count / 2
        }
        while (current.running.get()) {
          val output = encoder.dequeueOutputBuffer(info, 0)
          if (output < 0) break
          try {
            if (info.size in 1..512 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
              val frame = ByteArray(info.size)
              encoder.getOutputBuffer(output)?.apply { position(info.offset); get(frame) }
              if (current.running.get()) emit(frame)
            }
          } finally { encoder.releaseOutputBuffer(output, false) }
        }
      }
    } catch (_: Exception) {
      // A device/route interruption ends capture without retaining audio.
    } finally {
      current.running.set(false)
      input.fill(0)
      synchronized(this) {
        if (capture === current) capture = null
        runCatching { current.recorder.stop() }
        runCatching { current.recorder.release() }
      }
      runCatching { encoder.release() }
    }
  }

  @Synchronized
  fun stopCapture() {
    val current = capture ?: return
    current.running.set(false)
    runCatching { current.recorder.stop() }
  }

  fun play(frame: ByteArray) = synchronized(playbackLock) {
    require(frame.size in 1..512)
    val codec = decoder ?: createPlayback()
    val slot = codec.dequeueInputBuffer(0)
    if (slot >= 0) {
      codec.getInputBuffer(slot)?.apply { clear(); put(frame) }
      codec.queueInputBuffer(slot, 0, frame.size, playbackSamples * 1000000 / RATE, 0)
      playbackSamples += 1024
    }
    val info = MediaCodec.BufferInfo()
    var waitUs = 5000L
    while (true) {
      val output = codec.dequeueOutputBuffer(info, waitUs)
      waitUs = 0
      if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) continue
      if (output < 0) break
      try {
        val data = codec.getOutputBuffer(output)
        if (data != null && info.size > 0) {
          data.position(info.offset)
          track?.write(data, info.size, AudioTrack.WRITE_NON_BLOCKING)
        }
      } finally { codec.releaseOutputBuffer(output, false) }
    }
  }

  private fun createPlayback(): MediaCodec {
    val codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    var output: AudioTrack? = null
    try {
      val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RATE, 1)
      format.setByteBuffer("csd-0", ByteBuffer.wrap(byteArrayOf(0x14, 0x08)))
      codec.configure(format, null, null, 0)
      codec.start()
      val minimum = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minimum > 0)
      output = AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setAudioFormat(AudioFormat.Builder().setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(maxOf(minimum, FRAME_BYTES * 3)).build()
      output.play()
      track = output
      decoder = codec
      return codec
    } catch (error: Exception) {
      output?.release(); codec.release(); throw error
    }
  }

  fun stopPlayback() = synchronized(playbackLock) {
    track?.let { runCatching { it.pause(); it.flush() }; it.release() }
    track = null
    decoder?.release()
    decoder = null
    playbackSamples = 0
  }

  companion object {
    private const val RATE = 16000
    private const val FRAME_BYTES = 2048
  }
}
