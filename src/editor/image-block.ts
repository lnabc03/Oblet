// 图片块 alt 保真：上游 @milkdown/components 的 image-block schema 把显示比例
// (ratio) 偷渡在 markdown 的 alt 槽位里——解析时 Number(alt || 1) 直接丢弃原 alt，
// 序列化时把 ratio.toFixed(2) 写成 alt（全部图片 alt 变成 "1.00"，语义信息丢失）。
// 这里用 extendSchema 覆盖同名节点（nodesCtx 按 id upsert，后注册者胜；
// Crepe latex 特性覆盖 codeBlockSchema 即此机制）：
//   - alt 进独立 attr 原样往返（parseMarkdown 的 image-block 节点由
//     remarkImageBlockPlugin 生成，url/alt/title 三字段齐全）；
//   - caption 维持上游约定 ↔ markdown title 槽位；
//   - ratio 保留在 schema（view 层缩放 UI 依赖）但降级为会话内存态、不再落盘
//     ——保真优先，markdown 里本就没有合适的 ratio 栖身位。
import { imageBlockSchema } from '@milkdown/components/image-block'

export const imageBlockFidelity = imageBlockSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    attrs: {
      ...base.attrs,
      alt: { default: '', validate: 'string' },
    },
    parseDOM: [
      {
        tag: 'img[data-type="image-block"]',
        getAttrs: (dom) => ({
          src: dom.getAttribute('src') || '',
          caption: dom.getAttribute('caption') || '',
          ratio: Number(dom.getAttribute('ratio') ?? 1),
          alt: dom.getAttribute('alt') || '',
        }),
      },
    ],
    parseMarkdown: {
      ...base.parseMarkdown,
      runner: (state, node, type) => {
        const n = node as unknown as { url?: string; title?: string | null; alt?: string | null }
        state.addNode(type, {
          src: n.url ?? '',
          caption: n.title ?? '',
          ratio: 1,
          alt: n.alt ?? '',
        })
      },
    },
    toMarkdown: {
      ...base.toMarkdown,
      runner: (state, node) => {
        state.openNode('paragraph')
        state.addNode('image', undefined, undefined, {
          title: (node.attrs.caption as string) || null,
          url: node.attrs.src as string,
          alt: (node.attrs.alt as string) || '',
        })
        state.closeNode()
      },
    },
  }
})
