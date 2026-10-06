// Document model → OOXML parts. Blind to LaTeX: it only reads @texdocx/model types.

import {
  plainText, type Align, type Block, type Border, type Caption, type Document, type EquationRow, type ImageRef, type Inline,
  type HeaderFooterSlots, type ListItem, type Marks, type PageNumbering, type PageSetup, type PageStyle, type Spacing, type TableCell,
} from "@texdocx/model";
import { BLANK_PNG, MEDIA_TYPES, hashBytes, inlinePicture } from "./media.ts";
import { displayMath, inlineMath } from "./omml.ts";
import { Numbering, type LevelDef } from "./numbering.ts";
import { appXml, contentTypesXml, coreXml, packageRelsXml, relsXml, settingsXml, type Rel } from "./parts.ts";
import { DEFAULT_FONTS, HEADING_NUM_ID, ROLE_STYLE, stylesXml, type Fonts } from "./styles.ts";
import { CT, NS, ORDER, REL, XML_DECL, el, ordered, stripIllegal, val, xmlText } from "./xml.ts";

export interface WriteOptions {
  fonts?: Partial<Fonts>;
  /** Written to docProps/core.xml; omitted by default so output is reproducible. */
  created?: Date;
  lang?: string;
}

interface ParaProps {
  style?: string;
  keepNext?: boolean;
  numPr?: { ilvl: number; numId: number };
  tabs?: { val: "left" | "center" | "right"; pos: number }[];
  spacing?: Spacing;
  ind?: { left?: number; hanging?: number; firstLine?: number };
  align?: Align;
  sectPr?: string;
}

/** Context for writing nested blocks (list items, footnotes, table cells, floats). */
interface BlockCtx {
  inFootnote?: boolean;
  inCell?: boolean;
  cellAlign?: Align;
  keepNext?: boolean;
  listLeft?: number;             // twips indent of the enclosing list item's text
  listDepth?: number;
  firstNum?: { ilvl: number; numId: number; consumed: boolean };
  footnoteRef?: { consumed: boolean };
}

const JC: Record<Align, string> = { left: "left", center: "center", right: "right", justify: "both" };

const BORDER_SIZES: Record<Border, [string, number]> = { single: ["single", 4], thin: ["single", 3], thick: ["single", 8], double: ["double", 4] };
const border = (tag: string, b: Border): string =>
  el(tag, { "w:val": BORDER_SIZES[b][0], "w:sz": BORDER_SIZES[b][1], "w:space": 0, "w:color": "000000" });

/** Plain text of blocks, for estimating column widths. */
function blocksText(bs: Block[]): string {
  return bs.map(b => {
    if (b.kind === "paragraph") return plainText(b.content) + b.content.filter(n => n.kind === "math").map(() => "xxxx").join("");
    if (b.kind === "list") return b.items.map(i => blocksText(i.blocks)).join("\n");
    if (b.kind === "code") return b.text;
    return "";
  }).join("\n");
}

/** Two adjacent tables are merged by Word; an empty paragraph keeps them apart. */
function separateTables(xml: string): string {
  return xml.replace(/<\/w:tbl><w:tbl>/g, "</w:tbl><w:p/><w:tbl>");
}

/** SEQ identifiers are Word caption labels: "equation" → "Equation". */
const seqName = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const ALLOWED_FIELDS = new Set(["REF", "PAGEREF", "SEQ", "TOC", "PAGE", "NUMPAGES", "STYLEREF", "XE", "INDEX"]);

/** Word bookmark names: ≤40 chars, start with a letter, letters/digits/underscores, unique. */
export class Bookmarks {
  private byLabel = new Map<string, string>();
  private used = new Set<string>();
  name(label: string): string {
    const known = this.byLabel.get(label);
    if (known) return known;
    const base = ("lbl_" + label.replace(/[^A-Za-z0-9_]/g, "_")).slice(0, 40);
    let name = base, i = 2;
    while (this.used.has(name.toLowerCase())) {
      const suffix = `_${i++}`;
      name = base.slice(0, 40 - suffix.length) + suffix;
    }
    this.used.add(name.toLowerCase());
    this.byLabel.set(label, name);
    return name;
  }
}

class DocWriter {
  private rels: Rel[] = [
    { id: "rId1", type: REL.styles, target: "styles.xml" },
    { id: "rId2", type: REL.settings, target: "settings.xml" },
    { id: "rId3", type: REL.numbering, target: "numbering.xml" },
  ];
  /** Relationships of word/footnotes.xml (links and images inside footnotes live there). */
  private footnoteRels: Rel[] = [];
  /** Part whose .rels receives new relationships while writing. */
  private relScope: Rel[] = this.rels;
  private footnotes: string[] = [];
  private bookmarkId = 0;
  private bookmarks = new Bookmarks();
  private listAbstracts = new Map<string, number>();
  readonly media: { path: string; data: Uint8Array; ext: string }[] = [];
  /** Header and footer parts: path → XML, and the references each section carries. */
  readonly extraParts: { path: string; xml: string; contentType: string }[] = [];
  private hfRefs: string[] = [];
  private titlePg = false;
  /** Page numbering of the section being written (changes at section breaks). */
  private pageNumbering?: PageNumbering;
  private mediaByHash = new Map<string, string>();
  private docPrId = 1;
  readonly numbering: Numbering;
  readonly fonts: Fonts;
  needsUpdateFields = false;

