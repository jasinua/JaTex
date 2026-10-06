// Document structure: class, packages, document, sections, title block, environments, lists,
// footnotes, labels and references, verbatim, display math.

import {
  Cat, csTok, refStepCounter, setCounterValue, stepCounter, tokensToString, type Arg, type CsToken, type Loc, type Token,
} from "@texdocx/core";
import { MathParser, type MathRow } from "@texdocx/math";
import { A4, LETTER, type Block, type EquationRow, type Inline, type MathNode, type PageSetup } from "@texdocx/model";
import { classCode, classInfo } from "../classes.ts";
import type { Digester } from "../digester.ts";
import { highlight } from "../highlight.ts";
import { setLineWidth } from "./floats.ts";
import { lengthPt } from "./text.ts";

/** Packages whose commands are handled (or safely ignored) without a warning. */
export const KNOWN_PACKAGES = new Set(("amsmath amssymb amsthm amsfonts amstext amsbsy amsopn amscd mathtools graphicx graphics "
  + "hyperref url xcolor color geometry inputenc fontenc babel polyglossia fontspec lmodern times mathptmx palatino "
  + "mathpazo helvet courier microtype booktabs array tabularx longtable multirow multicol enumitem natbib biblatex "
  + "cite cleveref verbatim listings minted fancyvrb xspace ifthen etoolbox xparse calc float caption subcaption "
  + "subfig wrapfig setspace parskip fancyhdr titlesec titling textcomp gensymb csquotes dsfont mathrsfs stmaryrd "
  + "bbm bm upgreek physics nicefrac xfrac units makeidx todonotes comment appendix authblk footmisc ragged2e "
  + "lipsum blindtext siunitx tikz pgfplots algorithm algorithmic algorithmicx algpseudocode algorithm2e "
  + "placeins afterpage lscape pdflscape rotating hyphenat soul ulem varioref nameref xurl bookmark breakurl "
  + "orcidlink doi newtxtext newtxmath libertine kpfonts charter fourier eulervm tgtermes tgpagella tgheros "
  + "sourcesanspro sourcecodepro inconsolata beramono microtype accents cancel slashed braket tensor mhchem "
  + "chemformula xltxtra xunicode unicode-math luatextra iftex ifpdf ifxetex ifluatex epstopdf grffile "
  + "float trimspaces kvoptions keyval pgf environ adjustbox tcolorbox mdframed framed thmtools ntheorem "
  + "chngcntr fancybox eso-pic background datetime datetime2 fmtcount totcount refcount lastpage "
  + "threeparttable dcolumn colortbl xltabular tabu makecell diagbox arydshln hhline ltablex supertabular "
  + "glossaries acronym nomencl imakeidx index showkeys showlabels draftwatermark tocbibind tocloft "
  + "titletoc minitoc emptypage indentfirst changepage geometry typearea scrlayer-scrpage anyfontsize "
  + "relsize fix-cm type1cm sectsty secdot abstract quoting epigraph marginnote sidenotes snotez "
  + "hypcap bigfoot manyfoot fnpct endnotes xr xr-hyperref zref cmap mmap accsupp silence").split(/\s+/));

const LANGS: Record<string, string> = {
  english: "en-US", american: "en-US", USenglish: "en-US", british: "en-GB", UKenglish: "en-GB", australian: "en-AU",
  canadian: "en-CA", german: "de-DE", ngerman: "de-DE", austrian: "de-AT", naustrian: "de-AT", swissgerman: "de-CH",
  french: "fr-FR", francais: "fr-FR", spanish: "es-ES", italian: "it-IT", portuguese: "pt-PT", portuges: "pt-PT",
  brazil: "pt-BR", brazilian: "pt-BR", dutch: "nl-NL", russian: "ru-RU", polish: "pl-PL", czech: "cs-CZ",
  slovak: "sk-SK", swedish: "sv-SE", danish: "da-DK", finnish: "fi-FI", norsk: "nb-NO", norwegian: "nb-NO",
  nynorsk: "nn-NO", greek: "el-GR", turkish: "tr-TR", catalan: "ca-ES", hungarian: "hu-HU", magyar: "hu-HU",
  croatian: "hr-HR", serbian: "sr-Latn-RS", slovene: "sl-SI", ukrainian: "uk-UA", romanian: "ro-RO",
  bulgarian: "bg-BG", estonian: "et-EE", latvian: "lv-LV", lithuanian: "lt-LT", icelandic: "is-IS",
  irish: "ga-IE", welsh: "cy-GB", basque: "eu-ES", galician: "gl-ES", hebrew: "he-IL", arabic: "ar-SA",
  persian: "fa-IR", hindi: "hi-IN", japanese: "ja-JP", chinese: "zh-CN", korean: "ko-KR", vietnamese: "vi-VN",
  indonesian: "id-ID", bahasa: "id-ID", malay: "ms-MY", albanian: "sq-AL", macedonian: "mk-MK", afrikaans: "af-ZA",
};

