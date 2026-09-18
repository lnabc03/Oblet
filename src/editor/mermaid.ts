// Mermaid 图表预览：code_block(language=mermaid) 的渲染侧预览，挂在 Crepe 代码块组件
// 的 renderPreview 钩子上（KaTeX 同通道——crepe latex 特性 wrap 后非 latex 语言落到这里）。
// 序列化零感知：文档节点仍是代码块，SVG 只活在预览面板，保存/打印走原文。
// 主题适配：themeVariables 每次渲染时从 body computed --ob-* 读字面值 → 6 主题 × 深浅自动跟随；
// 主题切换由 body 类 MutationObserver 触发全量重渲染。
type Mermaid = typeof import("mermaid").default;
type ApplyPreview = (value: null | string | HTMLElement) => void;

let mermaidP: Promise<Mermaid> | null = null;
const loadMermaid = (): Promise<Mermaid> =>
  (mermaidP ??= import("mermaid").then((m) => {
    m.default.initialize({
      startOnLoad: false,
      securityLevel: "strict", // 禁 HTML 标签/click 事件，SVG 输出可安全 innerHTML（面板另有 DOMPurify 兜底）
      suppressErrorRendering: true, // 语法错误由我们自己画兜底框，不让 mermaid 注入错误图
      theme: "base", // base + themeVariables 才能自定义配色
    });
    return m.default;
  }));