  private doc: Document;

  constructor(doc: Document, opts: WriteOptions) {
    this.doc = doc;
    this.fonts = { ...DEFAULT_FONTS, ...opts.fonts };
    this.numbering = new Numbering(3);
  }

  private rel(type: string, target: string, external = false, scope: Rel[] = this.relScope): string {
    const existing = scope.find(r => r.type === type && r.target === target && !!r.external === external);
    if (existing) return existing.id;
    const id = `rId${scope.length + 1}`;
    scope.push({ id, type, target, external });
    return id;
  }

  // ---- paragraphs and runs ----

  private pPr(p: ParaProps): string {
    const c: Record<string, string | undefined> = {
      "w:pStyle": p.style && val("w:pStyle", p.style),
      "w:keepNext": p.keepNext ? "<w:keepNext/>" : undefined,
      "w:numPr": p.numPr && el("w:numPr", undefined, val("w:ilvl", p.numPr.ilvl), val("w:numId", p.numPr.numId)),
      "w:tabs": p.tabs && el("w:tabs", undefined, ...p.tabs.map(t => el("w:tab", { "w:val": t.val, "w:pos": t.pos }))),
      "w:spacing": p.spacing && el("w:spacing", { "w:before": p.spacing.before, "w:after": p.spacing.after }),
      "w:ind": p.ind && el("w:ind", { "w:left": p.ind.left, "w:hanging": p.ind.hanging, "w:firstLine": p.ind.firstLine }),
      "w:jc": p.align && val("w:jc", JC[p.align]),
      "w:sectPr": p.sectPr,
    };
    return Object.values(c).some(v => v !== undefined) ? ordered("w:pPr", ORDER.pPr, c) : "";
  }

  private para(p: ParaProps, content: string): string {
    return `<w:p>${this.pPr(p)}${content}</w:p>`;
  }

  rPr(m: Marks, charStyle?: string): string {
    const onOff = (name: string, v: boolean | undefined) =>
      v === undefined ? undefined : v ? `<${name}/>` : `<${name} w:val="0"/>`;
    const mono = m.family === "mono";
    const fontName = m.family === "sans" ? this.fonts.sans : m.family === "roman" ? this.fonts.serif
      : mono && charStyle ? this.fonts.mono : undefined;
    const c: Record<string, string | undefined> = {
      "w:rStyle": charStyle ? val("w:rStyle", charStyle) : mono ? val("w:rStyle", "VerbatimChar") : undefined,
      "w:rFonts": fontName && el("w:rFonts", { "w:ascii": fontName, "w:hAnsi": fontName, "w:cs": fontName }),
      "w:b": onOff("w:b", m.bold), "w:bCs": onOff("w:bCs", m.bold),
      "w:i": onOff("w:i", m.italic), "w:iCs": onOff("w:iCs", m.italic),
      "w:smallCaps": onOff("w:smallCaps", m.smallCaps),
      "w:strike": onOff("w:strike", m.strike),
      "w:color": m.color && val("w:color", m.color),
      "w:sz": m.size ? val("w:sz", m.size) : undefined,
      "w:szCs": m.size ? val("w:szCs", m.size) : undefined,
      "w:u": m.underline === undefined ? undefined : val("w:u", m.underline ? "single" : "none"),
      "w:vertAlign": m.vertAlign && val("w:vertAlign", m.vertAlign),
      "w:lang": m.lang && val("w:lang", m.lang),
    };
    return Object.values(c).some(v => v !== undefined) ? ordered("w:rPr", ORDER.rPr, c) : "";
  }

  run(text: string, m: Marks, charStyle?: string): string {
    const pr = this.rPr(m, charStyle);
    // Strip XML-illegal characters before deciding about xml:space, then split off tabs and
    // newlines, which are separate run content elements, never literal characters in w:t.
    const pieces = stripIllegal(text).split(/(\t|\n)/).filter(s => s !== "");
    if (!pieces.length) return "";
    const body = pieces.map(s => s === "\t" ? "<w:tab/>" : s === "\n" ? "<w:br/>"
      : `<w:t${/^\s|\s$|\s\s/.test(s) ? ' xml:space="preserve"' : ""}>${xmlText(s)}</w:t>`).join("");
    return `<w:r>${pr}${body}</w:r>`;
  }

  private field(instr: string, cached: string, m: Marks = {}): string {
    const name = instr.trim().split(/\s+/)[0];
    if (!ALLOWED_FIELDS.has(name)) throw new Error(`field ${name} is not on the allowlist`);
    const pr = this.rPr(m);
    return `<w:r>${pr}<w:fldChar w:fldCharType="begin"/></w:r>`
      + `<w:r>${pr}<w:instrText xml:space="preserve"> ${xmlText(instr)} </w:instrText></w:r>`
      + `<w:r>${pr}<w:fldChar w:fldCharType="separate"/></w:r>`
      + this.run(cached, m)
      + `<w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r>`;
  }