const PAPERS: Record<string, { width: number; height: number }> = {
  a4paper: A4, letterpaper: LETTER, a5paper: { width: 8391, height: 11906 }, b5paper: { width: 9978, height: 14173 },
  legalpaper: { width: 12240, height: 20160 }, executivepaper: { width: 10440, height: 15120 }, a3paper: { width: 16838, height: 23811 },
};

const splitList = (s: string): string[] => s.split(",").map(x => x.trim()).filter(Boolean);

/** key=value option list → map (values keep braces stripped). */
export function parseKeyVals(s: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0, cur = "";
  const parts: string[] = [];
  for (const ch of s) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  for (const p of parts) {
    const i = p.indexOf("=");
    const k = (i < 0 ? p : p.slice(0, i)).trim();
    if (!k) continue;
    out.set(k, i < 0 ? "" : p.slice(i + 1).trim().replace(/^\{([\s\S]*)\}$/, "$1"));
  }
  return out;
}

function twipsOf(d: Digester, value: string, t: Loc): number {
  const toks: Token[] = [...value].map(ch => ({ kind: "char", ch, cat: ch === " " ? Cat.Space : /[A-Za-z]/.test(ch) ? Cat.Letter : Cat.Other, file: -1, pos: 0 }));
  return Math.round(lengthPt(d, toks, t) * 20 * 72 / 72.27);
}

export function applyGeometry(d: Digester, opts: string, t: Loc): void {
  const page: PageSetup = d.doc.page;
  for (const [k, v] of parseKeyVals(opts)) {
    if (PAPERS[k]) { page.width = PAPERS[k].width; page.height = PAPERS[k].height; continue; }
    if (k === "paper" && PAPERS[v]) { page.width = PAPERS[v].width; page.height = PAPERS[v].height; continue; }
    if (k === "landscape") { const w = Math.max(page.width, page.height), h = Math.min(page.width, page.height); page.width = w; page.height = h; continue; }
    if (k === "portrait") { const w = Math.min(page.width, page.height), h = Math.max(page.width, page.height); page.width = w; page.height = h; continue; }
    if (!v) continue;
    const tw = () => twipsOf(d, v, t);
    switch (k) {
      case "margin": { const x = tw(); page.margin = { ...page.margin, top: x, bottom: x, left: x, right: x }; break; }
      case "hmargin": case "lrmargin": { const parts = v.split(","); page.margin.left = twipsOf(d, parts[0], t); page.margin.right = twipsOf(d, parts[1] ?? parts[0], t); break; }
      case "vmargin": case "tbmargin": { const parts = v.split(","); page.margin.top = twipsOf(d, parts[0], t); page.margin.bottom = twipsOf(d, parts[1] ?? parts[0], t); break; }
      case "left": case "lmargin": case "inner": page.margin.left = tw(); break;
      case "right": case "rmargin": case "outer": page.margin.right = tw(); break;
      case "top": case "tmargin": page.margin.top = tw(); break;
      case "bottom": case "bmargin": page.margin.bottom = tw(); break;
      case "paperwidth": page.width = tw(); break;
      case "paperheight": page.height = tw(); break;
      case "textwidth": case "width": { const w = tw(); const m = Math.max(0, Math.round((page.width - w) / 2)); page.margin.left = m; page.margin.right = m; break; }
      case "textheight": case "height": { const h = tw(); const m = Math.max(0, Math.round((page.height - h) / 2)); page.margin.top = m; page.margin.bottom = m; break; }
      case "headsep": case "footskip": case "headheight": case "includeheadfoot": case "includehead": case "includefoot": break;
      default: break;
    }
  }
  syncLengths(d);
}

/** Keeps \textwidth and friends in step with the page setup (for width=.5\textwidth). */
export function syncLengths(d: Digester): void {
  const p = d.doc.page;
  const toSp = (tw: number) => Math.round(tw / 20 * 72.27 / 72 * 65536);
  const text = toSp(p.width - p.margin.left - p.margin.right);
  for (const n of ["textwidth", "linewidth", "columnwidth", "hsize"]) d.e.setRegister("skip", n, n === "columnwidth" && p.columns > 1 ? Math.round(text / p.columns) : text, true);
  d.e.setRegister("skip", "textheight", toSp(p.height - p.margin.top - p.margin.bottom), true);
  d.e.setRegister("skip", "paperwidth", toSp(p.width), true);
  d.e.setRegister("skip", "paperheight", toSp(p.height), true);
}

function headingLevel(d: Digester, latexLevel: number): number {
  if (latexLevel < 0 || (latexLevel === 0 && d.doc.docClass.sectionLevel === 1)) return 0;   // \part
  return latexLevel + (d.doc.docClass.sectionLevel === 2 ? 1 : 0);
}