/** 从当前生效主题读字面值配色（body computed 已按 主题×深浅 求值完毕） */
const readThemeVars = (): Record<string, unknown> => {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  const bg = v("--ob-bg", "#1e1e1e");
  const bgAlt = v("--ob-bg-alt", bg);
  const text = v("--ob-text", "#d4d4d4");
  const textMut = v("--ob-text-mut", text);
  const accent = v("--ob-accent", "#7b6cd9");
  const border = v("--ob-border", "rgba(127,127,127,0.3)");
  const dark = document.body.classList.contains("theme-dark");
  // 多色图表（饼/韦恩/git 分支）用的可辨识彩色盘；首色为主题色，深浅通用
  const P = ["#7b6cd9", "#4c9aff", "#63c2a3", "#e8a87c", "#c78fd6", "#5fb3d4", "#e6b84c", "#e88a8a"];
  const pieFill = P.map((c) => c).concat(P.slice(0, 4));
  return {
    darkMode: dark,
    // 用 bg（笔记背景色）而非 transparent：mermaid 多处用 isDark(background) 判断明暗
    //（venn 文字明暗、git 分支明暗等），transparent 会被判成浅色导致深色模式颜色放反；
    // 视觉上 bg 与笔记背景同色，无突兀背景块
    background: bg,
    primaryColor: bgAlt, // 节点填充
    primaryTextColor: text,
    primaryBorderColor: accent,
    secondaryColor: bg,
    secondaryTextColor: textMut,
    tertiaryColor: bg,
    tertiaryTextColor: textMut,
    mainBkg: bgAlt,
    nodeBkg: bgAlt,
    nodeBorder: accent,
    nodeTextColor: text,
    clusterBkg: bg, // 子图底
    clusterBorder: border,
    edgeLabelBackground: bg,
    lineColor: accent,
    textColor: text,
    titleColor: text,
    labelBackground: bg,
    fontFamily: cs.fontFamily,
    // 时序图（actor 头部圆圈走 actorBkg；底部标签框/生命线是硬编码，见 CSS 覆盖）
    actorBkg: bgAlt,
    actorBorder: accent,
    actorTextColor: text,
    actorLineColor: accent,
    signalColor: textMut,
    signalTextColor: text,
    labelBoxBkgColor: bgAlt,
    labelBoxBorderColor: accent,
    labelTextColor: text,
    loopTextColor: text,
    noteBkgColor: bgAlt,
    noteBorderColor: accent,
    noteTextColor: text,
    activationBkgColor: bg,
    activationBorderColor: accent,
    sequenceNumberColor: textMut,
    // 类图关系标签（"持有/读取/实现"这类纯文字节点）
    relationLabelBackground: bgAlt,
    relationLabelColor: text,
    labelBackgroundColor: bgAlt,
    classText: text,
    // 实体关系图表格
    attributeBackgroundColorOdd: bgAlt,
    attributeBackgroundColorEven: bg,
    entityBorder: accent,
    // 甘特（doneTask 会被 base updateColors 重算成 mainContrastColor，见 CSS 覆盖）
    taskBkgColor: bgAlt,
    taskBorderColor: accent,
    taskTextColor: text,
    taskTextLightColor: text,
    taskTextDarkColor: text,
    taskTextOutsideColor: textMut,
    taskTextClickableColor: accent,
    activeTaskBkgColor: accent,
    activeTaskBorderColor: accent,
    todayLineColor: accent,
    sectionBkgColor: bg,
    sectionBkgColor2: bg,
    altSectionBkgColor: bg,
    gridColor: border,
    critBkgColor: "#e06c75",
    critBorderColor: "#e06c75",
    // 饼图（默认从 primary/secondary/tertiary 派生单色系——显式给彩色）
    ...Object.fromEntries(pieFill.map((c, i) => [`pie${i + 1}`, c])),
    pieTitleTextColor: text,
    pieSectionTextColor: dark ? bg : "#ffffff",
    pieLegendTextColor: text,
    pieStrokeColor: bg,
    pieOuterStrokeColor: bg,
    // git 图分支色（darkMode 下 mermaid 会再 lighten 25%）
    ...Object.fromEntries(P.map((c, i) => [`git${i}`, c])),
    commitLabelBackground: bgAlt,
    commitLabelColor: text,
    branchLabelColor: text,
    tagLabelBackground: bgAlt,
    tagLabelColor: text,
    // 韦恩图（默认单色系——显式给彩色）
    ...Object.fromEntries(P.map((c, i) => [`venn${i + 1}`, c])),
    vennTitleTextColor: text,
    vennSetTextColor: text,
    // Cynefin 框架（v12 新图，base 主题默认浅色象限——嵌套对象覆盖为深色系）
    cynefin: {
      complexBg: dark ? "#2c4033" : "#c8e6c9",
      complicatedBg: dark ? "#2c3a4d" : "#bbdefb",
      chaoticBg: dark ? "#4d3232" : "#ffcdd2",
      clearBg: dark ? "#40382a" : "#fff9c4",
      confusionBg: dark ? "#3d334a" : "#d1c4e9",
      cliffColor: "#e06c75",
      boundaryColor: accent,
      arrowColor: accent,
      textColor: text,
      labelColor: text,
    },
    // XY 图表（默认 plotColorPalette 全是浅色——深色下给深色盘）
    xyChart: {
      plotColorPalette: dark
        ? "#7b6cd9,#4c9aff,#63c2a3,#e8a87c,#c78fd6,#5fb3d4,#e6b84c,#e88a8a"
        : "#5a4fb8,#2f6fd6,#2e9e74,#c07a3e,#9a5fb0,#2f7fa0,#b08a1e,#c05555",
    },
    // 需求图
    requirementBackground: bgAlt,
    requirementBorderColor: accent,
    requirementTextColor: text,
    // 象限图
    quadrantTitleFill: text,
    quadrantXAxisTextFill: text,
    quadrantYAxisTextFill: text,
    quadrantPointFill: accent,
    quadrantPointTextFill: text,
    quadrantInternalBorderStrokeFill: accent,
    quadrantExternalBorderStrokeFill: accent,
  };
};