  /** Labels whose bookmark has been written: a name may appear only once in a document. */
  private emitted = new Set<string>();

  private bookmark(label: string, inner = ""): string {
    // A label defined twice (LaTeX warns "multiply defined") keeps its first bookmark only.
    if (this.emitted.has(label)) return inner;
    this.emitted.add(label);
    const id = this.bookmarkId++;
    return `<w:bookmarkStart w:id="${id}" w:name="${this.bookmarks.name(label)}"/>${inner}<w:bookmarkEnd w:id="${id}"/>`;
  }


  inlines(xs: Inline[], charStyle?: string): string {
    let out = "";
    for (const n of xs) {
      switch (n.kind) {
        case "text": out += this.run(n.text, n.marks, charStyle); break;
        case "lineBreak": out += "<w:r><w:br/></w:r>"; break;
        case "tab": out += "<w:r><w:tab/></w:r>"; break;
        case "math": out += inlineMath(n.tree); break;
        case "anchor": out += this.bookmark(n.label); break;
        case "footnote": out += this.footnote(n.body); break;
        case "link": {
          if (n.href.startsWith("#")) {
            out += el("w:hyperlink", { "w:anchor": this.bookmarks.name(n.href.slice(1)), "w:history": "1" }, this.inlines(n.content, "Hyperlink"));
          } else {
            const id = this.rel(REL.hyperlink, n.href, true);
            out += el("w:hyperlink", { "r:id": id, "w:history": "1" }, this.inlines(n.content, "Hyperlink"));
          }
          break;
        }
        case "ref": out += this.ref(n); break;
        case "cite": out += this.run(`[${n.keys.join(", ")}]`, {}); break;
        case "image": out += this.image(n.image); break;
        case "field": {
          const [instr, cached] = n.field === "page" ? ["PAGE", "1"] : n.field === "numpages" ? ["NUMPAGES", "1"]
            : n.field === "section" ? ["STYLEREF 1", ""] : ["STYLEREF 2", ""];
          out += this.field(instr, cached);
          break;
        }
      }
    }
    return out;
  }

  private ref(n: Extract<Inline, { kind: "ref" }>): string {
    const text = n.text ?? "??";
    const prefix = n.prefix ? this.run(n.prefix + "\u00A0", {}) : "";
    if (!n.target) return prefix + this.run(text, {});
    const bm = this.bookmarks.name(n.target);
    if (n.form === "page") {
      this.needsUpdateFields = true;
      return prefix + this.field(`PAGEREF ${bm} \\h`, text);
    }
    if (n.targetKind === "heading") return prefix + this.field(`REF ${bm} \\w \\h`, text);
    if (n.targetKind === "number") return prefix + this.field(`REF ${bm} \\h`, text);
    return prefix + el("w:hyperlink", { "w:anchor": bm, "w:history": "1" }, this.run(text, {}));
  }

  /** Paragraph content; a lone inline equation gets a zero-width space so Word keeps it inline. */
  private paragraphContent(xs: Inline[]): string {
    const significant = xs.filter(n => !(n.kind === "text" && !n.text.trim()));
    const lone = significant.length === 1 && significant[0].kind === "math";
    return (lone ? this.run("​", {}) : "") + this.inlines(xs);
  }

  private footnote(body: Block[]): string {
    const id = this.footnotes.length + 1;
    if (id === 1) this.rel(REL.footnotes, "footnotes.xml", false, this.rels);
    this.footnotes.push("");   // reserve the id: footnotes nested in this body get later ids
    const ctx: BlockCtx = { inFootnote: true, footnoteRef: { consumed: false } };
    const savedScope = this.relScope;
    this.relScope = this.footnoteRels;
    let xml = this.blocks(body, ctx);
    this.relScope = savedScope;
    if (!ctx.footnoteRef!.consumed) xml = this.para({ style: "FootnoteText" }, this.footnoteRefRun()) + xml;
    this.footnotes[id - 1] = `<w:footnote w:id="${id}">${xml}</w:footnote>`;
    return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
  }

  private footnoteRefRun(): string {
    return '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>';
  }

  // ---- blocks ----

  blocks(bs: Block[], ctx: BlockCtx = {}): string {
    return bs.map(b => this.block(b, ctx)).join("");
  }

