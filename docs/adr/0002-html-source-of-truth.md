# HTML 原文与安全渲染分离

Oblet 需要 GitHub README 风格的 HTML 可读性，但不能让浏览器 DOM 反向改写用户源码，也不能执行文档中的主动内容。v0.9.0 决定始终由 Markdown/HTML 原文充当事实源，以保真节点、行内标记和 details 容器承接源码，仅在渲染侧进行消毒、路径解析与交互绑定；放弃完整 HTML DOM 双向编辑和整篇第二预览引擎。
