// Frontmatter（YAML 头）支持与序列化保真
// 1. remark-frontmatter：--- YAML 头解析为独立 yaml 节点（不再被当成 hr / setext 标题），
//    序列化时原样写回 --- 围栏
// 2. frontmatterSchema：yaml 节点映射为可编辑文本节点（code 模式，多行直接编辑）
// 3. tuneSerialization：保存不侵入原文 —— hr 写 --- 不写 ***、列表符号用 -；
//    自定义 text 处理器撤销三类破坏原文的过度转义：
//    \[! → [! （callout 标记，转义后 Obsidian 不再识别）
//    \== → ==（行首高亮，转义后 == 变字面文本）
//    \_ → _（词内下划线，按 CommonMark flanking 规则不可能构成强调时）
//    其余转义（\*、\[x 等）在 Obsidian 中渲染等价，保持默认；
//    break 处理器把 Shift+Enter 硬换行写回普通换行，不写行尾 \
import type { Ctx, MilkdownPlugin } from '@milkdown/ctx'
import { InitReady, remarkStringifyOptionsCtx } from '@milkdown/core'
import { remarkPreserveEmptyLinePlugin } from '@milkdown/preset-commonmark'
import { $nodeSchema, $remark, $view } from '@milkdown/utils'
import type { EditorView, NodeView } from '@milkdown/prose/view'
import type { Node as PMNode } from '@milkdown/prose/model'
import type { Handle, Join } from 'mdast-util-to-markdown'
import remarkFrontmatter from 'remark-frontmatter'

export const frontmatterRemark = $remark(
  'remark-frontmatter',
  () => remarkFrontmatter,
  // 必须显式给预设名：$remark 默认注入 {}，会被当成缺 type 的 matter 定义而报错
  'yaml'
)

export const frontmatterSchema = $nodeSchema('frontmatter', () => ({
  content: 'text*',
  group: 'block',
  marks: '',
  defining: true,
  code: true,
  parseDOM: [{ tag: 'pre.ob-frontmatter', preserveWhitespace: 'full' }],
  toDOM: () => ['pre', { class: 'ob-frontmatter' }, 0],
  parseMarkdown: {
    match: ({ type }) => type === 'yaml',
    runner: (state, node, type) => {
      const value = (node as unknown as { value?: string }).value
      state.openNode(type)
      if (value) state.addText(value)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.textContent)
    },
  },
}))

// ---- 属性栏渲染：YAML 键值对 → 紧凑表格 ----
// 简单 key: value 行渲染为两列表格（值可编辑，提交后回写节点文本）；
// 不匹配的行（注释、嵌套列表等）降级为等宽原始行，同样可编辑。
interface FmRow {
  key: string | null
  value: string
}

