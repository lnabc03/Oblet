// 文档类型与编辑器适配层：共享文件生命周期，不共享 Markdown/TXT 文档语义。
export type DocumentKind = "markdown" | "text";

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"] as const;
export const TEXT_EXTENSIONS = ["txt"] as const;

const SUPPORTED_RE = /\.(md|markdown|mdown|mkd|txt)$/i;

export function isSupportedDocumentPath(path: string): boolean {
  return SUPPORTED_RE.test(path);
}

export function documentKindForPath(path: string): DocumentKind {
  return /\.txt$/i.test(path) ? "text" : "markdown";
}

export interface DocumentIOMeta {
  newline: string;
  readonly: boolean;
  readonly_reason: string | null;
  /** utf8 | utf16le | utf16be | gbk | unknown */
  encoding: string;
  /** 原文件是否带 BOM；目前仅 UTF-8 BOM 可编辑写回 */
  bom: boolean;
}

export interface EditorSelectionState {
  from?: number;
  to?: number;
  scrollTop?: number;
}

/** 单当前文档适配接口：PM 与 CM 的位置偏移只在各自实现内解释。 */
export interface EditorAdapter {
  readonly kind: DocumentKind;
  getContent(): string;
  replaceContent(content: string): void;
  setReadonly(readonly: boolean): void;
  getSelection(): EditorSelectionState;
  restoreSelection(state: EditorSelectionState): void;
  focus(): void;
}
