package com.oblet.app

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // 返回键 = Esc 语义：注入 keydown(Escape) 进页面，复用桌面端既有链路
    //（关弹窗/设置/搜索 → 多 tab 关当前 → 回欢迎页）。页面 handler 消费时会
    // preventDefault，dispatchEvent 返回 false；未消费（欢迎页）才 finish。
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
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
  }
}
