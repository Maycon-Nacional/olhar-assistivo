package expo.modules.olharnative

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class OlharNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var audio: AudioEngine? = null
  private var camera: CameraEngine? = null
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var utterance = 0

  private val vibrator: Vibrator
    get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

  override fun definition() = ModuleDefinition {
    Name("OlharNative")
    Events("onMic", "onPlayback", "onSpeech")

    // 1) Saída de áudio + voz do sistema (sem permissão): o app já fala ao abrir.
    Function("startOutput") {
      if (audio == null) {
        audio = AudioEngine(
          context,
          onMic = { pcm, db ->
            sendEvent("onMic", mapOf("data" to Base64.encodeToString(pcm, Base64.NO_WRAP), "level" to db))
          },
          onPlayback = { playing -> sendEvent("onPlayback", mapOf("playing" to playing)) },
        ).also { it.startOutput() }
      }
      if (tts == null) initTts()
    }

    // 2) Microfone (com cancelamento de eco) + câmera. Chamar depois das permissões.
    AsyncFunction("startInput") {
      audio?.startMic()
      if (camera == null) {
        val owner = appContext.currentActivity as? LifecycleOwner ?: throw Exceptions.MissingActivity()
        camera = CameraEngine(context).also { it.start(owner) }
      }
      mapOf("aec" to (audio?.usesAec ?: false))
    }.runOnQueue(Queues.MAIN)

    Function("setMicEnabled") { on: Boolean -> audio?.micEnabled = on }
    Function("playPcm") { b64: String -> audio?.enqueue(Base64.decode(b64, Base64.DEFAULT)) }
    Function("flush") { audio?.flush() }
    Function("playVoice") { name: String -> audio?.playAssetWav("voice/$name.wav") ?: 0 }
    Function("tone") { freq: Double, ms: Int, vol: Double -> audio?.tone(freq, ms, vol) }

    AsyncFunction("getFrame") { maxWidth: Int, quality: Int ->
      camera?.getFrameJpeg(maxWidth, quality)
    }

    // Vibração forte e confiável (não depende da configuração "vibração ao toque" do sistema).
    // pattern = [ligado, desligado, ligado, ...] em ms
    Function("vibrate") { pattern: List<Int>, strength: Int ->
      val timings = LongArray(pattern.size + 1)
      val amps = IntArray(pattern.size + 1)
      pattern.forEachIndexed { i, ms ->
        timings[i + 1] = ms.toLong()
        amps[i + 1] = if (i % 2 == 0) strength.coerceIn(1, 255) else 0
      }
      if (vibrator.hasAmplitudeControl()) vibrator.vibrate(VibrationEffect.createWaveform(timings, amps, -1))
      else vibrator.vibrate(VibrationEffect.createWaveform(timings, -1))
    }

    // Voz do sistema (offline): reserva quando falta alguma fala gravada.
    Function("speak") { text: String, rate: Double ->
      val t = tts ?: return@Function
      if (!ttsReady) return@Function
      t.setSpeechRate(rate.toFloat())
      t.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "u${++utterance}")
    }
    Function("stopSpeak") { tts?.stop() }

    Function("stop") { shutdown() }
    OnDestroy { shutdown() }
  }

  private fun initTts() {
    tts = TextToSpeech(context) { status ->
      if (status != TextToSpeech.SUCCESS) return@TextToSpeech
      val t = tts ?: return@TextToSpeech
      t.language = Locale.forLanguageTag("pt-BR")
      // mesma rota da conversa (alto-falante/fone), e entra no cancelamento de eco
      t.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) { sendEvent("onSpeech", mapOf("speaking" to true)) }
        override fun onDone(id: String?) { sendEvent("onSpeech", mapOf("speaking" to false)) }
        @Deprecated("Deprecated in Java")
        override fun onError(id: String?) { sendEvent("onSpeech", mapOf("speaking" to false)) }
        override fun onStop(id: String?, interrupted: Boolean) { sendEvent("onSpeech", mapOf("speaking" to false)) }
      })
      ttsReady = true
    }
  }

  private fun shutdown() {
    camera?.stop(); camera = null
    audio?.stop(); audio = null
    tts?.shutdown(); tts = null
    ttsReady = false
  }
}