const parseFmRows = (text: string): FmRow[] =>
  text.split('\n').map((line) => {
    const m = /^([^:#\s][^:]*):\s?(.*)$/.exec(line)
    return m ? { key: (m[1] as string).trim(), value: m[2] as string } : { key: null, value: line }
  })

export const frontmatterView = $view(
  frontmatterSchema.node,
  () =>
    (initialNode, view, getPos): NodeView => {
      let node = initialNode

      const dom = document.createElement('div')
      dom.className = 'ob-frontmatter'
      // 区域由 nodeView 自管：阻断浏览器原生编辑，配合 stopEvent 全拦截，
      // PM 不会对 frontmatter 节点产生 NodeSelection（否则节点选中态下按键
      // 会被 PM 当成"替换选中节点"，整个属性区被吞掉）
      dom.contentEditable = 'false'
      const label = document.createElement('div')
      label.className = 'ob-frontmatter-label'
      label.textContent = '笔记属性'
      const tbody = document.createElement('tbody')
      const table = document.createElement('table')
      table.appendChild(tbody)
      dom.append(label, table)

      let pendingFocus: number | null = null

      /** 从文档取当前 frontmatter 节点，不用闭包缓存（杜绝过时 nodeSize） */
      const currentNode = () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (pos == null) return undefined
        const found = view.state.doc.nodeAt(pos)
        return found && found.type === node.type ? found : undefined
      }

      const replaceText = (text: string) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        const cur = currentNode()
        if (pos == null || !cur) return
        view.dispatch(view.state.tr.insertText(text, pos + 1, pos + cur.nodeSize - 1))
      }

      /** 在 index 行下方插入空行（渲染为键值双输入框的虚拟行），并聚焦新行键名 */
      const insertRowBelow = (index: number) => {
        const cur = currentNode()
        if (!cur) return
        const lines = cur.textContent.split('\n')
        lines.splice(index + 1, 0, '')
        pendingFocus = index + 1
        replaceText(lines.join('\n'))
      }

      /** 编辑提交（失焦触发）：
       *  - 该行所有内容被删光 → 删除该行（虚拟空行被放弃时也走这条路，自动清理）
       *  - 键名留空但值非空 → 键名还原（空键不是合法 YAML）
       *  - 虚拟行填了键 → 写成标准 key: value 行 */
      const commit = (index: number, keyInput: HTMLInputElement | null, valueInput: HTMLInputElement) => {
        if (!view.editable) return
        const cur = currentNode()
        if (!cur) return
        const row = parseFmRows(cur.textContent)[index]
        if (!row) return
        const newKey = keyInput ? keyInput.value.trim() : null
        const newValue = valueInput.value
        const lines = cur.textContent.split('\n')

        if ((newKey == null || newKey === '') && newValue.trim() === '') {
          lines.splice(index, 1)
          // 所有行都被删光 → 整个 frontmatter 节点移除（对齐 Ob：
          // 清空属性后 --- 围栏消失，不留空壳）；刚插入就放弃的空属性栏也走这条路
          if (lines.every((l) => l.trim() === '')) {
            const pos = typeof getPos === 'function' ? getPos() : undefined
            if (pos != null) view.dispatch(view.state.tr.delete(pos, pos + cur.nodeSize))
            return
          }
          replaceText(lines.join('\n'))
          return
        }
        if (row.key != null) {
          if (newKey === '') keyInput!.value = row.key
          const key = newKey === '' ? row.key : newKey
          if (key === row.key && newValue === row.value) return
          lines[index] = `${key}: ${newValue}`
        } else {
          const text = newKey ? `${newKey}: ${newValue}` : newValue
          if (text === row.value) return
          lines[index] = text
        }
        replaceText(lines.join('\n'))
      }

      /** 输入框公共行为：禁用态/拼写检查 + Enter 提交并在下方新增空行、Esc 还原 */
      const wireInput = (input: HTMLInputElement, opts: { revert: () => void; onEnter: () => void }) => {
        input.disabled = !view.editable
        input.spellcheck = false
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            input.blur() // 先提交当前行（如有改动）
            opts.onEnter()
          } else if (e.key === 'Escape') {
            opts.revert()
            input.blur()
          }
        })
      }

      const render = () => {
        tbody.replaceChildren()
        let focusTarget: HTMLInputElement | null = null
        try {
          parseFmRows(node.textContent).forEach((row, i) => {
          const tr = document.createElement('tr')
          // 键值行 + Enter 新增的虚拟空行：键/值双输入框
          if (row.key != null || row.value === '') {
            const keyInput = document.createElement('input')
            keyInput.className = 'fm-key-input'
            keyInput.value = row.key ?? ''
            if (row.key == null) keyInput.placeholder = '属性名'
            // 列宽由 CSS 控制（td.fm-key 固定 30%），input width:100% 填满单元格；
            // 不要再按内容估算 size——百分比宽度下 intrinsic 宽度会把列压回 size 宽度
            const valueInput = document.createElement('input')
            valueInput.value = row.value
            // Tab 在同行键/值间移动时 relatedTarget 是对方——跳过提交，
            // 否则重渲染会销毁正在接收焦点的输入框
            wireInput(keyInput, {
              revert: () => { keyInput.value = row.key ?? '' },
              onEnter: () => insertRowBelow(i),
            })
            keyInput.addEventListener('blur', (e) => {
              if (e.relatedTarget !== valueInput) commit(i, keyInput, valueInput)
            })
            wireInput(valueInput, {
              revert: () => { valueInput.value = row.value },
              onEnter: () => insertRowBelow(i),
            })
            valueInput.addEventListener('blur', (e) => {
              if (e.relatedTarget !== keyInput) commit(i, keyInput, valueInput)
            })
            const tdKey = document.createElement('td')
            tdKey.className = 'fm-key'
            tdKey.appendChild(keyInput)
            const tdVal = document.createElement('td')
            tdVal.appendChild(valueInput)
            tr.append(tdKey, tdVal)
            if (pendingFocus === i) focusTarget = keyInput
          } else {
            const input = document.createElement('input')
            input.value = row.value
            wireInput(input, {
              revert: () => { input.value = row.value },
              onEnter: () => insertRowBelow(i),
            })
            input.addEventListener('blur', () => commit(i, null, input))
            const td = document.createElement('td')
            td.colSpan = 2
            td.className = 'fm-raw'
            td.appendChild(input)
            tr.appendChild(td)
          }
          tbody.appendChild(tr)
          })
        } catch (err) {
          // 渲染异常不应留下空表：打印诊断并至少保留标签（行会在下次 update 重建）
          console.error('[frontmatter] 属性表渲染失败:', err)
        }
        pendingFocus = null
        // dispatch 周期内 PM 可能接管选区，焦点推迟到下一拍
        if (focusTarget) setTimeout(() => focusTarget!.focus(), 0)
      }
      render()

      return {
        dom,
        update(next) {
          if (next.type !== node.type) return false
          const changed = next.textContent !== node.textContent
          node = next
          // 文本没变就不重排 DOM，避免无关更新抢走输入框焦点
          if (changed) render()
          return true
        },
        // 属性盒内的一切事件由 nodeView 自管，PM 一律不处理（防 NodeSelection 吞节点）
        stopEvent: (event) =>
          event.target instanceof Node && dom.contains(event.target),
        ignoreMutation: () => true,
      }
    }
)

