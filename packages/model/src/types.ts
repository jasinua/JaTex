// The typed document model between the LaTeX front end and the writers.
// Nothing here knows about TeX tokens or OOXML; both sides only share these types.

export interface Span { file: string; start: number; end: number }

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  smallCaps?: boolean;
  family?: "roman" | "sans" | "mono";
  underline?: boolean;
  strike?: boolean;
  color?: string;            // RRGGBB
  size?: number;             // half-points
  vertAlign?: "superscript" | "subscript";
  lang?: string;             // BCP 47, e.g. "en-US"
}

/** Semantic paragraph roles; the writer maps each role to a template style by name. */
export type ParagraphRole =
  | "body" | "firstParagraph" | "compact"
  | "title" | "subtitle" | "author" | "date"
  | "abstractTitle" | "abstract"
  | "quote" | "quotation" | "verse"
  | "caption" | "bibliography" | "code";

export type Align = "left" | "center" | "right" | "justify";

export type Inline =
  | { kind: "text"; text: string; marks: Marks }
  | { kind: "math"; tree: MathNode }
  | { kind: "footnote"; body: Block[] }
  /**
   * Cross-reference with cached `text`. `target` is the label owning the bookmark; `targetKind` picks
   * the field: heading → REF \w (paragraph number), number → REF (bookmarked number), item → hyperlink.
   * `prefix` is a name such as "Section" placed before the number (\autoref, \cref).
   */
  | { kind: "ref"; label: string; form: "number" | "page" | "name+number"; text?: string; target?: string;
      targetKind?: "heading" | "number" | "item"; prefix?: string }
  | { kind: "cite"; keys: string[]; mode: "paren" | "text"; prefix?: string; locator?: string }
  | { kind: "link"; href: string; content: Inline[] }
  | { kind: "anchor"; label: string }
  | { kind: "lineBreak" }
  | { kind: "tab" }
  | { kind: "image"; image: ImageRef }
  /** Word-computed values: page number, page count, current section / subsection title. */
  | { kind: "field"; field: "page" | "numpages" | "section" | "subsection" };

/** An embedded picture. Sizes are in EMU (914,400 per inch). */
export interface ImageRef {
  data: Uint8Array;
  /** png, jpeg, gif, svg, bmp */
  format: "png" | "jpeg" | "gif" | "svg" | "bmp";
  width: number;
  height: number;
  name: string;
  alt?: string;
  /** PNG shown by viewers without SVG support. */
  fallback?: Uint8Array;
}

export interface CodeToken { text: string; color?: string; bold?: boolean; italic?: boolean }

export interface EquationRow {
  tree: MathNode;
  /** Cached number text, e.g. "3" or "2.1"; undefined when unnumbered. */
  number?: string;
  /** Counter sequence name for the SEQ field (normally "equation"); absent for \tag. */
  seq?: string;
  label?: string;
}

export type Border = "single" | "double" | "thick" | "thin";

export interface TableCell {
  blocks: Block[];
  colSpan?: number;
  /** First cell of a \multirow; the cells below it are `merged`. */
  rowSpan?: number;
  merged?: boolean;
  align?: Align;
  valign?: "top" | "center" | "bottom";
  borders?: { top?: Border; bottom?: Border; left?: Border; right?: Border };
}

export interface TableRow { cells: TableCell[]; header?: boolean }

export interface ColumnSpec {
  align: Align;
  valign?: "top" | "center" | "bottom";
  /** Fixed width in twips (p{3cm}); undefined = sized by content. */
  width?: number;
  /** tabularx X column: shares the remaining width. */
  flex?: boolean;
  left?: Border;
  right?: Border;
}

export interface Caption {
  /** "Figure", "Table" (from \figurename / \tablename). */
  label: string;
  number?: string;
  /** SEQ identifier for the caption number field ("figure", "table"). */
  seq?: string;
  content: Inline[];
  /** Label that owns the bookmark around the number. */
  anchor?: string;
}

export type ListFormat = "decimal" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman" | "bullet";

export interface ListItem { label?: Inline[]; blocks: Block[]; /** bookmark label for \ref to this item */ anchor?: string }

export interface Spacing { before?: number; after?: number }   // twips

