package com.oblet.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.Settings
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private val handler = Handler(Looper.getMainLooper())

  // 待投递给前端的文件路径（Intent 到达时前端可能尚未装好接收函数）
  private var pendingOpenPath: String? = null
  private var delivering = false

  // 安全区（CSS px = 物理 px / density）。-1 = 尚未收到 insets
  // 不能依赖 env(safe-area-inset-*)：WebView 的 env() 在 boot 后很晚才从 0 变成真值
  //（实测模拟器 reload 后 1 分钟+ 才生效），用户感知为"刚进入应用按钮被状态栏盖住"
  private var safeTop = -1
  private var safeBottom = -1

  // 「打开文件…」SAF 选择器（应用菜单入口）。mime 按扩展名过滤不可靠（.md 常被
  // 识别成 octet-stream），放 */* 由用户自选；选完走与 Intent 相同的路径解析+投递
  private val openFileLauncher =
    registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
      if (uri == null) return@registerForActivityResult
      val path = resolveToPath(uri)
      if (path != null) {
        pendingOpenPath = path
        tryDeliver()
      } else {
        Toast.makeText(this, "无法解析所选文件的路径：$uri", Toast.LENGTH_LONG).show()
      }
    }

  /** JS 桥：前端 window.ObletNative.pickFile() → SAF 选择器 */
  private inner class ObletJsBridge {
    @android.webkit.JavascriptInterface
    fun pickFile() {
      runOnUiThread { openFileLauncher.launch(arrayOf("*/*")) }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    applyImmersive()

    // D0 路线 B：所有文件访问权限。首次冷启动未授权 → 跳系统设置页引导（一次性成本）
    if (savedInstanceState == null && !Environment.isExternalStorageManager()) {
      try {
        startActivity(
          Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:$packageName"),
          )
        )
      } catch (_: Exception) {
        // 个别 ROM 无应用级页，退到总开关页
        startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
      }
    }

    // 返回键 = Esc 语义：注入 keydown(Escape) 进页面，复用桌面端既有链路
    //（关弹窗/设置/搜索 → 多 tab 关当前 → 回欢迎页）。页面 handler 消费时会
    // preventDefault，dispatchEvent 返回 false；未消费（欢迎页）才退后台。
    // 软键盘打开时系统先把 back 给 IME 收键盘，轮不到这里。
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = webView
        if (wv == null) {
          finish()
          return
        }
        wv.evaluateJavascript(
          "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))",
        ) { result ->
          // result 是 JSON 字符串："true"=无人 preventDefault，"false"=页面已消费
          // 退后台而非 finish：Activity 销毁时 wry 渲染线程会对已析构 mutex
          // 加锁（FORTIFY abort），真机会弹"应用已停止"
          if (result != "false") moveTaskToBack(true)
        }
      }
    })

    handleOpenIntent(intent)
    startSafeAreaLoop()
  }

  // 沉浸式：进入应用即尝试隐藏状态栏（顶缘下滑可临时唤出）。
  // 动机：WebView 的 env(safe-area-inset-top) 在 boot 后很晚才生效，顶部浮层避让
  // 不可靠；隐藏顶栏是根治，隐藏失败的 ROM 上由 CSS 的 --ob-safe-top 全局避让兜底。
  // 隐藏后 WindowInsets top=0，--ob-safe-top 随之归零，布局自动贴顶，无需额外处理。
  private fun applyImmersive() {
    WindowCompat.getInsetsController(window, window.decorView).apply {
      systemBarsBehavior =
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.statusBars())
    }
  }

  // 从系统设置页（权限引导）等返回时系统可能已恢复状态栏，重获焦点时重新隐藏
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) applyImmersive()
  }

  // launchMode=singleTask：App 已在运行时，从文件管理器再点 .md 走这里
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleOpenIntent(intent)
  }

  // 物理键盘 Esc：Android 在到达 WebView 前就吞掉 KEYCODE_ESCAPE（实测模拟器 JS
  // 层完全收不到 keydown），在 Activity 派发入口拦截，注入与返回键相同的 Esc 语义链。
  // 与返回键桥不同：页面未消费时不退后台（对齐桌面——起始页按 Esc 什么都不做）。
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    if (
      event.keyCode == android.view.KeyEvent.KEYCODE_ESCAPE &&
      event.action == android.view.KeyEvent.ACTION_DOWN &&
      event.repeatCount == 0
    ) {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))",
        null,
      )
      return true
    }
    return super.dispatchKeyEvent(event)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView

    // 编辑器自带字号设置，系统字体缩放会把 px 布局整体吹大（按钮大小异常之源）
    webView.settings.textZoom = 100

    // JS 桥：应用菜单「打开文件…」→ SAF 选择器
    webView.addJavascriptInterface(ObletJsBridge(), "ObletNative")

    // 安全区：WindowInsets → CSS 变量 --ob-safe-top/bottom（早于且稳于 env()）
    val density = resources.displayMetrics.density
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val mask =
        WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()
      val navMask =
        WindowInsetsCompat.Type.navigationBars() or WindowInsetsCompat.Type.displayCutout()
      // getInsets 不随隐藏归零（隐藏只翻 isVisible 标志），必须可见才算占位，
      // 否则状态栏已隐藏时布局仍留着安全区（顶部空出一条）
      safeTop =
        if (insets.isVisible(WindowInsetsCompat.Type.statusBars())) {
          Math.round(insets.getInsets(mask).top / density)
        } else {
          0
        }
      safeBottom =
        if (insets.isVisible(WindowInsetsCompat.Type.navigationBars())) {
          Math.round(insets.getInsets(navMask).bottom / density)
        } else {
          0
        }
      injectSafeArea()
      insets
    }
    // setOnApplyWindowInsetsListener 不保证立刻收到当前值：onCreate 里的沉浸式
    // hide 可能已把 insets 改过一轮，主动请求一次重派发拿到最新状态
    ViewCompat.requestApplyInsets(webView)
    // WebView 重建（进程回收等）后若有未投递路径，重新尝试
    tryDeliver()
  }

  /** 把当前安全区写进 :root 内联变量；页面未就绪/被 reload 清掉时由 1.5s 循环兜底 */
  private fun injectSafeArea() {
    val w = webView ?: return
    val t = safeTop
    if (t < 0) return
    w.evaluateJavascript(
      "document.documentElement && (document.documentElement.style.setProperty('--ob-safe-top','${t}px'), document.documentElement.style.setProperty('--ob-safe-bottom','${safeBottom}px'))",
      null,
    )
  }

  /** 常驻兜底：前端 location.reload() 会清掉 :root 内联变量，缺了立刻补回 */
  private fun startSafeAreaLoop() {
    val tick = object : Runnable {
      override fun run() {
        val w = webView
        val t = safeTop
        if (w != null && t >= 0) {
          w.evaluateJavascript(
            "document.documentElement && document.documentElement.style.getPropertyValue('--ob-safe-top') === '' && (document.documentElement.style.setProperty('--ob-safe-top','${t}px'), document.documentElement.style.setProperty('--ob-safe-bottom','${safeBottom}px'))",
            null,
          )
        }
        handler.postDelayed(this, 1500)
      }
    }
    handler.postDelayed(tick, 1500)
  }

  // ---- .md 打开方式：Intent → 真实路径 → 前端 ----

  private fun handleOpenIntent(intent: Intent?) {
    val uri = when (intent?.action) {
      Intent.ACTION_VIEW -> intent.data
      Intent.ACTION_SEND ->
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(Intent.EXTRA_STREAM)
      else -> null
    } ?: return

    val path = resolveToPath(uri)
    if (path != null) {
      pendingOpenPath = path
      tryDeliver()
    } else {
      Toast.makeText(this, "无法解析该来源的文件路径：$uri", Toast.LENGTH_LONG).show()
    }
  }

  /** content/file URI → /sdcard 真实路径（D5：解析不了的来源返回 null，上层提示）。
   *  出口统一 canonicalize：/sdcard 与 /storage/emulated/0 是同一文件系统的两个拼写，
   *  不归一会让同文件在历史/tab 里去重失效 */
  private fun resolveToPath(uri: Uri): String? {
    val raw = resolveRaw(uri) ?: return null
    return try {
      File(raw).canonicalPath
    } catch (_: Exception) {
      raw
    }
  }

  private fun resolveRaw(uri: Uri): String? {
    when (uri.scheme) {
      "file" -> return uri.path
      "content" -> {}
      else -> return null
    }

    // 外部存储文档提供者：content://com.android.externalstorage.documents/document/primary:Documents/a.md
    if (DocumentsContract.isDocumentUri(this, uri)) {
      val docId = DocumentsContract.getDocumentId(uri)
      val split = docId.split(":", limit = 2)
      if (split.size == 2) {
        val (type, rel) = split
        if (type.equals("primary", ignoreCase = true)) {
          return Environment.getExternalStorageDirectory().absolutePath + "/" + rel
        }
        // 外置 SD 卡：/storage/<type>/<rel>
        val sd = File("/storage/$type")
        if (sd.exists()) return sd.absolutePath + "/" + rel
      }
    }

    // MediaStore / 其它 content 提供者：查 DATA 列（有所有文件权限时可拿到真实路径）
    try {
      contentResolver
        .query(uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)
        ?.use { c ->
          if (c.moveToFirst()) {
            val idx = c.getColumnIndex(MediaStore.MediaColumns.DATA)
            if (idx >= 0) {
              val p = c.getString(idx)
              if (!p.isNullOrEmpty()) return p
            }
          }
        }
    } catch (_: Exception) { /* 继续走启发式 */ }

    // 启发式兜底：部分文件管理器把真实路径编进 URI path（…/sdcard/… 或 …/storage/<id>/…）
    val decoded = Uri.decode(uri.toString())
    val m = Regex("""(/storage/[^/]+/.+|/sdcard/.+)""").find(decoded)
    if (m != null) {
      val p = m.groupValues[1]
      if (File(p).exists()) return p
    }
    return null
  }

  /** 轮询等前端装好 __obletOpenFromIntent 再投递（冷启动时 WebView 加载慢于 Intent 到达） */
  private fun tryDeliver() {
    if (delivering) return
    if (webView == null || pendingOpenPath == null) return
    delivering = true
    val attempt = object : Runnable {
      var retries = 0
      override fun run() {
        val w = webView
        val p = pendingOpenPath
        if (w == null || p == null) {
          delivering = false
          return
        }
        w.evaluateJavascript("typeof window.__obletOpenFromIntent === 'function'") { res ->
          if (res == "true") {
            w.evaluateJavascript(
              "window.__obletOpenFromIntent(" + JSONObject.quote(p) + ")",
              null,
            )
            pendingOpenPath = null
            delivering = false
          } else if (retries++ < 100) { // 300ms × 100 ≈ 最多等 30s
            handler.postDelayed(this, 300)
          } else {
            delivering = false
          }
        }
      }
    }
    handler.post(attempt)
  }
}