  /** Paragraph properties for body text, adjusted for list items and footnotes. */
  private contextual(p: ParaProps, ctx: BlockCtx): { props: ParaProps; prefix: string } {
    let prefix = "";
    const props = { ...p };
    if (ctx.inFootnote) {
      props.style = "FootnoteText";
      if (ctx.footnoteRef && !ctx.footnoteRef.consumed) { prefix = this.footnoteRefRun(); ctx.footnoteRef.consumed = true; }
    }
    if (ctx.inCell && !ctx.inFootnote) {
      if (props.style === ROLE_STYLE.body || props.style === ROLE_STYLE.firstParagraph) props.style = "Compact";
      props.align ??= ctx.cellAlign;
    }
    if (ctx.keepNext) props.keepNext = true;
    if (ctx.listLeft !== undefined) {
      if (!ctx.inFootnote) props.style = "ListParagraph";
      if (ctx.firstNum && !ctx.firstNum.consumed) {
        props.numPr = { ilvl: ctx.firstNum.ilvl, numId: ctx.firstNum.numId };
        ctx.firstNum.consumed = true;
      } else {
        props.ind = { left: ctx.listLeft, firstLine: 0 };
      }
    }
    return { props, prefix };
  }

  private block(b: Block, ctx: BlockCtx): string {
    switch (b.kind) {
      case "heading": {
        const style = b.level <= 0 ? "Part" : `Heading${Math.min(b.level, 6)}`;
        const numPr = !b.numbered ? { ilvl: 0, numId: 0 }
          : b.level > 3 && b.level <= 9 ? { ilvl: b.level - 1, numId: HEADING_NUM_ID } : undefined;
        const content = this.inlines(b.content);
        return this.para({ style, numPr }, b.label ? this.bookmark(b.label, content) : content);
      }
      case "paragraph": {
        const { props, prefix } = this.contextual({ style: ROLE_STYLE[b.role], align: b.align, spacing: b.spacing }, ctx);
        return this.para(props, prefix + this.paragraphContent(b.content));
      }
      case "math": {
        const { props, prefix } = this.contextual({ style: "Equation" }, ctx);
        return this.para(props, prefix + displayMath(b.tree));
      }
      case "equation": return b.rows.map(r => this.equationRow(r, ctx)).join("");
      case "code": {
        const { props, prefix } = this.contextual({ style: "SourceCode" }, ctx);
        const body = b.lines
          ? b.lines.map((line, i) => (i ? "<w:r><w:br/></w:r>" : "")
            + line.map(t => this.run(t.text, { color: t.color, bold: t.bold || undefined, italic: t.italic || undefined })).join("")).join("")
          : b.text.replace(/\n$/, "").split("\n").map((l, i) => (i ? "<w:r><w:br/></w:r>" : "") + (l ? this.run(l, {}) : "")).join("");
        return this.para({ ...props, style: "SourceCode" }, prefix + body);
      }
      case "pageBreak": return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      case "toc": {
        this.needsUpdateFields = true;
        const title = b.title ? this.inlines(b.title) : this.run(b.figures === "figure" ? "List of Figures" : b.figures === "table" ? "List of Tables" : "Contents", {});
        const instr = b.figures ? `TOC \\h \\z \\c "${seqName(b.figures)}"` : `TOC \\o "1-${b.depth}" \\h \\z \\u`;
        return this.para({ style: "TOCHeading" }, title)
          + this.para({}, this.field(instr, "Update this field (F9) to build the list."));
      }
      case "table": return this.table(b, ctx);
      case "sectionBreak": {
        // The paragraph carrying a sectPr ends the current section; the new numbering starts after it.
        const xml = this.para({ sectPr: this.sectPr(this.doc.page, true) }, "");
        this.pageNumbering = b.numbering ?? this.pageNumbering;
        return xml;
      }
      case "float": {
        // Keep figures and tables on one page with their captions: everything before the last
        // caption keeps with next; a caption with content after it (caption above) keeps too.
        const last = b.content.map(x => x.kind).lastIndexOf("caption");
        return b.content.map((x, i) => {
          const keep = i < last || (x.kind === "caption" && i < b.content.length - 1);
          return this.block(x, { ...ctx, keepNext: keep || ctx.keepNext });
        }).join("");
      }
      case "caption": return this.caption(b.caption, !!ctx.keepNext);
      case "list": return this.list(b, ctx);
    }
  }

  /**
   * A display equation. Numbered rows use a center tab for the math and a right tab for the number
   * (plan approach A); the number is a SEQ field inside a bookmark so \eqref can point at it.
   */
  private equationRow(r: EquationRow, ctx: BlockCtx): string {
    if (r.number === undefined) {
      const { props, prefix } = this.contextual({ style: "Equation" }, ctx);
      return this.para(props, prefix + displayMath(r.tree));
    }
    const page = this.doc.page;
    const width = page.width - page.margin.left - page.margin.right;
    const { props, prefix } = this.contextual({ style: "Equation" }, ctx);
    const tabs: ParaProps["tabs"] = [{ val: "center", pos: Math.round(width / 2) }, { val: "right", pos: width }];
    let num = r.seq ? this.seqNumber(r.seq, r.number) : this.run(r.number, {});
    if (r.label) num = this.bookmark(r.label, num);
    const open = r.seq ? this.run("(", {}) : "", close = r.seq ? this.run(")", {}) : "";
    return this.para({ ...props, tabs, align: "left" },
      prefix + "<w:r><w:tab/></w:r>" + inlineMath(r.tree) + "<w:r><w:tab/></w:r>" + open + num + close);
  }

