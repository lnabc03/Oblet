// 序列化管线级 round-trip 验证：模拟 Milkdown 的 remark parse/stringify，
// 套用与 tuneSerialization 相同的 options，重点验证硬换行写回普通换行。
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import remarkFrontmatter from 'remark-frontmatter'

const keepObsidianSyntax = (node, _parent, state, info) =>
  state
    .safe(node.value ?? '', info)
    .replace(/\\\[(?=!)/g, '[')
    .replace(/\\=(?==)/g, '=')

const breakAsPlainNewline = () => '\n'

const options = {
  rule: '-',
  bullet: '-',
  handlers: { text: keepObsidianSyntax, break: breakAsPlainNewline },
}

const run = (input) =>
  unified()
    .use(remarkParse)
    .use(remarkFrontmatter, 'yaml')
    .use(remarkStringify, options)
    .processSync(input)
    .toString()

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

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
