package expo.modules.olharnative

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Base64
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * Câmera "sem obturador": CameraX analisa quadros continuamente e guarda o último.
 * getFrameJpeg() devolve esse quadro na hora (sem esperar foto nem som de obturador).
 */
class CameraEngine(private val ctx: Context) {
  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var latest: Bitmap? = null
  private var provider: ProcessCameraProvider? = null

  fun start(owner: LifecycleOwner) {
    val future = ProcessCameraProvider.getInstance(ctx)
    future.addListener({
      val p = future.get()
      provider = p
      val analysis = ImageAnalysis.Builder()
        .setResolutionSelector(
          ResolutionSelector.Builder()
            .setResolutionStrategy(ResolutionStrategy(Size(1280, 960), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
            .build()
        )
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
        .build()
      analysis.setAnalyzer(executor) { img ->
        try {
          val bmp = img.toBitmap()
          val rot = img.imageInfo.rotationDegrees
          latest = if (rot != 0) {
            Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rot.toFloat()) }, true)
          } else bmp
        } catch (e: Exception) {
          Log.w("OlharCamera", "quadro", e)
        } finally {
          img.close()
        }
        // não precisa de 30 quadros/s só para guardar o último: economiza bateria
        Thread.sleep(150)
      }
      p.unbindAll()
      p.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, analysis)
    }, ContextCompat.getMainExecutor(ctx))
  }

  /** Último quadro em JPEG base64 (instantâneo). */
  fun getFrameJpeg(maxWidth: Int, quality: Int): String? {
    val src = latest ?: return null
    val scaled = if (src.width > maxWidth) {
      Bitmap.createScaledBitmap(src, maxWidth, (src.height * maxWidth.toFloat() / src.width).toInt(), true)
    } else src
    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }

  fun stop() {
    runCatching { provider?.unbindAll() }
  }
}