  /**
   * A caption or equation number as fields: "3" → SEQ; "2.3" → STYLEREF 1 (chapter) + "." + SEQ
   * restarting at each Heading 1, so updating fields in Word reproduces the cached numbers.
   */
  private seqNumber(seq: string, number: string, m: Marks = {}): string {
    const dot = number.lastIndexOf(".");
    if (dot > 0) {
      return this.field("STYLEREF 1 \\s", number.slice(0, dot), m) + this.run(".", m)
        + this.field(`SEQ ${seqName(seq)} \\* ARABIC \\s 1`, number.slice(dot + 1), m);
    }
    return this.field(`SEQ ${seqName(seq)} \\* ARABIC`, number, m);
  }

  private caption(c: Caption, above: boolean): string {
    let head = "";
    if (c.number) {
      let num = c.seq ? this.seqNumber(c.seq, c.number) : this.run(c.number, {});
      if (c.anchor) num = this.bookmark(c.anchor, num);
      head = (c.label ? this.run(c.label + "\u00A0", {}) : "") + num + (c.content.length ? this.run(c.label ? ": " : " ", {}) : "");
    }
    return this.para({ style: "Caption", keepNext: above }, head + this.inlines(c.content));
  }

  // ---- images ----

  private image(img: ImageRef): string {
    const store = (data: Uint8Array, ext: string): string => {
      const key = hashBytes(data) + ext;
      let path = this.mediaByHash.get(key);
      if (!path) {
        path = `media/image${this.media.length + 1}.${ext}`;
        this.media.push({ path, data, ext });
        this.mediaByHash.set(key, path);
      }
      return this.rel(REL.image, path);
    };
    let blip: string, svg: string | undefined;
    if (img.format === "svg") {
      svg = store(img.data, "svg");
      blip = store(img.fallback ?? BLANK_PNG, "png");
    } else {
      blip = store(img.data, img.format === "jpeg" ? "jpeg" : img.format);
    }
    return inlinePicture(img, this.docPrId++, blip, svg);
  }

  // ---- tables ----

  private table(b: Extract<Block, { kind: "table" }>, ctx: BlockCtx): string {
    const page = this.doc.page;
    const textWidth = page.width - page.margin.left - page.margin.right - (ctx.listLeft ?? 0);
    const ncols = Math.max(b.columns.length, ...b.rows.map(r => r.cells.reduce((n, c) => n + (c.colSpan ?? 1), 0)), 1);
    const widths = this.columnWidths(b, ncols, textWidth);
    const fixed = b.columns.some(c => c.width !== undefined || c.flex);
    const tblPr = ordered("w:tblPr", ORDER.tblPr, {
      "w:tblW": fixed ? el("w:tblW", { "w:w": widths.reduce((a, w) => a + w, 0), "w:type": "dxa" }) : el("w:tblW", { "w:w": 0, "w:type": "auto" }),
      "w:jc": b.align && b.align !== "justify" ? val("w:jc", JC[b.align]) : undefined,
      "w:tblLayout": el("w:tblLayout", { "w:type": fixed ? "fixed" : "autofit" }),
      "w:tblCellMar": el("w:tblCellMar", undefined, el("w:left", { "w:w": 115, "w:type": "dxa" }), el("w:right", { "w:w": 115, "w:type": "dxa" })),
      "w:tblLook": el("w:tblLook", { "w:val": "0000" }),
    });
    const grid = el("w:tblGrid", undefined, ...widths.map(w => el("w:gridCol", { "w:w": w })));
    const rows = b.rows.map(row => {
      const trPr = row.header ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
      let col = 0;
      const cells = row.cells.map(cell => {
        const span = cell.colSpan ?? 1;
        const w = widths.slice(col, col + span).reduce((a, x) => a + x, 0);
        col += span;
        return this.cell(cell, w, span, ctx);
      }).join("");
      return `<w:tr>${trPr}${cells}</w:tr>`;
    }).join("");
    // Word needs a paragraph between two adjacent tables, or it merges them.
    return el("w:tbl", undefined, tblPr, grid, rows);
  }

  private cell(cell: TableCell, width: number, span: number, ctx: BlockCtx): string {
    const borders = cell.borders && Object.values(cell.borders).some(Boolean)
      ? ordered("w:tcBorders", ORDER.tcBorders, {
          "w:top": cell.borders.top && border("w:top", cell.borders.top),
          "w:left": cell.borders.left && border("w:left", cell.borders.left),
          "w:bottom": cell.borders.bottom && border("w:bottom", cell.borders.bottom),
          "w:right": cell.borders.right && border("w:right", cell.borders.right),
        })
      : undefined;
    const tcPr = ordered("w:tcPr", ORDER.tcPr, {
      "w:tcW": el("w:tcW", { "w:w": width, "w:type": "dxa" }),
      "w:gridSpan": span > 1 ? val("w:gridSpan", span) : undefined,
      "w:vMerge": cell.merged ? "<w:vMerge/>" : cell.rowSpan && cell.rowSpan > 1 ? val("w:vMerge", "restart") : undefined,
      "w:tcBorders": borders,
      "w:vAlign": cell.valign ? val("w:vAlign", cell.valign) : undefined,
    });
    const inner: BlockCtx = { ...ctx, inCell: true, cellAlign: cell.align, listLeft: undefined, listDepth: undefined, firstNum: undefined };
    let body = cell.merged ? "" : this.blocks(cell.blocks, inner);
    if (!body.includes("<w:p>") && !body.includes("<w:p ")) body += this.para({ style: "Compact", align: cell.align, keepNext: ctx.keepNext }, "");
    // A cell must end with a paragraph (a nested table alone is not enough).
    if (body.endsWith("</w:tbl>")) body += this.para({ style: "Compact" }, "");
    return `<w:tc>${tcPr}${body}</w:tc>`;
  }