const SECTIONS: [string, number][] = [["part", -1], ["chapter", 0], ["section", 1], ["subsection", 2],
  ["subsubsection", 3], ["paragraph", 4], ["subparagraph", 5]];

/** Splits author tokens at top-level \and. */
function splitAnd(toks: Token[]): Token[][] {
  const out: Token[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.kind === "char" && t.cat === Cat.BeginGroup) depth++;
    if (t.kind === "char" && t.cat === Cat.EndGroup) depth--;
    if (depth === 0 && t.kind === "cs" && (t.name === "and" || t.name === "And" || t.name === "AND")) { out.push([]); continue; }
    out[out.length - 1].push(t);
  }
  return out.filter(p => p.some(t => !(t.kind === "char" && t.cat === Cat.Space)));
}

export function installStructure(d: Digester): void {
  const e = d.e;

  // ---- class and packages
  d.def("documentclass", { sig: "o m o", run: (d, [opts, cls], t) => {
    const name = d.argString(cls);
    const info = classInfo(name);
    if (!info.known) d.warnOnce("class:" + name, "W010", `unknown class ${name}; using article`, t);
    if (name === "beamer") d.warnOnce("beamer", "W014", "beamer slides are converted as a plain document", t);
    const options = opts.present ? splitList(d.argString(opts)) : [];
    const size = options.map(o => /^(\d+)pt$/.exec(o)?.[1]).find(Boolean);
    d.doc.docClass = {
      name, baseSize: size === "11" ? 11 : size === "12" ? 12 : 10,
      twoside: options.includes("twoside") || (info.base === "book" && !options.includes("oneside")),
      sectionLevel: info.base === "article" ? 1 : 2,
    };
    e.emPt = d.doc.docClass.baseSize;
    e.state.set("documentclass", name, true);
    applyGeometry(d, options.filter(o => PAPERS[o] || o === "landscape").join(","), t);
    if (options.includes("twocolumn")) d.doc.page.columns = 2;
    e.pushFile(`<class ${info.base}>`, classCode(info));
  } });
  const usePackage = (d: Digester, [opts, pkgs]: Arg[], t: CsToken) => {
    const options = opts.present ? d.argString(opts) : "";
    for (const name of splitList(d.argString(pkgs))) {
      d.packages.add(name);
      e.state.set("pkg:" + name, true, true);
      if (!KNOWN_PACKAGES.has(name)) d.warnOnce("pkg:" + name, "W010", `unknown package ${name}; its commands will be reported as unknown`, t);
      if (name === "geometry" && options) applyGeometry(d, options, t);
      if (name === "babel" || name === "polyglossia") {
        const lang = splitList(options).map(o => o.replace(/^main=/, "")).reverse().find(o => LANGS[o]);
        if (lang) d.doc.meta.lang = LANGS[lang];
      }
    }
  };
  d.def("usepackage", { sig: "o m o", run: usePackage });
  d.def("RequirePackage", { sig: "o m o", run: usePackage });
  d.def("geometry", { sig: "m", run: (d, [a], t) => applyGeometry(d, d.argString(a), t) });
  d.def("newgeometry", { sig: "m", run: (d, [a], t) => applyGeometry(d, d.argString(a), t) });
  d.def("setdefaultlanguage", { sig: "o m", run: (d, [, a]) => { const l = LANGS[d.argString(a)]; if (l) d.doc.meta.lang = l; } });
  d.def("setmainlanguage", { sig: "o m", run: (d, [, a]) => { const l = LANGS[d.argString(a)]; if (l) d.doc.meta.lang = l; } });
  d.def("AtBeginDocument", { sig: "m", run: (d, [a]) => {
    if (d.inDocument) d.digestTokens(a.tokens); else d.atBeginDocument.push(...a.tokens);
  } });
  d.def("AtEndDocument", { sig: "m", run: () => {} });

  // ---- \begin / \end
  d.def("begin", { sig: "m", run: (d, [a], t) => {
    const name = d.argString(a);
    if (name === "document") {
      if (d.inDocument) { e.diag.error("E006", "\\begin{document} used twice", t); return; }
      d.inDocument = true;
      syncLengths(d);
      if (d.atBeginDocument.length) e.pushBack(d.atBeginDocument);
      return;
    }
    d.beginEnvironment(name, t);
  } });
  d.def("end", { sig: "m", run: (d, [a], t) => {
    const name = d.argString(a);
    if (name === "document") {
      d.closeParagraph();
      while (d.envStack.length) {
        const f = d.envStack[d.envStack.length - 1];
        e.diag.error("E006", `\\begin{${f.name}} ended by \\end{document}`, f.loc);
        d.finishEnvironment(f, t);
      }
      d.stopped = true;
      return;
    }
    d.endEnvironment(name, t);
  } });
  d.def("\u0000endenv", { sig: "m", run: (d, [a], t) => d.closeEnvironmentNamed(tokensToString(a.tokens), t) });

  // ---- sectioning
  for (const [name, latexLevel] of SECTIONS) {
    d.def(name, { sig: "s o m", mode: "block", run: (d, [star, , title], t) => {
      if (name === "chapter" && d.doc.docClass.sectionLevel === 1) {
        d.warnOnce("chapter-article", "W014", "\\chapter in a class without chapters is treated as \\section", t);
      }
      const level = name === "chapter" && d.doc.docClass.sectionLevel === 1 ? 1 : headingLevel(d, latexLevel);
      const counter = name === "chapter" && d.doc.docClass.sectionLevel === 1 ? "section" : name;
      const depth = e.register("count", "c@secnumdepth") as number;
      const frontOrBack = name === "chapter" && e.state.get("@mainmatter") === false;
      const numbered = !star.present && latexLevel <= depth && name !== "part" && !frontOrBack;
      if (!star.present && !frontOrBack) refStepCounter(e, counter, t);
      const content = d.captureInline(title.tokens);
      const block: Extract<Block, { kind: "heading" }> = { kind: "heading", level, numbered, content, span: d.span(t) };
      if (name === "part" && !star.present) {
        const label = `${d.argString([csTok("partname")])} ${d.theCounter("part")}`;
        content.unshift({ kind: "text", text: label, marks: {} }, { kind: "lineBreak" });
      }
      d.addBlock(block);
      d.afterHeading = true;
      d.labelTarget = star.present ? null : { kind: "heading", claim: key => (block.label ??= key) };
    } });
  }

  // ---- title block
  const store = (key: string) => (d: Digester, args: Arg[]) => { d.e.state.set(key, args[args.length - 1].tokens, true); };
  d.def("title", { sig: "o m", run: store("@title") });
  d.def("subtitle", { sig: "o m", run: store("@subtitle") });
  d.def("author", { sig: "o m", run: (d, [, a]) => {
    // authblk/elsarticle-style repeated \author calls accumulate.
    const prev = d.e.state.get<Token[]>("@author") ?? [];
    d.e.state.set("@author", prev.length ? [...prev, csTok("and"), ...a.tokens] : a.tokens, true);
  } });
  d.def("date", { sig: "m", run: store("@date") });
  d.def("affil", { sig: "o m", run: (d, [, a]) => {
    const prev = d.e.state.get<Token[][]>("@affil") ?? [];
    d.e.state.set("@affil", [...prev, a.tokens], true);
  } });
  for (const name of ["affiliation", "address", "institute", "institution"]) d.def(name, { sig: "o m", run: (d, [, a]) => {
    const prev = d.e.state.get<Token[][]>("@affil") ?? [];
    d.e.state.set("@affil", [...prev, a.tokens], true);
  } });
  d.def("thanks", { sig: "m", mode: "inline", run: (d, [a]) => {
    const body = d.captureBlocks(a.tokens);
    d.inline({ kind: "footnote", body });
  } });
  d.def("and", { mode: "inline", run: d => d.literal(", ") });
  d.def("maketitle", { mode: "block", run: (d, _a, t) => {
    e.state.set("@maketitle", true, true);
    const title = e.state.get<Token[]>("@title");
    const authors = e.state.get<Token[]>("@author");
    const date = e.state.get<Token[]>("@date");
    if (title) {
      const content = d.captureInline(title);
      d.doc.meta.title = content.filter(n => n.kind !== "footnote");
      d.addBlock({ kind: "paragraph", role: "title", content, span: d.span(t) });
    }
    const sub = e.state.get<Token[]>("@subtitle");
    if (sub) d.addBlock({ kind: "paragraph", role: "subtitle", content: d.captureInline(sub), span: d.span(t) });
    if (authors) {
      for (const part of splitAnd(authors)) {
        const content = d.captureInline(part);
        if (!content.length) continue;
        d.doc.meta.authors.push(content.filter(n => n.kind !== "footnote"));
        d.addBlock({ kind: "paragraph", role: "author", content, span: d.span(t) });
      }
    }
    for (const aff of e.state.get<Token[][]>("@affil") ?? []) {
      const content = d.captureInline(aff);
      if (content.length) d.addBlock({ kind: "paragraph", role: "author", content, span: d.span(t) });
    }
    const dateToks = date ?? [csTok("today")];
    const dateContent = d.captureInline(dateToks);
    if (dateContent.length) {
      d.doc.meta.date = dateContent;
      d.addBlock({ kind: "paragraph", role: "date", content: dateContent, span: d.span(t) });
    }
    d.afterHeading = false;
  } });

  // ---- environments: abstract, alignment, quotes
  d.env("abstract", { mode: "block", display: true, begin: (d, _a, t) => {
    const name = d.captureInline([csTok("abstractname", t)]);
    d.addBlock({ kind: "paragraph", role: "abstractTitle", content: name, span: d.span(t) });
    e.state.set("par:role", "abstract");
  } });
  for (const [name, align] of [["center", "center"], ["flushleft", "left"], ["flushright", "right"]] as const) {
    d.env(name, { mode: "block", display: true, begin: () => { e.state.set("par:align", align); } });
  }
  for (const [name, role] of [["quote", "quote"], ["quotation", "quotation"], ["verse", "verse"]] as const) {
    d.env(name, { mode: "block", display: true, begin: () => { e.state.set("par:role", role); } });
  }
  d.env("minipage", { sig: "o o o m", display: true, begin: (d, args, t) => {
    d.warnOnce("minipage", "W014", "minipage content is flattened", t);
    setLineWidth(d, args[3].tokens, t, true);
  } });
  d.env("titlepage", { mode: "block", begin: () => {} });
  d.env("small", { begin: d => d.setMarks({ ...d.marks }) });

  // ---- footnotes
  d.def("footnote", { sig: "o m", mode: "inline", run: (d, [num, body], t) => {
    if (num.present) setCounterValue(e, "footnote", Number(d.argString(num)) || 0, t);
    else stepCounter(e, "footnote", t);
    d.inline({ kind: "footnote", body: d.captureBlocks(body.tokens) });
  } });
  d.def("footnotemark", { sig: "o", mode: "inline", run: (d, [num], t) => {
    if (num.present) setCounterValue(e, "footnote", Number(d.argString(num)) || 0, t);
    else stepCounter(e, "footnote", t);
    const node: Extract<Inline, { kind: "footnote" }> = { kind: "footnote", body: [] };
    d.pendingFootnoteMarks.push(node);
    d.inline(node);
  } });
  d.def("footnotetext", { sig: "o m", run: (d, [, body], t) => {
    const node = d.pendingFootnoteMarks.shift();
    const blocks = d.captureBlocks(body.tokens);
    if (node) node.body = blocks;
    else {
      e.diag.warn("W014", "\\footnotetext without a preceding \\footnotemark; attached here", t);
      d.inline({ kind: "footnote", body: blocks });
    }
  } });

  // ---- labels and references
  d.def("label", { sig: "m", run: (d, [key], t) => d.setLabel(d.argString(key), t) });
  d.def("ref", { sig: "s m", mode: "inline", run: (d, [, key], t) => d.ref(d.argString(key), "number", t) });
  d.def("pageref", { sig: "s m", mode: "inline", run: (d, [, key], t) => d.ref(d.argString(key), "page", t) });
  d.def("eqref", { sig: "m", mode: "inline", run: (d, [key], t) => d.ref(d.argString(key), "number", t, ["(", ")"]) });
  d.def("autoref", { sig: "s m", mode: "inline", run: (d, [, key], t) => d.ref(d.argString(key), "name+number", t) });
  d.def("nameref", { sig: "s m", mode: "inline", run: (d, [, key], t) => d.ref(d.argString(key), "number", t) });
  d.def("vref", { sig: "s m", mode: "inline", run: (d, [, key], t) => d.ref(d.argString(key), "number", t) });
  for (const name of ["cref", "Cref", "cpageref", "Cpageref", "crefrange", "Crefrange", "labelcref"]) {
    d.def(name, { sig: name.includes("range") ? "s m m" : "s m", mode: "inline", run: (d, args, t) => {
      const keys = splitList(d.argString(args[1]));
      const form = name.includes("page") ? "page" : name === "labelcref" ? "number" : "name+number";
      keys.forEach((k, i) => {
        if (i > 0) d.literal(i === keys.length - 1 ? (keys.length > 2 ? ", and " : " and ") : ", ");
        d.ref(k, form, t);
      });
      if (name.includes("range") && args[2]) { d.literal(" to "); d.ref(d.argString(args[2]), "number", t); }
    } });
  }

  // ---- table of contents
  d.def("tableofcontents", { mode: "block", run: d => d.addBlock({ kind: "toc", depth: Math.max(1, Math.min(9, e.register("count", "c@tocdepth") as number + (d.doc.docClass.sectionLevel === 2 ? 1 : 0))) }) });

  // ---- citations (phase 6 formats them; until then the keys are kept visible)
  const cite = (mode: "paren" | "text") => (d: Digester, args: Arg[]) => {
    const keys = splitList(d.argString(args[args.length - 1]));
    const opts = args.slice(0, -1).filter(a => a.present).map(a => d.argString(a));
    d.inline({ kind: "cite", keys, mode, prefix: opts.length === 2 ? opts[0] : undefined, locator: opts.length ? opts[opts.length - 1] : undefined });
  };
  for (const name of ["cite", "citep", "parencite", "autocite", "footcite", "supercite", "citealp", "Citep", "Parencite", "Autocite", "smartcite", "nocite@"]) {
    d.def(name, { sig: "s o o m", mode: "inline", run: (d, args) => cite("paren")(d, args.slice(1)) });
  }
  for (const name of ["citet", "textcite", "Textcite", "Citet", "citealt", "citeauthor", "Citeauthor", "citeyear", "citeyearpar", "citetitle"]) {
    d.def(name, { sig: "s o o m", mode: "inline", run: (d, args) => cite("text")(d, args.slice(1)) });
  }
  d.def("nocite", { sig: "m", run: () => {} });

  // ---- verbatim-like environments
  const rawEnv = (name: string, opts: { language?: (args: Arg[], d: Digester) => string | undefined; skip?: boolean; sig?: string }) => {
    d.env(name, { sig: opts.sig ?? "", mode: "block", display: true, selfClosing: true, begin: (d, args, t) => {
      const lx = e.currentLexer();
      const endRe = new RegExp("\\\\end[ \\t]*\\{" + name.replace(/\*/g, "\\*") + "\\}");
      let text = "";
      if (lx) {
        lx.skipBlankRestOfLine();
        const r = lx.readRawUntil(endRe);
        if (!r) { e.diag.error("E006", `\\begin{${name}} not closed`, t); text = lx.readRawUntil(/$(?![\s\S])/)?.text ?? ""; }
        else text = r.text;
      } else {
        // Inside a macro argument (LaTeX itself would fail here): rebuild from tokens.
        text = tokensToString(d.readEnvBody(name, t));
        d.warnOnce("verb-in-arg:" + name, "W014", `${name} inside an argument: whitespace may differ`, t);
      }
      d.closeSelf(t);
      if (opts.skip) return;
      const language = opts.language?.(args, d);
      const code = text.replace(/\n[ \t]*$/, "\n");
      d.addBlock({ kind: "code", language, text: code, lines: highlight(code, language), span: d.span(t) });
      d.noIndentNext = true;
    } });
  };
  rawEnv("verbatim", {});
  rawEnv("verbatim*", {});
  rawEnv("Verbatim", { sig: "o" });
  rawEnv("BVerbatim", { sig: "o" });
  rawEnv("LVerbatim", { sig: "o" });
  rawEnv("alltt", {});
  rawEnv("lstlisting", { sig: "o", language: ([o], d) => o.present ? parseKeyVals(d.argString(o)).get("language")?.toLowerCase() : undefined });
  rawEnv("minted", { sig: "o m", language: ([, lang], d) => d.argString(lang).toLowerCase() });
  rawEnv("comment", { skip: true });
  rawEnv("filecontents", { sig: "o m", skip: true });
  rawEnv("filecontents*", { sig: "o m", skip: true });

  // ---- display math
  installDisplayMath(d);

  // ---- preamble and layout commands that have no Word equivalent (arguments are read and dropped)
  const ignore: [string, string][] = [
    ["hypersetup", "m"], ["graphicspath", "m"],
    ["linespread", "m"], ["onehalfspacing", ""], ["doublespacing", ""], ["singlespacing", ""], ["setstretch", "m"],
    ["selectlanguage", "m"], ["hyphenation", "m"], ["urlstyle", "m"], ["bibliographystyle", "m"],
    ["addcontentsline", "m m m"], ["addtocontents", "m m"], ["markboth", "m m"], ["markright", "m"],
    ["index", "m"], ["glossary", "m"], ["DeclareUnicodeCharacter", "m m"], ["setlist", "o m"], ["theoremstyle", "m"],
    ["captionsetup", "o m"], ["sisetup", "m"], ["tikzset", "m"], ["usetikzlibrary", "m"], ["pgfplotsset", "m"],
    ["lstset", "m"], ["setminted", "o m"], ["usemintedstyle", "o m"], ["restoregeometry", ""], ["allowdisplaybreaks", "o"],
    ["DeclareGraphicsExtensions", "m"], ["newcolumntype", "m o m"], ["ProvidesPackage", "m o"], ["ProvidesClass", "m o"],
    ["ProvidesFile", "m o"], ["NeedsTeXFormat", "m o"], ["ProcessOptions", "s"], ["ExecuteOptions", "m"],
    ["PassOptionsToPackage", "m m"], ["PassOptionsToClass", "m m"], ["AtEndOfClass", "m"], ["AtEndOfPackage", "m"],
    ["AtEndPreamble", "m"], ["titleformat", "s m o m m m o"], ["titlespacing", "s m m m m o"], ["titlelabel", "m"],
    
    ["crefname", "m m m"], ["Crefname", "m m m"],
    ["crefformat", "m m"], ["Crefformat", "m m"], ["listfiles", ""], ["nofiles", ""], 
    ["FloatBarrier", ""], ["balance", ""], ["IEEEoverridecommandlockouts", ""],
    ["makeindex", ""], ["printindex", ""], ["makeglossaries", ""], ["printglossaries", ""], ["loadglsentries", "m"],
    ["newacronym", "o m m m"], ["newglossaryentry", "m m"], ["DeclareCaptionFont", "m m"], ["DeclareCaptionFormat", "m m"],
    ["DeclareCaptionLabelFormat", "m m"], ["setcopyright", "m"], ["copyrightyear", "m"], ["acmYear", "m"],
    ["acmDOI", "m"], ["acmConference", "o m m m"], ["acmBooktitle", "m"], ["acmPrice", "m"], ["acmISBN", "m"],
    ["ccsdesc", "o m"], ["keywords@", "m"], ["received", "m"], ["revised", "m"], ["accepted", "m"],
    ["headrule", ""], ["footrule", ""], ["DeclareMathAlphabet", "m m m m m"], ["SetMathAlphabet", "m m m m m m"],
    ["DeclareSymbolFont", "m m m m m"], ["DeclareMathSymbol", "m m m m"], ["setmainfont", "o m o"],
    ["setsansfont", "o m o"], ["setmonofont", "o m o"], ["setmathfont", "o m o"], ["newfontfamily", "m o m o"],
    ["defaultfontfeatures", "o m"], ["microtypesetup", "m"], ["UseRawInputEncoding", ""], ["tracingall", ""],
    ["listoftodos", "o"], ["missingfigure", "o m"], ["includeonly", "m"], ["excludecomment", "m"], ["includecomment", "m"],
    ["specialcomment", "m m m"], ["newfloat", "m m m o"], ["floatstyle", "m"], ["restylefloat", "s m"], ["floatname", "m m"],
    ["SetKwInOut", "m m"], ["SetAlgoLined", ""], ["DontPrintSemicolon", ""], ["numberwithin@", "m m"],
  ];
  for (const [name, sig] of ignore) if (!d.commands.has(name) && !e.commands.has(name)) d.def(name, { sig, run: () => {} });
  d.def("numberwithin", { sig: "o m m", run: (d, [, a, b], t) => {
    e.pushBack([csTok("counterwithin", t), { kind: "char", ch: "{", cat: Cat.BeginGroup, file: -1, pos: 0 }, ...a.tokens,
      { kind: "char", ch: "}", cat: Cat.EndGroup, file: -1, pos: 0 }, { kind: "char", ch: "{", cat: Cat.BeginGroup, file: -1, pos: 0 },
      ...b.tokens, { kind: "char", ch: "}", cat: Cat.EndGroup, file: -1, pos: 0 }]);
  } });
  d.def("twocolumn", { sig: "o", run: (d, [intro]) => {
    if (intro.present) d.digestTokens(intro.tokens);
    d.doc.page.columns = 2;
  } });
  d.def("foreignlanguage", { sig: "o m m", mode: "inline", run: (d, [, lang, body]) => {
    const l = LANGS[d.argString(lang)];
    d.withMarks(m => (l ? { ...m, lang: l } : m), () => d.digestTokens(body.tokens));
  } });
  d.env("otherlanguage", { sig: "o m", begin: (d, [, lang]) => { const l = LANGS[d.argString(lang)]; if (l) d.setMarks({ ...d.marks, lang: l }); } });
  d.env("otherlanguage*", { sig: "o m", begin: (d, [, lang]) => { const l = LANGS[d.argString(lang)]; if (l) d.setMarks({ ...d.marks, lang: l }); } });
  d.def("lipsum", { sig: "o", run: (d, _a, t) => {
    d.warnOnce("lipsum", "W014", "\\lipsum dummy text is shortened to one paragraph", t);
    d.digestTokens(textTokens("Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Ut purus elit, vestibulum ut, placerat ac, adipiscing vitae, felis. Curabitur dictum gravida mauris."));
    d.par();
  } });
  d.def("IEEEPARstart", { sig: "m m", mode: "inline", run: (d, [a, b]) => { d.digestTokens(a.tokens); d.digestTokens(b.tokens); } });
  d.def("keywords", { sig: "m", mode: "block", run: (d, [a], t) => {
    d.addBlock({ kind: "paragraph", role: "abstract", content: [{ kind: "text", text: "Keywords: ", marks: { bold: true } }, ...d.captureInline(a.tokens)], span: d.span(t) });
  } });
  d.env("keywords", { mode: "block", display: true, begin: d => { d.ensurePara(); d.withMarks(m => ({ ...m, bold: true }), () => d.literal("Keywords: ")); } });
  d.env("IEEEkeywords", { mode: "block", display: true, begin: d => { d.ensurePara(); d.withMarks(m => ({ ...m, bold: true, italic: true }), () => d.literal("Index Terms—")); } });
}

