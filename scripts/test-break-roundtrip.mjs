// 序列化管线级 round-trip 验证：模拟 Milkdown 的 remark parse/stringify，
// 套用与 tuneSerialization 相同的 options，重点验证硬换行写回普通换行。
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import { defaultHandlers } from 'mdast-util-to-markdown'

// 与 src/editor/frontmatter.ts 的 keepObsidianSyntax 保持同步（含 unescapeIntrawordUnderscores）
const cmWhitespace = /[\p{Zs}\t\n\f\r]/u
const cmPunctuation = /[\p{P}\p{S}]/u

const unescapeIntrawordUnderscores = (value, before, after) => {
  let out = ''
  let i = 0
  while (i < value.length) {
    if (value[i] !== '\\' || value[i + 1] !== '_') {
      out += value[i++]
      continue
    }
    let runLen = 0
    while (value[i + runLen * 2] === '\\' && value[i + runLen * 2 + 1] === '_') runLen++
    const prev = out.length > 0 ? out[out.length - 1] : before
    const next = i + runLen * 2 < value.length ? value[i + runLen * 2] : after
    const isWs = (ch) => ch === '' || cmWhitespace.test(ch)
    const isPunct = (ch) => ch !== '' && cmPunctuation.test(ch)
    const leftFlanking = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev))
    const rightFlanking = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next))
    const canOpen = leftFlanking && (!rightFlanking || isPunct(prev))
    const canClose = rightFlanking && (!leftFlanking || isPunct(next))
    let keepEscape = canOpen || canClose
    if (!keepEscape) {
      const lineBefore = out.slice(out.lastIndexOf('\n') + 1)
      const rest = value.slice(i + runLen * 2)
      const eol = rest.search(/[\r\n]/)
      const lineAfter = eol === -1 ? rest : rest.slice(0, eol)
      const atLineStart = out.includes('\n') || before === '' || cmWhitespace.test(before)
      const line = (lineBefore + '_'.repeat(runLen) + lineAfter).replace(/\\_/g, '_')
      const underscoreCount = line.split('_').length - 1
      keepEscape = atLineStart && /^[ \t_]*$/.test(line) && underscoreCount >= 3
    }
    out += keepEscape ? '\\_'.repeat(runLen) : '_'.repeat(runLen)
    i += runLen * 2
  }
  return out
}

const unescapeWikilinks = {
  regex: /\\\[\\\[/g,
  replacer: (match, offset, whole) => {
    const rest = whole.slice(offset + match.length)
    const close = rest.indexOf(']]')
    return close !== -1 && rest[close + 2] === '(' ? match : '[['
  },
}

const unescapeLineStartHash = (match, next) =>
  next === '' || next === '#' || cmWhitespace.test(next) ? match : '#' + next

const entityReferenceStart = /^(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);/
const unescapeNonEntityAmp = (match, offset, whole) =>
  entityReferenceStart.test(whole.slice(offset + match.length)) ? match : '&'

// 与 src/editor/frontmatter.ts 的 unescapeMarkerRuns / keepStarEscape /
// keepTildeEscape 保持同步（\* 与单 \~ 转义收紧）
const isWs = (ch) => ch === '' || cmWhitespace.test(ch)
const isPunct = (ch) => ch !== '' && cmPunctuation.test(ch)

const unescapeMarkerRuns = (value, before, after, marker, keep) => {
  let out = ''
  let i = 0
  while (i < value.length) {
    if (value[i] === '\\' && value[i + 1] === '\\') {
      out += '\\\\'
      i += 2
      continue
    }
    if (value[i] !== '\\' || value[i + 1] !== marker) {
      out += value[i++]
      continue
    }
    let runLen = 0
    while (value[i + runLen * 2] === '\\' && value[i + runLen * 2 + 1] === marker) runLen++
    const prev = out.length > 0 ? out[out.length - 1] : before
    const next = i + runLen * 2 < value.length ? value[i + runLen * 2] : after
    const lineBefore = out.slice(out.lastIndexOf('\n') + 1)
    const atLineStart =
      lineBefore === '' && (out.includes('\n') || before === '' || cmWhitespace.test(before))
    out += keep({ prev, next, runLen, atLineStart })
      ? ('\\' + marker).repeat(runLen)
      : marker.repeat(runLen)
    i += runLen * 2
  }
  return out
}

const keepStarEscape = (inEmphasis) => ({ prev, next, atLineStart }) => {
  const leftFlanking = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev))
  if (leftFlanking || atLineStart) return true
  if (inEmphasis) {
    const rightFlanking = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next))
    if (rightFlanking) return true
  }
  return false
}