  /** Grid widths: fixed p{} widths, flexible X columns share what is left, others sized by content. */
  private columnWidths(b: Extract<Block, { kind: "table" }>, ncols: number, textWidth: number): number[] {
    const em = this.doc.docClass.baseSize * 20;
    const pad = 230;
    const natural = Array.from({ length: ncols }, () => 0);
    for (const row of b.rows) {
      let col = 0;
      for (const cell of row.cells) {
        const span = cell.colSpan ?? 1;
        if (span === 1 && !cell.merged) {
          const chars = Math.max(1, ...blocksText(cell.blocks).split("\n").map(l => [...l].length));
          natural[col] = Math.max(natural[col], Math.round(chars * em * 0.5) + pad);
        }
        col += span;
      }
    }
    const widths = natural.map((n, i) => {
      const spec = b.columns[i];
      if (spec?.width !== undefined) return spec.width + pad;
      return Math.max(n, 2 * em);
    });
    const flex = b.columns.map((c, i) => (c?.flex ? i : -1)).filter(i => i >= 0);
    if (flex.length) {
      const used = widths.reduce((a, w, i) => a + (flex.includes(i) ? 0 : w), 0);
      const share = Math.max(3 * em, Math.round((textWidth - used) / flex.length));
      for (const i of flex) widths[i] = share;
    }
    const total = widths.reduce((a, w) => a + w, 0);
    if (total > textWidth) {
      // Shrink content-sized columns proportionally; fixed widths are kept as the author set them.
      const shrinkable = widths.map((w, i) => (b.columns[i]?.width === undefined && !b.columns[i]?.flex ? w : 0));
      const s = shrinkable.reduce((a, w) => a + w, 0);
      const excess = total - textWidth;
      if (s > 0) for (let i = 0; i < widths.length; i++) if (shrinkable[i]) widths[i] = Math.max(2 * em, Math.round(widths[i] - excess * shrinkable[i] / s));
    }
    return widths;
  }

  private listAbstract(style: "itemize" | "enumerate", depth: number, format?: string, template?: string): number {
    const key = `${style}:${depth}:${format ?? ""}:${template ?? ""}`;
    const known = this.listAbstracts.get(key);
    if (known !== undefined) return known;
    const em = this.doc.docClass.baseSize * 20;
    const levels: LevelDef[] = [];
    const bullets = ["•", "–", "∗", "·"];
    const enums: [LevelDef["format"], string][] = [["decimal", "%L."], ["lowerLetter", "(%L)"], ["lowerRoman", "%L."], ["upperLetter", "%L."]];
    for (let i = 0; i < 9; i++) {
      const left = Math.round(2.5 * em * (i + 1));
      const hanging = Math.round(2 * em);
      if (style === "itemize") {
        const text = i === depth && template ? template : bullets[i % 4];
        levels.push({ format: "bullet", text, leftTw: left, hangingTw: hanging, font: this.fonts.serif });
      } else {
        const [fmt, tpl] = enums[i % 4];
        const useFmt = (i === depth && format ? format : fmt) as LevelDef["format"];
        const text = i === depth && template ? template.replace(/%1/g, `%${i + 1}`) : tpl.replace("%L", `%${i + 1}`);
        levels.push({ format: useFmt, text, leftTw: left, hangingTw: hanging });
      }
    }
    const id = this.numbering.addAbstract(levels);
    this.listAbstracts.set(key, id);
    return id;
  }

  private list(b: Extract<Block, { kind: "list" }>, ctx: BlockCtx): string {
    const depth = ctx.listDepth ?? 0;
    const em = this.doc.docClass.baseSize * 20;
    const left = Math.round(2.5 * em * (depth + 1));
    if (b.style === "description") {
      return b.items.map(item => this.descriptionItem(item, left, depth, ctx)).join("");
    }
    const abs = this.listAbstract(b.style, depth, b.format === "bullet" ? undefined : b.format, b.template);
    const numId = this.numbering.addNum(abs, b.style === "enumerate" ? b.start ?? 1 : undefined, depth);
    return b.items.map(item => {
      if (item.label) {
        // A custom \item[label] replaces the automatic number with literal text.
        const inner: BlockCtx = { ...ctx, listLeft: left, listDepth: depth + 1 };
        return this.labelled(item, left, inner);
      }
      const inner: BlockCtx = { ...ctx, listLeft: left, listDepth: depth + 1, firstNum: { ilvl: depth, numId, consumed: false } };
      let xml = this.blocks(item.blocks, inner);
      if (!inner.firstNum!.consumed) xml = this.para({ style: "ListParagraph", numPr: { ilvl: depth, numId } }, "") + xml;
      return item.anchor ? this.anchorFirstParagraph(xml, item.anchor) : xml;
    }).join("");
  }

