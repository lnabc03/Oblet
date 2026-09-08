// 过渡动画开关的同步前置（首帧前执行，经典脚本非 module）
// 模块脚本是 deferred：Esc 退起始页/追加 tab 触发 location.reload() 时窗口已可见，
// 等 main.ts 异步 get_settings 回来再摘 splash 会闪一帧动画。
// 设置面板切换与 main.ts 启动时把生效值镜像进 localStorage，这里同步读取，
// 在首帧渲染前给 <html> 挂上 ob-no-splash 类（CSS 隐藏 splash 节点）。
try {
  if (localStorage.getItem("oblet.transition_animation") !== "true") {
    document.documentElement.classList.add("ob-no-splash");
  }
} catch (e) {
  /* localStorage 不可用时按显示处理，主链路不受影响 */
}

// 主题镜像（多主题一期）：applyTheme 把解析后的 dark/light 镜像进 localStorage，
// 这里在首帧前挂到 <html>，驱动 index.html 内联的 splash 双色样式防闪
try {
  if (localStorage.getItem("oblet.theme") === "light") {
    document.documentElement.classList.add("ob-theme-light");
  }
} catch (e) {
  /* 同上：按深色处理 */
}