export type Block =
  | { kind: "heading"; level: number; numbered: boolean; content: Inline[]; label?: string; span: Span }
  | { kind: "paragraph"; role: ParagraphRole; align?: Align; spacing?: Spacing; content: Inline[]; span: Span }
  | { kind: "list"; style: "itemize" | "enumerate" | "description"; format?: ListFormat;
      /** Word lvlText with %1 for the number, e.g. "(%1)"; or the bullet glyph for itemize. */
      template?: string; start?: number; items: ListItem[]; span: Span }
  | { kind: "math"; tree: MathNode; span: Span }
  /** Display equation(s): one row per numbered line (align, gather) or a single row. */
  | { kind: "equation"; rows: EquationRow[]; span: Span }
  /** Source code; `lines` holds syntax-highlighted tokens when the language is known. */
  | { kind: "code"; language?: string; text: string; lines?: CodeToken[][]; span: Span }
  | { kind: "toc"; depth: number; figures?: "figure" | "table"; title?: Inline[] }
  | { kind: "pageBreak" }
  | { kind: "table"; columns: ColumnSpec[]; rows: TableRow[]; align?: Align; width?: number; span: Span }
  /** A figure or table float; captions are `caption` blocks inside its content, above or below. */
  | { kind: "float"; float: "figure" | "table"; content: Block[]; span: Span }
  | { kind: "caption"; caption: Caption; span: Span }
  /** Ends a section (Word section break); page numbering of the following section changes. */
  | { kind: "sectionBreak"; numbering?: PageNumbering };

// Math trees are produced by @texdocx/math and serialized to OMML by @texdocx/docx.
export type MathNode =
  | { k: "row"; items: MathNode[] }
  /** A run of math text. `normal` = text font (\text); `aln` = alignment point in an equation array. */
  | { k: "atom"; text: string; style?: "p" | "b" | "i" | "bi"; normal?: boolean; aln?: boolean;
      cls?: "ord" | "op" | "bin" | "rel" | "open" | "close" | "punct" }
  | { k: "frac"; num: MathNode; den: MathNode; bar?: boolean; small?: boolean }
  | { k: "sup"; base: MathNode; sup: MathNode }
  | { k: "sub"; base: MathNode; sub: MathNode }
  | { k: "subsup"; base: MathNode; sub: MathNode; sup: MathNode }
  | { k: "pre"; sub: MathNode; sup: MathNode; base: MathNode }
  | { k: "sqrt"; body: MathNode; index?: MathNode }
  | { k: "nary"; op: string; sub?: MathNode; sup?: MathNode; body: MathNode; limits: boolean }
  | { k: "delim"; open: string; close: string; body: MathNode[] }
  | { k: "func"; name: MathNode; body: MathNode }
  | { k: "limLow"; base: MathNode; lim: MathNode }
  | { k: "limUpp"; base: MathNode; lim: MathNode }
  | { k: "acc"; chr: string; body: MathNode }
  | { k: "bar"; pos: "top" | "bot"; body: MathNode }
  | { k: "groupChr"; chr: string; pos: "top" | "bot"; body: MathNode }
  | { k: "box"; body: MathNode }
  | { k: "phantom"; body: MathNode; width?: boolean; height?: boolean }
  | { k: "matrix"; rows: MathNode[][]; align?: ("l" | "c" | "r")[] }
  | { k: "eqArr"; rows: MathNode[] };

export interface HeaderFooterSlots { left?: Inline[]; center?: Inline[]; right?: Inline[] }

/** A LaTeX page style rendered as a Word header and footer. */
export interface PageStyle { header?: HeaderFooterSlots; footer?: HeaderFooterSlots }

export interface PageNumbering { format: "decimal" | "lowerRoman" | "upperRoman" | "lowerLetter" | "upperLetter"; start?: number }

export interface PageSetup {
  width: number;             // twips
  height: number;
  margin: { top: number; right: number; bottom: number; left: number; header: number; footer: number };
  columns: number;
}

export interface DocumentClassInfo {
  name: string;              // article, report, book, …
  baseSize: number;          // points: 10, 11, 12
  twoside: boolean;
  /** Heading level of \section: 1 for article, 2 for report/book. */
  sectionLevel: number;
}

export interface DocumentMeta {
  title?: Inline[];
  authors: Inline[][];
  date?: Inline[];
  lang?: string;
}

export interface Document {
  meta: DocumentMeta;
  docClass: DocumentClassInfo;
  page: PageSetup;
  /** Header/footer for all pages; `firstPageStyle` overrides page 1 (\thispagestyle on the title page). */
  pageStyle: PageStyle;
  firstPageStyle?: PageStyle;
  pageNumbering?: PageNumbering;
  blocks: Block[];
}

export const A4: Pick<PageSetup, "width" | "height"> = { width: 11906, height: 16838 };
export const LETTER: Pick<PageSetup, "width" | "height"> = { width: 12240, height: 15840 };

export function defaultPage(): PageSetup {
  // LaTeX article on Letter paper has wide margins; 1in (1440 twips) is a readable Word default.
  return { ...LETTER, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 }, columns: 1 };
}

export function emptyDocument(): Document {
  return {
    meta: { authors: [] },
    docClass: { name: "article", baseSize: 10, twoside: false, sectionLevel: 1 },
    page: defaultPage(),
    pageStyle: {},
    blocks: [],
  };
}
