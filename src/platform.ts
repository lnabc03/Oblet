// 平台探测（安卓适配）：前端唯一的平台判定来源，UI 隐藏/交互降级/字体默认值共用
/** 移动端（Android/iOS WebView） */
export const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent);

/** 粗指针（触屏）环境：hover 类交互需降级为点按（移动设备与桌面触屏均为 true） */
export const COARSE_POINTER =
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;