  /** Wraps the content of the first paragraph in a bookmark (list items referenced by \ref). */
  private anchorFirstParagraph(xml: string, label: string): string {
    if (this.emitted.has(label)) return xml;
    this.emitted.add(label);
    const i = xml.indexOf("<w:p>");
    if (i < 0) return xml;
    const afterPPr = xml.indexOf("</w:pPr>", i);
    const insertAt = afterPPr >= 0 && afterPPr < xml.indexOf("</w:p>", i) ? afterPPr + 8 : i + 5;
    const end = xml.indexOf("</w:p>", i);
    const id = this.bookmarkId++;
    const name = this.bookmarks.name(label);
    return xml.slice(0, insertAt) + `<w:bookmarkStart w:id="${id}" w:name="${name}"/>` + xml.slice(insertAt, end)
      + `<w:bookmarkEnd w:id="${id}"/>` + xml.slice(end);
  }

  private labelled(item: ListItem, left: number, ctx: BlockCtx): string {
    const hanging = Math.round(2 * this.doc.docClass.baseSize * 20);
    const [first, ...rest] = item.blocks;
    const label = this.inlines(item.label ?? []) + "<w:r><w:tab/></w:r>";
    if (first && first.kind === "paragraph") {
      return this.para({ style: "ListParagraph", ind: { left, hanging } }, label + this.paragraphContent(first.content))
        + this.blocks(rest, ctx);
    }
    return this.para({ style: "ListParagraph", ind: { left, hanging } }, label) + this.blocks(item.blocks, ctx);
  }

  private descriptionItem(item: ListItem, left: number, depth: number, ctx: BlockCtx): string {
    const [first, ...rest] = item.blocks;
    const term = (item.label ?? []).map(n => n.kind === "text" ? { ...n, marks: { bold: true, ...n.marks } } : n);
    const lead = this.inlines(term) + (term.length ? this.run(" ", {}) : "");
    const inner: BlockCtx = { ...ctx, listLeft: left, listDepth: depth + 1 };
    const ind = { left, hanging: Math.round(2.5 * this.doc.docClass.baseSize * 20) };
    if (first && first.kind === "paragraph")
      return this.para({ style: "ListParagraph", ind }, lead + this.paragraphContent(first.content)) + this.blocks(rest, inner);
    return this.para({ style: "ListParagraph", ind }, lead) + this.blocks(item.blocks, inner);
  }

  // ---- parts ----

  sectPr(page: PageSetup, breakHere = false): string {
    const n = this.pageNumbering;
    return ordered("w:sectPr", ORDER.sectPr, {
      "w:headerReference": this.hfRefs.filter(r => r.startsWith("<w:headerReference")),
      "w:footerReference": this.hfRefs.filter(r => r.startsWith("<w:footerReference")),
      "w:type": breakHere ? val("w:type", "nextPage") : undefined,
      "w:pgSz": el("w:pgSz", { "w:w": page.width, "w:h": page.height, "w:orient": page.width > page.height ? "landscape" : undefined }),
      "w:pgMar": el("w:pgMar", { "w:top": page.margin.top, "w:right": page.margin.right, "w:bottom": page.margin.bottom,
        "w:left": page.margin.left, "w:header": page.margin.header, "w:footer": page.margin.footer, "w:gutter": 0 }),
      "w:pgNumType": n ? el("w:pgNumType", { "w:fmt": n.format, "w:start": n.start ?? 1 }) : undefined,
      "w:cols": el("w:cols", { "w:space": 720, "w:num": page.columns > 1 ? page.columns : undefined }),
      "w:titlePg": this.titlePg ? "<w:titlePg/>" : undefined,
      "w:docGrid": el("w:docGrid", { "w:linePitch": 360 }),
    });
  }

  /** One header or footer paragraph: left, tab, center, tab, right (tab stops at mid and full width). */
  private hfPart(kind: "header" | "footer", slots: HeaderFooterSlots | undefined, type: "default" | "first"): void {
    const page = this.doc.page;
    const width = page.width - page.margin.left - page.margin.right;
    const tabs: ParaProps["tabs"] = [{ val: "center", pos: Math.round(width / 2) }, { val: "right", pos: width }];
    const s = slots ?? {};
    const body = s.center || s.right
      ? this.inlines(s.left ?? []) + "<w:r><w:tab/></w:r>" + this.inlines(s.center ?? []) + (s.right ? "<w:r><w:tab/></w:r>" + this.inlines(s.right) : "")
      : this.inlines(s.left ?? []);
    const index = this.extraParts.filter(p => p.path.startsWith(kind)).length + 1;
    const path = `${kind}${index}.xml`;
    const root = kind === "header" ? "w:hdr" : "w:ftr";
    const p = this.para({ style: kind === "header" ? "Header" : "Footer", tabs }, body);
    this.extraParts.push({ path, contentType: kind === "header" ? CT.header : CT.footer,
      xml: XML_DECL + el(root, { "xmlns:w": NS.w, "xmlns:r": NS.r, "xmlns:m": NS.m, "xmlns:wp": NS.wp }, p) });
    const id = this.rel(kind === "header" ? REL.header : REL.footer, path, false, this.rels);
    this.hfRefs.push(el(kind === "header" ? "w:headerReference" : "w:footerReference", { "w:type": type, "r:id": id }));
  }