function textTokens(s: string): Token[] {
  return [...s].map(ch => ({ kind: "char", ch, cat: ch === " " ? Cat.Space : /[A-Za-z]/.test(ch) ? Cat.Letter : Cat.Other, file: -1, pos: 0 }));
}

// ------------------------------------------------------------------ display math

const DISPLAY_ENVS = ["equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*",
  "flalign", "flalign*", "alignat", "alignat*", "eqnarray", "eqnarray*", "displaymath", "dmath", "dmath*"];

function installDisplayMath(d: Digester): void {
  const e = d.e;
  d.def("[", { run: (d, _a, t) => {
    d.e.beginGroup("math");
    const p = new MathParser(e, d.mathHooks, true, t);
    const tree = p.parseUntil(u => u.kind === "cs" && !u.active && u.name === "]");
    d.e.endGroup("math", t);
    d.displayMath(tree, t);
  } });
  d.def("]", { run: (_d, _a, t) => e.diag.error("E006", "\\] without matching \\[", t) });
  d.def("(", { mode: "inline", run: (d, _a, t) => d.inlineMath(u => u.kind === "cs" && !u.active && u.name === ")", t) });
  d.def(")", { run: (_d, _a, t) => e.diag.error("E006", "\\) without matching \\(", t) });
  d.env("math", { selfClosing: true, begin: (d, _a, t) => {
    d.envStack.pop();
    d.e.endGroup("env", t);
    d.inlineMath(u => u.kind === "cs" && u.name === "end" && endsEnv(d, "math"), t);
  } });

  for (const name of DISPLAY_ENVS) {
    d.env(name, { sig: name.startsWith("alignat") ? "m" : "", mode: "block", display: true, selfClosing: true, begin: (d, _a, t) => {
      const p = new MathParser(e, d.mathHooks, true, t);
      const single = name.startsWith("equation") || name === "displaymath" || name.startsWith("dmath");
      const rows = p.parseRows(name, !single);
      d.closeSelf(t);
      d.addBlock({ kind: "equation", rows: equationRows(d, name, rows, t), span: d.span(t) });
      d.noIndentNext = true;
    } });
  }
}

