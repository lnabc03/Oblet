// GitHub README 安全渲染兼容：HTML 原文是事实源，DOM 只是单向只读投影。
// 分层：html-lexer（词法/安全策略）→ html-transform（mdast 保真转换）
// → html-schema（PM 模型/序列化）→ html-views（渲染岛）；本文件只做组装与公共出口。
import type { MilkdownPlugin } from "@milkdown/ctx";
import { InitReady, remarkPluginsCtx } from "@milkdown/core";
import { $remark } from "@milkdown/utils";
import { transformHtmlTree, type MdNode } from "./html-transform";
import {
  allHtmlInlineMarkSchemas,
  configureHtml,
  htmlBlockSchema,
  htmlDetailsSchema,
  htmlInlineAtomSchema,
} from "./html-schema";
import {
  htmlBlockView,
  htmlDetailsView,
  htmlInlineAtomView,
  htmlInteractionPlugin,
  htmlSourceEscGuard,
} from "./html-views";

export {
  configureHtml,
  getHtmlInlineSource,
  tuneHtmlSerialization,
  updateHtmlBlockSource,
  updateHtmlDetailsSource,
  updateHtmlInlineSource,
  type HtmlDetailsSource,
  type HtmlInlineSource,
} from "./html-schema";
export {
  configureHtmlRuntime,
  setHtmlDocPath,
  setHtmlOpenPath,
  setHtmlOpenUrl,
  setHtmlToDomUrl,
  type HtmlDocPathGetter,
  type HtmlOpenPath,
  type HtmlOpenUrl,
  type HtmlRuntimeOptions,
  type HtmlToDomUrl,
} from "./html-render";

const htmlRemarkAttacher = () => {
  const transform = (tree: MdNode, file: { value?: unknown }) => {
    const source = typeof file.value === "string" ? file.value : String(file.value ?? "");
    transformHtmlTree(tree, source);
  };
  return transform as unknown as (tree: import("mdast").Root) => void;
};

const htmlRemark = $remark("oblet-html-fidelity", () => htmlRemarkAttacher);

/** 必须抢在上游 html 包裹和 <br> 空行清理之前，注册顺序不等于 transformer 顺序。 */
export const htmlRemarkPriority: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(InitReady);
  ctx.update(remarkPluginsCtx, (entries) => {
    const index = entries.findIndex((entry) => entry.plugin === htmlRemarkAttacher);
    if (index <= 0) return entries;
    const next = [...entries];
    const [entry] = next.splice(index, 1);
    next.unshift(entry);
    return next;
  });
};

/** 主协调者在 Crepe addFeature 中一次性注册；必须在 commonmark/Crepe 特性之后。 */
export const htmlPlugins: MilkdownPlugin[] = [
  htmlBlockSchema.ctx,
  htmlBlockSchema.node,
  htmlDetailsSchema.ctx,
  htmlDetailsSchema.node,
  htmlInlineAtomSchema.ctx,
  htmlInlineAtomSchema.node,
  ...allHtmlInlineMarkSchemas.flatMap(({ schema }) => [schema.ctx, schema.mark]),
  htmlBlockView,
  htmlDetailsView,
  htmlInlineAtomView,
  htmlRemark.options,
  htmlRemark.plugin,
  htmlRemarkPriority,
  htmlSourceEscGuard,
  htmlInteractionPlugin,
];

export const htmlPlugin = htmlPlugins;