  private headersFooters(): void {
    const scope = this.relScope;
    const emit = (style: PageStyle, type: "default" | "first") => {
      if (style.header || type === "first") this.hfPart("header", style.header, type);
      if (style.footer || type === "first") this.hfPart("footer", style.footer, type);
    };
    emit(this.doc.pageStyle, "default");
    if (this.doc.firstPageStyle) { this.titlePg = true; emit(this.doc.firstPageStyle, "first"); }
    this.relScope = scope;
  }

  documentXml(): string {
    this.pageNumbering = this.doc.pageNumbering;
    this.headersFooters();
    let body = this.blocks(this.doc.blocks);
    // The body may not end with a table: Word requires a final paragraph before sectPr.
    if (body.endsWith("</w:tbl>")) body += "<w:p/>";
    body = separateTables(body);
    return XML_DECL + el("w:document", { "xmlns:w": NS.w, "xmlns:r": NS.r, "xmlns:m": NS.m, "xmlns:wp": NS.wp }, el("w:body", undefined, body + this.sectPr(this.doc.page)));
  }

  footnotesXml(): string | undefined {
    if (!this.footnotes.length) return undefined;
    const sep = (type: string, id: number, child: string) =>
      `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r>${child}</w:r></w:p></w:footnote>`;
    return XML_DECL + el("w:footnotes", { "xmlns:w": NS.w, "xmlns:r": NS.r, "xmlns:m": NS.m, "xmlns:wp": NS.wp },
      sep("separator", -1, "<w:separator/>"), sep("continuationSeparator", 0, "<w:continuationSeparator/>"), ...this.footnotes);
  }

  documentRels(): string { return relsXml(this.rels); }
  footnoteRelsXml(): string | undefined { return this.footnoteRels.length ? relsXml(this.footnoteRels) : undefined; }
}

export function buildParts(doc: Document, opts: WriteOptions = {}): Map<string, string | Uint8Array> {
  const w = new DocWriter(doc, opts);
  const lang = opts.lang ?? doc.meta.lang ?? "en-US";
  const documentXml = w.documentXml();      // first: discovers footnotes, links, numbering
  const footnotes = w.footnotesXml();
  const parts = new Map<string, string | Uint8Array>();
  const overrides: Record<string, string> = {
    "/word/document.xml": CT.document,
    "/word/styles.xml": CT.styles,
    "/word/settings.xml": CT.settings,
    "/word/numbering.xml": CT.numbering,
    "/docProps/core.xml": CT.core,
    "/docProps/app.xml": CT.app,
  };
  if (footnotes) overrides["/word/footnotes.xml"] = CT.footnotes;

  for (const x of w.extraParts) {
    overrides["/word/" + x.path] = x.contentType;
    parts.set("word/" + x.path, x.xml);
  }
  const mediaTypes: Record<string, string> = {};
  for (const m of w.media) mediaTypes[m.ext] = MEDIA_TYPES[m.ext];
  parts.set("[Content_Types].xml", contentTypesXml(overrides, mediaTypes));
  for (const m of w.media) parts.set("word/" + m.path, m.data);
  parts.set("_rels/.rels", packageRelsXml());
  parts.set("docProps/core.xml", coreXml({
    title: doc.meta.title ? plainText(doc.meta.title) : undefined,
    creator: doc.meta.authors.length ? doc.meta.authors.map(plainText).join("; ") : undefined,
    language: lang,
    created: opts.created,
  }));
  parts.set("docProps/app.xml", appXml());
  parts.set("word/document.xml", documentXml);
  parts.set("word/_rels/document.xml.rels", w.documentRels());
  parts.set("word/styles.xml", stylesXml({
    baseSize: doc.docClass.baseSize, fonts: w.fonts, lang, justify: true,
    numberedLevels: 3, chapters: doc.docClass.sectionLevel === 2,
  }));
  parts.set("word/numbering.xml", w.numbering.xml());
  parts.set("word/settings.xml", settingsXml({
    updateFields: w.needsUpdateFields, footnotes: !!footnotes, evenAndOddHeaders: false,
    autoHyphenation: true, lang, mathFont: w.fonts.math,
  }));
  if (footnotes) parts.set("word/footnotes.xml", footnotes);
  const fnRels = w.footnoteRelsXml();
  if (fnRels) parts.set("word/_rels/footnotes.xml.rels", fnRels);
  return parts;
}
