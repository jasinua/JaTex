// Default template: styles.xml generated from the document class.
// Semantics map to named styles (never direct formatting) so users and journal templates can restyle.

import { halfPoints, parIndentPt, sizePt, type ParagraphRole, type SizeName } from "@texdocx/model";
import { NS, ORDER, XML_DECL, el, ordered, val } from "./xml.ts";

export interface Fonts { serif: string; sans: string; mono: string; math: string }

export const DEFAULT_FONTS: Fonts = { serif: "Cambria", sans: "Calibri", mono: "Consolas", math: "Cambria Math" };

export interface StyleOptions {
  baseSize: number;          // class base size in points
  fonts: Fonts;
  lang: string;
  justify: boolean;
  /** Number of heading levels that carry automatic numbering (Heading 1..n). */
  numberedLevels: number;
  /** Heading 1 is \chapter (report, book): starts a new page. */
  chapters: boolean;
}

/** styleId for each paragraph role. Names (w:name) follow Word's built-ins where one exists. */
export const ROLE_STYLE: Record<ParagraphRole, string> = {
  body: "BodyText", firstParagraph: "FirstParagraph", compact: "Compact",
  title: "Title", subtitle: "Subtitle", author: "Author", date: "Date",
  abstractTitle: "AbstractTitle", abstract: "Abstract",
  quote: "BlockText", quotation: "Quotation", verse: "Verse",
  caption: "Caption", bibliography: "Bibliography", code: "SourceCode",
};

export const HEADING_NUM_ID = 1;

interface StyleDef {
  type: "paragraph" | "character" | "table" | "numbering";
  id: string;
  name: string;
  isDefault?: boolean;
  basedOn?: string;
  next?: string;
  link?: string;
  uiPriority?: number;
  semiHidden?: boolean;
  qFormat?: boolean;
  pPr?: Record<string, string | undefined>;
  rPr?: Record<string, string | undefined>;
}

const tw = (pt: number): number => Math.round(pt * 20);   // points → twips
const spacing = (beforePt: number, afterPt: number): string =>
  el("w:spacing", { "w:before": tw(beforePt), "w:after": tw(afterPt) });
const sz = (pt: number): Record<string, string> =>
  ({ "w:sz": val("w:sz", halfPoints(pt)), "w:szCs": val("w:szCs", halfPoints(pt)) });
const bold = { "w:b": "<w:b/>", "w:bCs": "<w:bCs/>" };
const fonts = (name: string): string =>
  el("w:rFonts", { "w:ascii": name, "w:hAnsi": name, "w:cs": name, "w:eastAsia": name });

function styleXml(s: StyleDef): string {
  return ordered("w:style", ORDER.style, {
    "w:name": val("w:name", s.name),
    "w:basedOn": s.basedOn && val("w:basedOn", s.basedOn),
    "w:next": s.next && val("w:next", s.next),
    "w:link": s.link && val("w:link", s.link),
    "w:uiPriority": s.uiPriority !== undefined ? val("w:uiPriority", s.uiPriority) : undefined,
    "w:semiHidden": s.semiHidden ? "<w:semiHidden/>" : undefined,
    "w:unhideWhenUsed": s.semiHidden ? "<w:unhideWhenUsed/>" : undefined,
    "w:qFormat": s.qFormat ? "<w:qFormat/>" : undefined,
    "w:pPr": s.pPr && ordered("w:pPr", ORDER.pPr, s.pPr),
    "w:rPr": s.rPr && ordered("w:rPr", ORDER.rPr, s.rPr),
  }, { "w:type": s.type, "w:default": s.isDefault ? "1" : undefined, "w:styleId": s.id });
}

export function headingStyles(o: StyleOptions): StyleDef[] {
  const b = o.baseSize;
  const S = (n: SizeName) => sizePt(b, n);
  const ex = 0.43 * b;   // x-height of Computer Modern, close enough for spacing
  // [size, before, after] for Word heading levels 1..6, following article.cls / report.cls.
  const sectionLike: [number, number, number][] = [
    [S("Large"), 3.5 * ex, 2.3 * ex],      // \section
    [S("large"), 3.25 * ex, 1.5 * ex],     // \subsection
    [S("normalsize"), 3.25 * ex, 1.5 * ex],// \subsubsection
    [S("normalsize"), 3.25 * ex, 0],       // \paragraph
    [S("normalsize"), 3.25 * ex, 0],       // \subparagraph
    [S("normalsize"), 3.25 * ex, 0],
  ];
  const levels: [number, number, number][] = o.chapters
    ? [[S("huge"), 50, 40], ...sectionLike.slice(0, 5)]
    : sectionLike;
  return levels.map(([size, before, after], i): StyleDef => {
    const level = i + 1;
    const numbered = level <= o.numberedLevels;
    return {
      type: "paragraph", id: `Heading${level}`, name: `heading ${level}`, basedOn: "Normal", next: "FirstParagraph",
      uiPriority: 9, qFormat: true,
      pPr: {
        "w:keepNext": "<w:keepNext/>", "w:keepLines": "<w:keepLines/>",
        "w:pageBreakBefore": o.chapters && level === 1 ? "<w:pageBreakBefore/>" : undefined,
        "w:numPr": numbered ? el("w:numPr", undefined, val("w:ilvl", level - 1), val("w:numId", HEADING_NUM_ID)) : undefined,
        "w:spacing": spacing(Math.round(before), Math.round(after)),
        "w:jc": val("w:jc", "left"),
        "w:outlineLvl": val("w:outlineLvl", level - 1),
      },
      rPr: { ...bold, ...sz(size) },
    };
  });
}