const keepTildeEscape = ({ runLen }) => runLen >= 2

const keepObsidianSyntax = (node, _parent, state, info) => {
  const base = unescapeIntrawordUnderscores(state.safe(node.value ?? '', info), info.before, info.after)
  const inEmphasis = state.stack.includes('strong') || state.stack.includes('emphasis')
  return unescapeMarkerRuns(
    unescapeMarkerRuns(base, info.before, info.after, '*', keepStarEscape(inEmphasis)),
    info.before,
    info.after,
    '~',
    keepTildeEscape
  )
    .replace(/\\\[(?=!)/g, '[')
    .replace(/\\=(?==)/g, '=')
    .replace(unescapeWikilinks.regex, unescapeWikilinks.replacer)
    .replace(/\\#(.|$)/g, unescapeLineStartHash)
    .replace(/\\&/g, unescapeNonEntityAmp)
}

const breakAsPlainNewline = () => '\n'

// 与 src/editor/frontmatter.ts 的 tableCompact 保持同步：
// 紧凑表格序列化（| a | b | + |---|---|），不做列宽 padding 对齐
const tableCompact = (node, _parent, state, info) => {
  const rows = node.children
  const colCount = Math.max(...rows.map((r) => r.children.length))
  const cellText = (cell) => {
    const exit = state.enter('tableCell')
    const subexit = state.enter('phrasing')
    const value = state.containerPhrasing(cell, { ...info, before: ' ', after: ' ' })
    subexit()
    exit()
    return value
  }
  const lines = rows.map((row) => {
    const cells = []
    for (let i = 0; i < colCount; i++) cells.push(row.children[i] ? cellText(row.children[i]) : '')
    return '|' + cells.map((c) => (c === '' ? ' ' : ' ' + c + ' ')).join('|') + '|'
  })
  const delim = (a) =>
    a === 'center' ? ':---:' : a === 'left' ? ':---' : a === 'right' ? '---:' : '---'
  const delims = []
  for (let i = 0; i < colCount; i++) delims.push(delim(node.align?.[i]))
  lines.splice(1, 0, '|' + delims.join('|') + '|')
  return lines.join('\n')
}

// 与 src/editor/frontmatter.ts 的 joinTightLists / joinParagraphToList 保持同步
const joinTightLists = (left, right, parent) => {
  const spread = parent.spread
  if (spread == null) return
  if (left.type === 'paragraph' && (right.type === 'paragraph' || right.type === 'definition'))
    return
  return spread === true || spread === 'true' ? 1 : 0
}

const joinParagraphToList = (left, right, parent) => {
  if (left.type !== 'paragraph' || right.type !== 'list') return
  if (parent.spread != null) return
  if (right.ordered && right.start != null && right.start !== 1) return 1
  return 0
}

// 与 src/editor/frontmatter.ts 的 linkKeepBare 保持同步：
// GFM literal autolink（裸 URL/www/email）还原裸写，其余回落默认 link 处理器
const linkKeepBare = (node, parent, state, info) => {
  const only = node.children?.length === 1 ? node.children[0] : undefined
  const text = only?.type === 'text' ? only.value : undefined
  if (
    node.title == null && node.url != null && text != null &&
    (text === node.url || 'http://' + text === node.url || 'mailto:' + text === node.url)
  ) {
    return text
  }
  return defaultHandlers.link(node, parent, state, info)
}

const options = {
  rule: '-',
  bullet: '-',
  join: [joinTightLists, joinParagraphToList],
  handlers: {
    text: keepObsidianSyntax,
    break: breakAsPlainNewline,
    link: linkKeepBare,
    table: tableCompact,
  },
}

const run = (input) =>
  unified()
    .use(remarkParse)
    // singleTilde:false 与 tuneSerialization 同步（对齐 Obsidian：单 ~ 非删除线）
    .use(remarkGfm, { singleTilde: false })
    .use(remarkFrontmatter, 'yaml')
    .use(remarkStringify, options)
    .processSync(input)
    .toString()

// 文件模式：node scripts/test-break-roundtrip.mjs <file.md>
// 对真实文档跑 parse→serialize 往返，打印 diff 统计（验证真实语料零污染）
if (process.argv[2]) {
  const fs = await import('node:fs')
  const src = fs.readFileSync(process.argv[2], 'utf8')
  const once = run(src)
  const twice = run(once)
  console.log(`首轮${once === src ? '零改动' : '有归一化'}，二轮${twice === once ? '稳定' : '不稳定！'}`)
  if (once !== src) {
    const a = src.split('\n'), b = once.split('\n')
    let shown = 0
    const max = Math.max(a.length, b.length)
    for (let i = 0; i < max && shown < 20; i++) {
      if (a[i] !== b[i]) {
        shown++
        console.log(`  L${i + 1} 原: ${JSON.stringify(a[i] ?? '<缺失>')}`)
        console.log(`  L${i + 1} 新: ${JSON.stringify(b[i] ?? '<缺失>')}`)
      }
    }
    console.log(`  …共 ${max} 行内差异行 ${shown >= 20 ? '超 20 处（截断）' : shown + ' 处'}`)
  }
  process.exit(once === src && twice === once ? 0 : 1)
}

let failed = 0
const check = (name, input, expected) => {
  const out = run(input)
  const ok = out === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) {
    console.log('  输入:    ' + JSON.stringify(input))
    console.log('  期望:    ' + JSON.stringify(expected))
    console.log('  实际:    ' + JSON.stringify(out))
  }
}

// 硬换行（\ 写法）→ 普通换行
check('backslash break', '第一行\\\n第二行\n', '第一行\n第二行\n')
// 硬换行（两空格写法）→ 普通换行
check('two-space break', '第一行  \n第二行\n', '第一行\n第二行\n')
// 软换行原样保留
check('soft break', '第一行\n第二行\n', '第一行\n第二行\n')
// 段内软换行 + 后续段落
check('break then paragraph', '第一行\\\n第二行\n\n第三段\n', '第一行\n第二行\n\n第三段\n')
// 列表项内硬换行
check('break in list item', '- 甲\\\n  乙\n', '- 甲\n  乙\n')
// 行尾 \ + 空行：不是硬换行而是字面反斜杠（CommonMark 语义），
// 序列化转义为 \\ 才能往返稳定
check('literal trailing backslash', '第一行\\\n\n第二段\n', '第一行\\\\\n\n第二段\n')
// 回归：callout / 高亮 / hr / frontmatter 不被破坏
check('callout', '> [!note] 标题\n> 内容\n', '> [!note] 标题\n> 内容\n')
check('highlight at line start', '==高亮== 开头\n', '==高亮== 开头\n')
check('hr stays ---', '***\n', '---\n')
check(
  'frontmatter round-trip',
  '---\ncreated: 2026-07-30\n---\n\n正文\n',
  '---\ncreated: 2026-07-30\n---\n\n正文\n'
)
// 词内下划线：不可能构成强调，转义撤销（首次保存归一化，之后字节稳定）
check('underscore intraword CJK', '测试_测试\n', '测试_测试\n')
check('underscore intraword ASCII', 'hello_world\n', 'hello_world\n')
check('underscore multi', 'a_b_c\n', 'a_b_c\n')
check('underscore double intraword', '测试__测试\n', '测试__测试\n')
check('underscore legacy escape normalized', 'snake\\_case\\_name\n', 'snake_case_name\n')
check('underscore isolated between spaces', 'a _ b\n', 'a _ b\n')
check('underscore near CJK punct', 'foo\\_bar，baz\\_qux。\n', 'foo_bar，baz_qux。\n')
// 确实能开/闭强调的下划线：转义保留
check('underscore can open kept', '变量 \\_temp\\_ 的值\n', '变量 \\_temp\\_ 的值\n')
check('underscore single open kept', '行首 \\_x 测试\n', '行首 \\_x 测试\n')
check('underscore line end kept', '结束\\_\n', '结束\\_\n')
check('underscore line start kept', '\\_开头\n', '\\_开头\n')
check('underscore in parens kept', '(\\_foo\\_)\n', '(\\_foo\\_)\n')
// 分隔线风险：整行只剩 _ 与空白，转义保留
check('underscore hr risk line start', '\\_\\_\\_\n', '\\_\\_\\_\n')
check('underscore hr risk spaced', '\\_ \\_ \\_\n', '\\_ \\_ \\_\n')
check('underscore hr risk in list', '- \\_\\_\\_\n', '- \\_\\_\\_\n')
// wikilink / embed：\[ 转义破坏 Obsidian 双链，撤销（首次保存归一化，之后字节稳定）
check('wikilink', '[[链接]]\n', '[[链接]]\n')
check('wikilink alias', '[[链接|别名]]\n', '[[链接|别名]]\n')
check('wikilink in sentence', '参见 [[笔记A]] 和 [[笔记B]]。\n', '参见 [[笔记A]] 和 [[笔记B]]。\n')
check('embed', '![[图片.png]]\n', '![[图片.png]]\n')
// 源文件转义写的 [[a]]\(url\)：safe() 保证 ] 后的 ( 必被转义（unsafe.js:79，
// before:\] 规则），重解析仍是字面文本，[[ 可安全撤销
check('wikilink escaped paren', '[[a]]\\(url\\)\n', '[[a]]\\(url)\n')
// 裸写的 [[a]](url) 在解析期就被 CommonMark 当成链接文字为 [a] 的链接（AST 级
// 丢失 Obsidian 的 wikilink+(url) 语义，非序列化能挽回），链接文字内 \[ 保持转义
check('wikilink before link normalized', '[[a]](https://x.com)\n', '[\\[a\\]](https://x.com)\n')
// 行首 #标签：# 后非空白非 # 时不可能构成 ATX 标题，撤销转义
check('tag at line start', '#标签\n', '#标签\n')
check('tag after soft break', '第一行\n#tag 第二行\n', '第一行\n#tag 第二行\n')
check('tag in list item', '- #标签\n', '- #标签\n')
// ##tag / # 后随空白：保守保留转义
check('double hash tag kept', '##tag\n', '\\##tag\n')
// & 收紧：仅当真构成实体引用时保留转义
check('ampersand word', 'R&D 部门\n', 'R&D 部门\n')
check('ampersand hash', 'C&# 记号\n', 'C&# 记号\n')
check('ampersand AT&T', 'AT&T 公司\n', 'AT&T 公司\n')
check('named entity kept', '字面 \\&amp; 保留\n', '字面 \\&amp; 保留\n')
check('numeric entity kept', '字面 \\&#60; 保留\n', '字面 \\&#60; 保留\n')
// GFM literal autolink：裸 URL / www / email 还原裸写
check('bare url', '访问 https://example.com/page?q=1 查看\n', '访问 https://example.com/page?q=1 查看\n')
check('bare www', '访问 www.example.com 查看\n', '访问 www.example.com 查看\n')
check('bare email', '联系 foo@bar.com 咨询\n', '联系 foo@bar.com 咨询\n')
// 普通链接不受影响（非 autolink 形态，回落默认处理器）
check('normal link', '[文字](https://x.com)\n', '[文字](https://x.com)\n')
check('link with title', '[文字](https://x.com "标题")\n', '[文字](https://x.com "标题")\n')

// ---- 0.6.1：报告实案转义噪音（ref/md_serializer_bugreport）----
// 单 ~（singleTilde:false 下永不构成语法）：转义撤销
check('tilde lone in bold', '**深度是突变核的 ~2 倍**\n', '**深度是突变核的 ~2 倍**\n')
check('tilde pair unpaired', '（拐点 ~2–3k vs ~6–10k 核）\n', '（拐点 ~2–3k vs ~6–10k 核）\n')
check('tilde between plus', 'df_to_lr +2.4~+2.6；\n', 'df_to_lr +2.4~+2.6；\n')
// ~~ 删除线本体不受影响；字面 ~~ 保持转义
check('strikethrough kept', '~~删除~~\n', '~~删除~~\n')
check('literal double tilde kept', 'a \\~\\~b\\~\\~ c\n', 'a \\~\\~b\\~\\~ c\n')
// *：非 left-flanking（不可能开启强调）撤销转义；词内 left-flanking 保守保留
check('star trailing in cell', '| Microglia* | x |\n|---|---|\n', '| Microglia* | x |\n|---|---|\n')
check('star between spaces normalized', 'a \\* b\n', 'a * b\n')
check('star intraword kept', 'a\\*b\n', 'a\\*b\n')
// 行首保守保留：列表 / 分隔线风险
check('star line start list risk kept', '\\* foo\n', '\\* foo\n')
check('star hr risk kept', '\\*\\*\\*\n', '\\*\\*\\*\n')
// 强调/加粗内部：closer-capable 的 * run 会与外层结构性 opener 配对（定界符匹配
// 是段落级全局行为）——转义是承重墙，必须保留（0.6.1 第二轮验收实案）
check(
  'star escaped inside strong kept',
  '**图注（\\* FDR<0.25，\\*\\* FDR<0.05），+2.26\\*\\*、CI +1.98\\*\\*）。**\n',
  '**图注（\\* FDR<0.25，\\*\\* FDR<0.05），+2.26\\*\\*、CI +1.98\\*\\*）。**\n'
)
// 强调内部 closer-only 的 *（剥离会提前闭合强调）必须保留
check(
  'star escaped inside emphasis kept',
  '*前文 后文\\* 尾巴*\n',
  '*前文 后文\\* 尾巴*\n'
)
// 强调内部两侧空白的 *（不可能开/闭）：剥离安全
check(
  'star inside emphasis spaces stripped',
  '*前文 \\* 后文*\n',
  '*前文 * 后文*\n'
)
// 对照：无强调上下文时裸 * 无配对对象，剥离安全
check('star bare outside emphasis ok', '（* 普通段落的裸星号）\n', '（* 普通段落的裸星号）\n')
check('star escaped outside emphasis stripped', '（\\* 裸星号）\n', '（* 裸星号）\n')
// 强调内部但两侧空白（不可能开/闭）：仍可剥离
check('star inside strong spaces stripped', '**加粗 a \\* b 尾巴**\n', '**加粗 a * b 尾巴**\n')

// ---- 0.6.1：表格紧凑序列化 ----
// 紧凑手写表格字节级不变（含 CJK，不再有宽度计算）
check(
  'table compact identical',
  '| 样本 | 基因型 | 核数 |\n|---|---|---|\n| WT | Opa1+/+ | 2,944 |\n',
  '| 样本 | 基因型 | 核数 |\n|---|---|---|\n| WT | Opa1+/+ | 2,944 |\n'
)
// 对齐冒号语义保留
check(
  'table align kept',
  '| 左 | 中 | 右 |\n|:---|:---:|---:|\n| 1 | 2 | 3 |\n',
  '| 左 | 中 | 右 |\n|:---|:---:|---:|\n| 1 | 2 | 3 |\n'
)
// padding 对齐过的表格归一化为紧凑形态（一次性，之后稳定）
check(
  'table padded normalized',
  '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n',
  '| a | b |\n|---|---|\n| 1 | 2 |\n'
)
// 幂等：归一化产物第二轮字节不变（check 会把第一个参数再过一遍管线）
check(
  'table padded idempotent',
  run('| 左   | 中  | 右  |\n| :--- | :-: | --: |\n| 1    | 2   | 3   |\n'),
  '| 左 | 中 | 右 |\n|:---|:---:|---:|\n| 1 | 2 | 3 |\n'
)
// 空单元格（单空格形态 | |）
check(
  'table empty cell',
  '| a | b |\n|---|---|\n| 1 | |\n',
  '| a | b |\n|---|---|\n| 1 | |\n'
)

// ---- 0.6.1：段落直接接列表不插空行 ----
check(
  'paragraph then bullet list',
  '回答：\n- 甲\n- 乙\n',
  '回答：\n- 甲\n- 乙\n'
)
check(
  'paragraph then ordered list',
  '步骤：\n1. 甲\n2. 乙\n',
  '步骤：\n1. 甲\n2. 乙\n'
)
// start≠1 的有序列表不能中断段落：保留空行防粘连
check(
  'paragraph then ordered list start 2',
  '接上文：\n\n2. 甲\n3. 乙\n',
  '接上文：\n\n2. 甲\n3. 乙\n'
)
// 紧凑列表内部不受新 join 影响（joinTightLists 裁决）
check('tight list unaffected', '- 甲\n- 乙\n', '- 甲\n- 乙\n')

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