// ---- 创建入口（七轮）：无 frontmatter 的文档在文首插入空属性栏 ----
// 空文本节点经 NodeView 渲染为一行"属性名"虚拟输入框，填键回车即写成 key: value；
// 一行都不填就离开 → commit 的清空分支把整个节点移除，不落空 --- 围栏
export const hasFrontmatter = (doc: PMNode) =>
  doc.firstChild?.type.name === 'frontmatter'

export function insertFrontmatter(view: EditorView) {
  const type = view.state.schema.nodes.frontmatter
  if (!type || hasFrontmatter(view.state.doc)) return
  view.dispatch(view.state.tr.insert(0, type.create()))
  // NodeView 在 dispatch 后挂载，推迟一拍聚焦新行键名输入框
  setTimeout(() => {
    view.dom
      .querySelector<HTMLInputElement>('.ob-frontmatter .fm-key-input')
      ?.focus()
  }, 0)
}

// CommonMark 的 Unicode 空白 / 标点定义（_ 强调定界符判定用；
// 标点按规范取 P+S 两个大类，_ 本身属 Pc 也在其中）
const cmWhitespace = /[\p{Zs}\t\n\f\r]/u
const cmPunctuation = /[\p{P}\p{S}]/u

// 下划线转义收紧：mdast-util-to-markdown 把文本中每个 _ 都无脑转义成 \_，
// 但按 CommonMark 定界符规则，词内下划线（两侧都是普通字符，如 测试_测试 /
// hello_world）左右 flanking 同时成立，既不能打开也不能闭合强调，转义纯属污染。
// safe() 之后按 run 重新判定，撤销这类转义。两类情况保守保留：
// 1. run 确实能打开或闭合强调（如 _temp_、行尾 结束_）
// 2. 本行去掉转义后只剩 _ 与空白且 _ 满 3 个（___ / _ _ _ 会变成分隔线）
const unescapeIntrawordUnderscores = (value: string, before: string, after: string): string => {
  let out = ''
  let i = 0
  while (i < value.length) {
    if (value[i] !== '\\' || value[i + 1] !== '_') {
      out += value[i++]
      continue
    }
    // safe() 把 run 内每个 _ 都转义为 \_，整串消费
    let runLen = 0
    while (value[i + runLen * 2] === '\\' && value[i + runLen * 2 + 1] === '_') runLen++
    // run 两侧的实际字符；在节点边界时取 phrasing 上下文（单字符，行界视为空白）
    const prev = out.length > 0 ? out[out.length - 1] : before
    const next = i + runLen * 2 < value.length ? value[i + runLen * 2] : after
    const isWs = (ch: string) => ch === '' || cmWhitespace.test(ch)
    const isPunct = (ch: string) => ch !== '' && cmPunctuation.test(ch)
    const leftFlanking = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev))
    const rightFlanking = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next))
    const canOpen = leftFlanking && (!rightFlanking || isPunct(prev))
    const canClose = rightFlanking && (!leftFlanking || isPunct(next))
    let keepEscape = canOpen || canClose
    if (!keepEscape) {
      // 分隔线风险判定：行界内只有 _ 与空白。行首位置落在节点边界时，
      // before 为空白类字符无法证伪行首（可能是块标记前缀），保守视为行首
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

// text 处理器：默认转义后，撤销破坏原文语义的 \[!、\== 与词内 \_
const keepObsidianSyntax: Handle = (node, _parent, state, info) =>
  unescapeIntrawordUnderscores(
    state.safe((node as unknown as { value?: string }).value ?? '', info),
    info.before,
    info.after
  )
    .replace(/\\\[(?=!)/g, '[')
    .replace(/\\=(?==)/g, '=')

// break 处理器：Shift+Enter 硬换行写回普通换行，不写行尾 \（Obsidian 风格）。
// 往返稳定：重新解析时软换行进入 text 节点值，ProseMirror pre-wrap 下照常渲染换行，
// 再次序列化仍输出 \n；旧的行尾两空格写法也会一并归一化为 \n。
const breakAsPlainNewline: Handle = () => '\n'

// Milkdown 把列表 spread 属性存成字符串（'true'/'false'），而 mdast-util-to-markdown
// 的 joinDefaults 只认布尔 → 紧凑列表也被序列化成宽松（列表项间插入空行）。
// 自定义 join 容忍两种形态；options.join 追加在默认规则之后，between 从尾部优先匹配。
const joinTightLists: Join = (left, right, parent) => {
  const spread = (parent as { spread?: boolean | string }).spread
  if (spread == null) return
  // 与 joinDefaults 一致：段落+段落/定义组合回落默认空行
  if (left.type === 'paragraph' && (right.type === 'paragraph' || right.type === 'definition'))
    return
  return spread === true || spread === 'true' ? 1 : 0
}

// GFM 解析任务项勾选框只消耗其后一个空格，源文件中 `[x]  文字` 的第二个空格
// 会残留为文本前导空格，序列化时被转义成 &#x20; 污染源码。该空格在所见即所得
// 模型里无法稳定保留（勾选框必须紧跟列表标记，前导空格会被勾选框插入逻辑吞掉，
// 下次保存照样坍缩），解析时直接修剪为标准的 `[x] 文字` 单空格形态。
interface MdNode {
  type: string
  checked?: boolean | null
  value?: string
  children?: MdNode[]
}

const trimTaskItemLeadingSpace = (tree: MdNode) => {
  const visit = (node: MdNode) => {
    if (node.type === 'listItem' && typeof node.checked === 'boolean') {
      const para = node.children?.[0]
      const head = para?.type === 'paragraph' ? para.children?.[0] : undefined
      if (head?.type === 'text' && head.value?.startsWith(' ')) {
        head.value = head.value.replace(/^ +/, '')
        if (head.value === '' && para) para.children?.shift()
      }
    }
    node.children?.forEach(visit)
  }
  visit(tree)
}

export const taskListSpaceTrim = $remark(
  'oblet-task-list-space-trim',
  () => () => trimTaskItemLeadingSpace as unknown as (tree: import('mdast').Root) => void
)

/** 在 config 阶段调用：收紧序列化输出，避免对未编辑内容做侵入性改写 */
export function tuneSerialization(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    rule: '-' as const, // hr 写 ---（默认会写成 ***，毁掉 frontmatter 围栏）
    bullet: '-' as const, // 无序列表符号用 -（对齐 Obsidian 习惯）
    join: [...(prev.join ?? []), joinTightLists],
    handlers: {
      ...prev.handlers,
      text: keepObsidianSyntax,
      break: breakAsPlainNewline,
    },
  }))
}

// Milkdown 的"空行保真"特性会把空段落序列化为 <br /> 注入文件——
// 在 Obsidian 源码视图里是刺眼的污染。移除其选项切片后，
// paragraph.ts 的 shouldPreserveEmptyLine 探测失败，空段落写回普通空行
//（markdown 语义本就折叠多余空行，视觉无差）。
// 解析侧的 <br> 剥离逻辑保留：已被污染的旧文件下次保存时自愈。
// 必须等 InitReady 之后再移除：commonmark 的 $remark 插件在 InitReady 后
// 读取该切片组装 remark，抢跑移除会让它报 "Context not found"。
export const disableEmptyLineBr: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(InitReady)
  try {
    ctx.remove(remarkPreserveEmptyLinePlugin.options.key)
  } catch {
    // 切片不存在时忽略
  }
}
