package expo.modules.olharnative

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.util.Log
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Áudio em modo "chamada de voz":
 *  - Microfone com fonte VOICE_COMMUNICATION + cancelamento de eco (AEC) do Android:
 *    o app não se ouve pelo alto-falante → não se interrompe sozinho.
 *  - Saída em streaming (PCM 24 kHz) para a voz do Gemini Live e as falas gravadas.
 */
class AudioEngine(
  private val ctx: Context,
  private val onMic: (ByteArray, Double) -> Unit,
  private val onPlayback: (Boolean) -> Unit,
) {
  companion object {
    const val MIC_RATE = 16000
    const val OUT_RATE = 24000
    private const val TAG = "OlharAudio"
  }

  private val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var record: AudioRecord? = null
  private var aec: AcousticEchoCanceler? = null
  private var ns: NoiseSuppressor? = null
  private var agc: AutomaticGainControl? = null
  private var track: AudioTrack? = null
  private var fxTrack: AudioTrack? = null
  private var micThread: Thread? = null
  private var playThread: Thread? = null
  private val queue = LinkedBlockingQueue<ByteArray>()
  private val lock = Object()

  @Volatile private var running = false
  @Volatile var micEnabled = true
  @Volatile private var playing = false
  @Volatile private var framesWritten = 0L
  private var generation = 0

  val usesAec: Boolean get() = aec?.enabled == true

  /** Saída de áudio (não precisa de permissão): o app já pode falar antes de pedir o microfone. */
  fun startOutput() {
    if (running) return
    running = true
    am.mode = AudioManager.MODE_IN_COMMUNICATION
    routeOutput()
    // volume de chamada baixo demais faz a voz sumir no alto-falante
    val maxVol = am.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
    if (am.getStreamVolume(AudioManager.STREAM_VOICE_CALL) < maxVol * 0.7) {
      am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, (maxVol * 0.85).toInt(), 0)
    }

    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val outFmt = AudioFormat.Builder()
      .setSampleRate(OUT_RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
    val minOut = AudioTrack.getMinBufferSize(OUT_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    track = AudioTrack.Builder().setAudioAttributes(attrs).setAudioFormat(outFmt)
      .setBufferSizeInBytes(max(minOut, OUT_RATE * 2 / 5)).setTransferMode(AudioTrack.MODE_STREAM).build()
      .also { it.play() }
    fxTrack = AudioTrack.Builder().setAudioAttributes(attrs).setAudioFormat(outFmt)
      .setBufferSizeInBytes(max(minOut, OUT_RATE)).setTransferMode(AudioTrack.MODE_STREAM).build()
      .also { it.play() }

    playThread = Thread({ playLoop() }, "olhar-play").also { it.start() }
  }

  /** Microfone com cancelamento de eco (precisa da permissão RECORD_AUDIO). */
  @SuppressLint("MissingPermission")
  fun startMic() {
    if (record != null) return
    val minIn = AudioRecord.getMinBufferSize(MIC_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val rec = AudioRecord(
      MediaRecorder.AudioSource.VOICE_COMMUNICATION,
      MIC_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
      max(minIn, MIC_RATE), // ~500 ms
    )
    record = rec
    if (AcousticEchoCanceler.isAvailable()) aec = AcousticEchoCanceler.create(rec.audioSessionId)?.apply { enabled = true }
    if (NoiseSuppressor.isAvailable()) ns = NoiseSuppressor.create(rec.audioSessionId)?.apply { enabled = true }
    if (AutomaticGainControl.isAvailable()) agc = AutomaticGainControl.create(rec.audioSessionId)?.apply { enabled = true }
    Log.i(TAG, "AEC=${aec?.enabled} NS=${ns?.enabled} AGC=${agc?.enabled}")
    rec.startRecording()
    micThread = Thread({ micLoop(rec) }, "olhar-mic").also { it.start() }
  }

  /** Fone com fio/Bluetooth se houver; senão, alto-falante (não o fone de ouvido do telefone). */
  private fun routeOutput() {
    val preferred = listOf(
      AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET,
      AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val devices = am.availableCommunicationDevices
      val dev = preferred.firstNotNullOfOrNull { t -> devices.firstOrNull { it.type == t } }
      if (dev != null) am.setCommunicationDevice(dev)
    } else {
      val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      val headset = outs.any { it.type in preferred.dropLast(1) }
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = !headset
    }
  }

  private fun micLoop(rec: AudioRecord) {
    val buf = ByteArray(MIC_RATE * 2 / 10) // 100 ms
    while (running) {
      var off = 0
      while (off < buf.size && running) {
        val n = rec.read(buf, off, buf.size - off)
        if (n <= 0) break
        off += n
      }
      if (!running || off < buf.size) continue
      if (!micEnabled) continue
      onMic(buf.copyOf(), levelDb(buf))
    }
  }

  private fun levelDb(b: ByteArray): Double {
    var sum = 0.0
    var i = 0
    while (i + 1 < b.size) {
      val s = ((b[i + 1].toInt() shl 8) or (b[i].toInt() and 0xff)).toShort().toDouble()
      sum += s * s
      i += 2
    }
    val rms = sqrt(sum / (b.size / 2)) / 32768.0
    return 20 * log10(rms + 1e-9)
  }

  private fun playLoop() {
    var idleSince = 0L
    while (running) {
      val chunk = queue.poll(60, TimeUnit.MILLISECONDS)
      val t = track ?: continue
      if (chunk != null) {
        idleSince = 0L
        if (!playing) setPlaying(true)
        val gen = synchronized(lock) { generation }
        val n = t.write(chunk, 0, chunk.size)
        // se houve flush durante a escrita, não conta (evita "falando" travado)
        synchronized(lock) { if (gen == generation && n > 0) framesWritten += n / 2 }
      } else if (playing) {
        // fila vazia: terminou quando o hardware tocou tudo que foi escrito
        val now = System.currentTimeMillis()
        if (idleSince == 0L) idleSince = now
        val head = t.playbackHeadPosition.toLong() and 0xffffffffL
        val pending = synchronized(lock) { framesWritten } - head
        // segurança: nunca fica "tocando" além do que ainda faltaria tocar + 600 ms
        if (pending <= 0 || now - idleSince > pending * 1000 / OUT_RATE + 600) setPlaying(false)
      }
    }
  }

  private fun setPlaying(p: Boolean) {
    playing = p
    onPlayback(p)
  }

  /** PCM 16-bit 24 kHz mono. */
  fun enqueue(pcm: ByteArray) {
    var i = 0
    val step = OUT_RATE * 2 / 10
    while (i < pcm.size) {
      queue.put(pcm.copyOfRange(i, minOf(pcm.size, i + step)))
      i += step
    }
  }

  /** Para a fala imediatamente (interrupção). */
  fun flush() {
    queue.clear()
    synchronized(lock) {
      generation++
      track?.let {
        it.pause()
        it.flush()
        it.play()
      }
      framesWritten = (track?.playbackHeadPosition?.toLong() ?: 0L) and 0xffffffffL
    }
    if (playing) setPlaying(false)
  }

  /** Toca um WAV (24 kHz mono) dos assets. Retorna a duração em ms. */
  fun playAssetWav(path: String): Int {
    val bytes = ctx.assets.open(path).use { it.readBytes() }
    // procura o bloco "data" (cabeçalho pode ter outros blocos)
    var p = 12
    while (p + 8 < bytes.size) {
      val id = String(bytes, p, 4)
      val len = (bytes[p + 4].toInt() and 0xff) or ((bytes[p + 5].toInt() and 0xff) shl 8) or
        ((bytes[p + 6].toInt() and 0xff) shl 16) or ((bytes[p + 7].toInt() and 0xff) shl 24)
      if (id == "data") {
        val end = minOf(bytes.size, p + 8 + len)
        enqueue(bytes.copyOfRange(p + 8, end))
        return ((end - p - 8) / 2 * 1000L / OUT_RATE).toInt()
      }
      p += 8 + len
    }
    return 0
  }

  /** Bipe curto num canal separado (não entra na fila da fala). */
  fun tone(freq: Double, ms: Int, vol: Double) {
    val t = fxTrack ?: return
    Thread {
      val n = OUT_RATE * ms / 1000
      val out = ByteArray(n * 2)
      for (i in 0 until n) {
        val env = minOf(1.0, i / 200.0, (n - i) / 300.0)
        val s = (sin(2 * Math.PI * freq * i / OUT_RATE) * vol * env * 32767).toInt()
        out[i * 2] = (s and 0xff).toByte()
        out[i * 2 + 1] = ((s shr 8) and 0xff).toByte()
      }
      t.write(out, 0, out.size)
    }.start()
  }

  fun stop() {
    running = false
    micThread?.join(300)
    playThread?.join(300)
    runCatching { record?.stop() }
    record?.release(); record = null
    aec?.release(); ns?.release(); agc?.release()
    track?.release(); track = null
    fxTrack?.release(); fxTrack = null
    queue.clear()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice()
    am.mode = AudioManager.MODE_NORMAL
  }
}