/** True when the next tokens are {name} (used to stop inline math at \end{math}). */
function endsEnv(d: Digester, name: string): boolean {
  const arg = d.e.readUndelimited() ?? [];
  if (tokensToString(arg).trim() === name) return true;
  d.e.pushBack([{ kind: "char", ch: "{", cat: Cat.BeginGroup, file: -1, pos: 0 }, ...arg, { kind: "char", ch: "}", cat: Cat.EndGroup, file: -1, pos: 0 }]);
  return false;
}

function equationRows(d: Digester, env: string, rows: MathRow[], t: Loc): EquationRow[] {
  const e = d.e;
  const starred = env.endsWith("*") || env === "displaymath";
  const single = env.startsWith("equation") || env === "displaymath" || env.startsWith("dmath");
  const gatherLike = env.startsWith("gather") || env.startsWith("multline");
  const rowTree = (r: MathRow): MathNode => (gatherLike || single ? join(r.cells) : MathParser.alignRow(r.cells));
  const number = (r: MathRow, out: EquationRow): void => {
    if (r.tag) { out.number = r.tag; return; }
    refStepCounter(e, "equation", t);
    out.number = d.theCounter("equation");
    out.seq = "equation";
  };
  const label = (r: MathRow, out: EquationRow) => {
    if (!r.label) return;
    d.labelTarget = { kind: "number", claim: key => (out.label ??= key) };
    d.setLabel(r.label, t);
    d.labelTarget = null;
  };

  // One number for the whole display: equation, multline, or any starred environment.
  if (single || env.startsWith("multline") || starred) {
    // Alignment points only mean something inside an equation array; a lone row is plain math.
    const tree: MathNode = rows.length === 1 ? join(rows[0].cells)
      : { k: "eqArr", rows: rows.map(rowTree) };
    const out: EquationRow = { tree };
    const tagRow = rows.find(r => r.tag);
    const notag = rows.every(r => r.notag) || (single && rows.some(r => r.notag));
    if (tagRow) out.number = tagRow.tag;
    else if (!starred && !notag) number(rows[0], out);
    const labelled = rows.find(r => r.label);
    if (labelled && out.number) label(labelled, out);
    else if (labelled) d.setLabel(labelled.label!, t);
    return [out];
  }
  // align, gather, flalign, alignat, eqnarray: one number per row.
  return rows.map(r => {
    // Numbered rows are separate paragraphs, so they carry no alignment points.
    const out: EquationRow = { tree: join(r.cells) };
    if (!r.notag) number(r, out);
    label(r, out);
    return out;
  });
}

function join(cells: MathNode[]): MathNode {
  const items = cells.flatMap(c => (c.k === "row" ? c.items : [c]));
  return items.length === 1 ? items[0] : { k: "row", items };
}

export type { Inline };
