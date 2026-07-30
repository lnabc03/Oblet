// 验证任务列表修复方案：
// A. join 处理器容忍字符串形态 spread → 紧凑列表项间无空行
// B. 解析侧 remark 插件修剪任务项勾选框后多余前导空格 → 无 &#x20; 污染
// 模拟 Milkdown PM 往返：spread 布尔被存为字符串属性。
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'

const SOURCE = `**MT-AMD课题**
- [x] 文献/数据库/工具调研
- [x] 课题初步讨论
- [x] phase3-mitoPPS算法重现与分析应用（**补图**）
- [x]  phase4-kira算法测试
- [ ]  phase5-GSE数据交叉验证
`

// ---- 解析侧修剪：任务项首段首文本的残留前导空格（勾选框消耗一个后的剩余）----
const trimTaskItemSpace = () => (tree) => {
  const visit = (node) => {
    if (node.type === 'listItem' && typeof node.checked === 'boolean') {
      const para = node.children?.[0]
      const head = para?.type === 'paragraph' ? para.children?.[0] : undefined
      if (head?.type === 'text' && head.value.startsWith(' ')) {
        head.value = head.value.replace(/^ +/, '')
        if (head.value === '') para.children.shift()
      }
    }
    node.children?.forEach(visit)
  }
  visit(tree)
}

// ---- join 处理器：与 joinDefaults 同逻辑，但容忍字符串形态 spread ----
const joinTightLists = (left, right, parent) => {
  if ('spread' in parent && parent.spread != null) {
    if (left.type === 'paragraph' && right.type === 'paragraph') return
    const spread = parent.spread === true || parent.spread === 'true'
    return spread ? 1 : 0
  }
}

const keepObsidianSyntax = (node, _parent, state, info) =>
  state
    .safe(node.value ?? '', info)
    .replace(/\\\[(?=!)/g, '[')
    .replace(/\\=(?==)/g, '=')

const optionsFixed = {
  rule: '-',
  bullet: '-',
  join: [joinTightLists],
  handlers: { text: keepObsidianSyntax, break: () => '\n' },
}

const roundTrip = (input) =>
  unified()
    .use(remarkParse)
    .use(remarkFrontmatter, 'yaml')
    .use(remarkGfm)
    .use(trimTaskItemSpace) // 解析侧修剪（真实应用中在 Milkdown parse 管线内生效）
    .use(remarkStringify, optionsFixed)
    .processSync(input)
    .toString()

// 上述管线直接 processSync 不含 PM spread 字符串化模拟，单独模拟一次：
const simulatePmSpread = (node) => {
  if (node.type === 'list' && node.spread != null) node.spread = String(node.spread)
  node.children?.forEach(simulatePmSpread)
  return node
}

const fullRoundTrip = (input) => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, 'yaml')
    .use(remarkGfm)
    .use(trimTaskItemSpace)
    .use(remarkStringify, optionsFixed)
  const tree = processor.parse(input)
  const transformed = processor.runSync(tree)
  simulatePmSpread(transformed) // PM 属性层：list.spread 变字符串
  return processor.stringify(transformed)
}

const after = fullRoundTrip(SOURCE)
console.log('===== 修复后 =====')
console.log(after)

let failed = 0
const check = (name, actual, expected) => {
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) {
    console.log('  期望: ' + JSON.stringify(expected))
    console.log('  实际: ' + JSON.stringify(actual))
  }
}

check('列表项间无空行', after.includes('文献/数据库/工具调研\n- [x]'), true)
check('无 &#x20;', after.includes('&#x20;'), false)
check('勾选状态保留 x', after.includes('- [x] phase4'), true)
check('勾选状态保留 空格', after.includes('- [ ] phase5'), true)
check('标题后保持默认段落间距', after.startsWith('**MT-AMD课题**\n\n-'), true)
check('往返稳定', fullRoundTrip(after), after)

// 宽松列表（源文件项间本有空行）不应被压成紧凑
const LOOSE = `- a\n\n- b\n`
const looseAfter = fullRoundTrip(LOOSE)
check('宽松列表保持空行', looseAfter, `- a\n\n- b\n`)

process.exit(failed ? 1 : 0)