let idSeq = 0;
let inFlight = 0;
const idleWaiters: Array<() => void> = [];
const track = <T>(p: Promise<T>): Promise<T> => {
  inFlight++;
  return p.finally(() => {
    inFlight--;
    if (inFlight === 0) idleWaiters.splice(0).forEach((r) => r);
  });
};
/** 打印链路用：等所有 mermaid 渲染落定（挂载是异步的，打早了会出 Loading 占位） */
export const whenMermaidIdle = (): Promise<void> =>
  inFlight === 0
    ? Promise.resolve()
    : Promise.race([
        new Promise<void>((r) => idleWaiters.push(r)),
        new Promise<void>((r) => setTimeout(r, 4000)), // 兜底防死等
      ]);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const renderSvg = async (content: string): Promise<string> => {
  const mermaid = await loadMermaid();
  // init 指令按次注入配色（v12 render 不再收 config 参数；指令随文本走，天然免疫并发配置串扰），
  // 不改文档原文——只在渲染入参上 prepend
  const themed = `%%{init: ${JSON.stringify({
    theme: "base",
    look: "classic", // v12 部分图默认 neo 外观（节点投影发光），宣传图感过重，回退经典平面风
    themeVariables: readThemeVars(),
  })}}%%\n${content}`;
  const { svg } = await mermaid.render(`ob-mmd-${idSeq++}`, themed);
  return svg;
};

const renderError = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err);
  const firstLine = msg.split("\n")[0].replace(/[:：]\s*$/, ""); // mermaid 报错首行自带冒号尾巴
  return `<div class="ob-mermaid-error">Mermaid 语法错误：${escapeHtml(firstLine)}</div>`;
};

// 活跃预览注册表：content → 该内容的所有 apply 回调（同内容多块共享一次渲染结果）
// 供主题切换全量重渲染；容量封顶防编辑会话残留堆积（只影响"陈旧内容不再跟随主题"，无正确性问题）
const active = new Map<string, Set<ApplyPreview>>();
const ACTIVE_CAP = 120;
const register = (content: string, apply: ApplyPreview) => {
  let set = active.get(content);
  if (!set) {
    if (active.size >= ACTIVE_CAP) active.delete(active.keys().next().value!);
    set = new Set();
    active.set(content, set);
  }
  set.add(apply);
};

const rerenderAll = async () => {
  for (const [content, applies] of active) {
    let html: string;
    try {
      html = `<div class="ob-mermaid">${await track(renderSvg(content))}</div>`;
    } catch (e) {
      html = renderError(e);
    }
    for (const apply of applies) {
      try {
        apply(html);
      } catch {
        /* 组件已卸载 */
      }
    }
  }
};

// 主题切换监听：body 类 swap（深浅/主题身份都走类）→ 防抖全量重渲染
let themeTimer: ReturnType<typeof setTimeout> | null = null;
new MutationObserver(() => {
  if (active.size === 0) return;
  if (themeTimer) clearTimeout(themeTimer);
  themeTimer = setTimeout(() => void rerenderAll(), 150);
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });

/** Crepe 代码块 renderPreview 钩子：mermaid → 异步渲染；其余语言 → null（交还 latex/默认链路） */
export const renderMermaidPreview = (
  language: string,
  content: string,
  applyPreview: ApplyPreview
): null | undefined => {
  if (language.toLowerCase() !== "mermaid" || content.trim().length === 0) return null;
  register(content, applyPreview);
  // undefined = 异步预览，组件先显示 Loading；每次文本变更都会重进这里（打字即重渲染）。
  // 快速连打时旧渲染可能后于新渲染落定（同一块的 apply 都指向同一 ref，短暂陈旧、下次按键自愈）——
  // 单编辑器单光标，同一时刻只有一块在被编辑，可接受。
  void track(renderSvg(content))
    .then((svg) => applyPreview(`<div class="ob-mermaid">${svg}</div>`))
    .catch((e) => applyPreview(renderError(e)));
  return undefined;
};

/** 冒烟钩子：当前注册表大小（验证注册/重渲染路径） */
export const mermaidDebug = { activeCount: () => active.size, rerenderAll };