export function defaultStyles(o: StyleOptions): StyleDef[] {
  const b = o.baseSize;
  const S = (n: SizeName) => sizePt(b, n);
  const indent = parIndentPt(b);
  const em = b;
  const jc = val("w:jc", o.justify ? "both" : "left");
  return [
    { type: "paragraph", id: "Normal", name: "Normal", isDefault: true, qFormat: true,
      pPr: { "w:widowControl": "<w:widowControl/>" } },
    { type: "character", id: "DefaultParagraphFont", name: "Default Paragraph Font", isDefault: true,
      uiPriority: 1, semiHidden: true },
    { type: "paragraph", id: "BodyText", name: "Body Text", basedOn: "Normal", qFormat: true,
      pPr: { "w:spacing": spacing(0, 0), "w:ind": el("w:ind", { "w:firstLine": tw(indent) }), "w:jc": jc } },
    { type: "paragraph", id: "FirstParagraph", name: "First Paragraph", basedOn: "BodyText", next: "BodyText", qFormat: true,
      pPr: { "w:ind": el("w:ind", { "w:firstLine": 0 }) } },
    { type: "paragraph", id: "Compact", name: "Compact", basedOn: "BodyText", qFormat: true,
      pPr: { "w:spacing": spacing(0, 0), "w:ind": el("w:ind", { "w:firstLine": 0 }) } },
    { type: "paragraph", id: "Title", name: "Title", basedOn: "Normal", next: "Author", qFormat: true, uiPriority: 10,
      pPr: { "w:keepNext": "<w:keepNext/>", "w:keepLines": "<w:keepLines/>", "w:spacing": spacing(2 * em, 1.5 * em),
        "w:jc": val("w:jc", "center") },
      rPr: sz(S("LARGE")) },
    { type: "paragraph", id: "Subtitle", name: "Subtitle", basedOn: "Title", next: "Author", qFormat: true,
      pPr: { "w:spacing": spacing(0, em) }, rPr: sz(S("large")) },
    { type: "paragraph", id: "Author", name: "Author", basedOn: "Normal", next: "Date", qFormat: true,
      pPr: { "w:keepNext": "<w:keepNext/>", "w:keepLines": "<w:keepLines/>", "w:spacing": spacing(0, 0.5 * em),
        "w:jc": val("w:jc", "center") },
      rPr: sz(S("large")) },
    { type: "paragraph", id: "Date", name: "Date", basedOn: "Author", next: "FirstParagraph", qFormat: true,
      pPr: { "w:spacing": spacing(0.5 * em, 1.5 * em) } },
    { type: "paragraph", id: "AbstractTitle", name: "Abstract Title", basedOn: "Normal", next: "Abstract", qFormat: true,
      pPr: { "w:keepNext": "<w:keepNext/>", "w:spacing": spacing(0, 0.5 * em), "w:jc": val("w:jc", "center") },
      rPr: { ...bold, ...sz(S("small")) } },
    { type: "paragraph", id: "Abstract", name: "Abstract", basedOn: "Normal", next: "FirstParagraph", qFormat: true,
      pPr: { "w:spacing": spacing(0, 0), "w:ind": el("w:ind", { "w:left": tw(2.5 * em), "w:right": tw(2.5 * em), "w:firstLine": tw(indent) }), "w:jc": jc },
      rPr: sz(S("small")) },
    { type: "paragraph", id: "Part", name: "Part", basedOn: "Normal", next: "FirstParagraph", qFormat: true,
      pPr: { "w:keepNext": "<w:keepNext/>", "w:pageBreakBefore": o.chapters ? "<w:pageBreakBefore/>" : undefined,
        "w:spacing": spacing(4 * em, 2 * em), "w:jc": val("w:jc", "center") },
      rPr: { ...bold, ...sz(S("huge")) } },
    ...headingStyles(o),
    { type: "paragraph", id: "ListParagraph", name: "List Paragraph", basedOn: "Normal", qFormat: true, uiPriority: 34,
      pPr: { "w:spacing": spacing(0, 0.3 * em), "w:jc": jc } },
    { type: "paragraph", id: "BlockText", name: "Block Text", basedOn: "Normal", next: "FirstParagraph", qFormat: true,
      pPr: { "w:spacing": spacing(0.5 * em, 0.5 * em), "w:ind": el("w:ind", { "w:left": tw(2.5 * em), "w:right": tw(2.5 * em) }), "w:jc": jc } },
    { type: "paragraph", id: "Quotation", name: "Quotation", basedOn: "BlockText", qFormat: true,
      pPr: { "w:ind": el("w:ind", { "w:left": tw(2.5 * em), "w:right": tw(2.5 * em), "w:firstLine": tw(indent) }) } },
    { type: "paragraph", id: "Verse", name: "Verse", basedOn: "BlockText", qFormat: true,
      pPr: { "w:ind": el("w:ind", { "w:left": tw(4 * em), "w:right": tw(2.5 * em), "w:hanging": tw(1.5 * em) }), "w:jc": val("w:jc", "left") } },
    { type: "paragraph", id: "Equation", name: "Equation", basedOn: "Normal", next: "BodyText", qFormat: true,
      pPr: { "w:keepLines": "<w:keepLines/>", "w:spacing": spacing(0.6 * em, 0.6 * em), "w:jc": val("w:jc", "center") } },
    { type: "paragraph", id: "Caption", name: "caption", basedOn: "Normal", next: "BodyText", qFormat: true, uiPriority: 35,
      pPr: { "w:spacing": spacing(0.5 * em, em), "w:jc": val("w:jc", "center") } },
    { type: "paragraph", id: "Bibliography", name: "Bibliography", basedOn: "Normal", uiPriority: 37,
      pPr: { "w:spacing": spacing(0, 0.4 * em), "w:ind": el("w:ind", { "w:left": tw(2 * em), "w:hanging": tw(2 * em) }), "w:jc": jc } },
    { type: "paragraph", id: "SourceCode", name: "Source Code", basedOn: "Normal", link: "VerbatimChar", qFormat: true,
      pPr: { "w:spacing": spacing(0.5 * em, 0.5 * em), "w:jc": val("w:jc", "left") },
      rPr: { "w:rFonts": fonts(o.fonts.mono), "w:noProof": "<w:noProof/>", ...sz(S("small")) } },
    { type: "character", id: "VerbatimChar", name: "Verbatim Char", basedOn: "DefaultParagraphFont", link: "SourceCode",
      rPr: { "w:rFonts": fonts(o.fonts.mono), "w:noProof": "<w:noProof/>" } },
    { type: "paragraph", id: "FootnoteText", name: "footnote text", basedOn: "Normal", link: "FootnoteTextChar",
      uiPriority: 99, semiHidden: true,
      pPr: { "w:spacing": spacing(0, 0), "w:jc": jc }, rPr: sz(S("footnotesize")) },
    { type: "character", id: "FootnoteTextChar", name: "Footnote Text Char", basedOn: "DefaultParagraphFont",
      link: "FootnoteText", uiPriority: 99, semiHidden: true, rPr: sz(S("footnotesize")) },
    { type: "character", id: "FootnoteReference", name: "footnote reference", basedOn: "DefaultParagraphFont",
      uiPriority: 99, semiHidden: true, rPr: { "w:vertAlign": val("w:vertAlign", "superscript") } },
    { type: "paragraph", id: "Header", name: "header", basedOn: "Normal", uiPriority: 99, pPr: { "w:jc": val("w:jc", "left") }, rPr: sz(S("small")) },
    { type: "paragraph", id: "Footer", name: "footer", basedOn: "Normal", uiPriority: 99, pPr: { "w:jc": val("w:jc", "left") }, rPr: sz(S("small")) },
    { type: "character", id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont", uiPriority: 99,
      rPr: { "w:color": val("w:color", "0563C1"), "w:u": val("w:u", "single") } },
    { type: "paragraph", id: "TOCHeading", name: "TOC Heading", basedOn: "Heading1", next: "Normal",
      uiPriority: 39, qFormat: true,
      pPr: { "w:pageBreakBefore": el("w:pageBreakBefore", { "w:val": "0" }),
        "w:numPr": el("w:numPr", undefined, val("w:ilvl", 0), val("w:numId", 0)), "w:outlineLvl": val("w:outlineLvl", 9) } },
    { type: "table", id: "TableNormal", name: "Normal Table", isDefault: true, uiPriority: 99, semiHidden: true },
    { type: "numbering", id: "NoList", name: "No List", isDefault: true, uiPriority: 99, semiHidden: true },
  ];
}

export function stylesXml(o: StyleOptions): string {
  const docDefaults = el("w:docDefaults", undefined,
    el("w:rPrDefault", undefined, ordered("w:rPr", ORDER.rPr, {
      "w:rFonts": fonts(o.fonts.serif),
      ...sz(o.baseSize),
      "w:lang": el("w:lang", { "w:val": o.lang, "w:eastAsia": o.lang, "w:bidi": "ar-SA" }),
    })),
    el("w:pPrDefault", undefined, ordered("w:pPr", ORDER.pPr, {
      "w:spacing": el("w:spacing", { "w:after": 0, "w:line": 240, "w:lineRule": "auto" }),
    })));
  return XML_DECL + el("w:styles", { "xmlns:w": NS.w }, docDefaults, ...defaultStyles(o).map(styleXml));
}
