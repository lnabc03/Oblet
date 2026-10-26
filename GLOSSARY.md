# Oblet 领域术语表

Oblet 是面向 Markdown 与纯文本文档的轻量编辑器。本表统一产品讨论、技术设计和验收中的领域语言。

## Language

**纯文本模式**：
以字符本身为文档语义的编辑方式，不赋予 Markdown 标记特殊含义。
_Avoid_: TXT 按 Markdown 打开、纯文本预览模式

**文档类型**：
Oblet 根据文件扩展名确定的编辑语义，当前分为 Markdown 文档与 TXT 纯文本文档。
_Avoid_: 文件格式、编辑器模式

**GitHub README 安全渲染兼容**：
对 GitHub README 中常见 HTML 及其与 Markdown 的混排提供安全、可读的渲染，不代表支持任意 HTML、脚本或完整网页行为。
_Avoid_: 任意 HTML 支持、HTML 代码块执行、完整 GitHub 兼容

**HTML 渲染岛**：
文档中保持 HTML 原文不变、仅以安全渲染结果展示的只读区域；其源码可单独编辑，渲染 DOM 不是文档事实源。
_Avoid_: HTML 所见即所得、HTML 预览副本

**序列化保真**：
保存只反映用户实际编辑，不因打开、渲染或切换文档而改写未编辑区域。
_Avoid_: 格式化保存、渲染结果写回
