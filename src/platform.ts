// 平台探测（安卓适配）：前端唯一的平台判定来源，UI 隐藏/交互降级/字体默认值共用
/** 移动端（Android/iOS WebView） */
export const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent);

/** 粗指针（触屏）环境：hover 类交互需降级为点按（移动设备与桌面触屏均为 true）。
 *  注意不能只看 (pointer: coarse)：接了鼠标的安卓模拟器上报 fine，
 *  但 hover: none 同样是"无悬停能力"——真机两者必中其一，桌面鼠标皆否 */
export const COARSE_POINTER =
  typeof window.matchMedia === "function" &&
  (window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches);
