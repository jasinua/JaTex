// Text-level handlers: fonts, sizes, symbols, accents, spacing, breaks, colours, links, inline code.

import { Cat, type Token } from "@texdocx/core";
import { halfPoints, SIZE_NAMES, sizePt, type Marks } from "@texdocx/model";
import type { Digester } from "../digester.ts";

/** Text symbols: command → Unicode. */
export const TEXT_SYMBOLS: Record<string, string> = {
  "%": "%", "&": "&", "$": "$", "#": "#", "_": "_", "{": "{", "}": "}", " ": " ",
  textbackslash: "\\", textasciitilde: "~", textasciicircum: "^", textbar: "|", textless: "<", textgreater: ">",
  textunderscore: "_", textbraceleft: "{", textbraceright: "}", textdollar: "$", textquotedbl: "\"",
  textquotesingle: "'", textquoteleft: "‘", textquoteright: "’", textquotedblleft: "“", textquotedblright: "”",
  lq: "‘", rq: "’", guillemotleft: "«", guillemotright: "»", guillemetleft: "«", guillemetright: "»",
  guilsinglleft: "‹", guilsinglright: "›", quotedblbase: "„", quotesinglbase: "‚",
  textendash: "–", textemdash: "—", textbullet: "•", textperiodcentered: "·", textellipsis: "…",
  ldots: "…", dots: "…", textdagger: "†", dag: "†", textdaggerdbl: "‡", ddag: "‡", S: "§", P: "¶",
  textsection: "§", textparagraph: "¶", copyright: "©", textcopyright: "©", textregistered: "®",
  texttrademark: "™", pounds: "£", textsterling: "£", euro: "€", texteuro: "€", EUR: "€", textyen: "¥",
  textcent: "¢", textdegree: "°", degree: "°", textmu: "µ", textonehalf: "½", textonequarter: "¼",
  textthreequarters: "¾", texttimes: "×", textdiv: "÷", textpm: "±", textminus: "−", textexclamdown: "¡",
  textquestiondown: "¿", i: "ı", j: "ȷ", ss: "ß", SS: "SS", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ",
  o: "ø", O: "Ø", l: "ł", L: "Ł", aa: "å", AA: "Å", dh: "ð", DH: "Ð", th: "þ", TH: "Þ", ng: "ŋ", NG: "Ŋ",
  dj: "đ", DJ: "Đ", textordfeminine: "ª", textordmasculine: "º", textlangle: "⟨", textrangle: "⟩",
  textnumero: "№", textcelsius: "℃", textohm: "Ω", textlnot: "¬", textbrokenbar: "¦",
  textasteriskcentered: "∗", textreferencemark: "※", textinterrobang: "‽", textvisiblespace: "␣",
  checkmark: "✓", textbigcircle: "◯", textcircledP: "℗", textservicemark: "℠", textperthousand: "‰",
  textpertenthousand: "‱", textleaf: "🍃", textmusicalnote: "♪", textrecipe: "℞", textestimated: "℮",
  textopenbullet: "◦", textdblhyphen: "⹀", texttildelow: "˷", textasciiacute: "´", textasciigrave: "`",
  textasciidieresis: "¨", textasciimacron: "¯", textasciibreve: "˘", textasciicaron: "ˇ", textacutedbl: "˝",
  textdollaroldstyle: "$", textcurrency: "¤", textflorin: "ƒ", textwon: "₩", textnaira: "₦", textpeso: "₱",
  textlira: "₤", textbaht: "฿", textcolonmonetary: "₡", textdong: "₫", textguarani: "₲",
  slash: "/", textslash: "/", textfractionsolidus: "⁄", nobreakspace: " ", nobreakdash: "‑",
  textcompwordmark: "‌", textzwj: "‍", "-": "­", "/": "", "@": "", textnospace: "",
  TeX: "TeX", LaTeX: "LaTeX", LaTeXe: "LaTeX2ε", XeTeX: "XeTeX", XeLaTeX: "XeLaTeX", LuaTeX: "LuaTeX",
  LuaLaTeX: "LuaLaTeX", pdfTeX: "pdfTeX", pdfLaTeX: "pdfLaTeX", BibTeX: "BibTeX", eTeX: "ε-TeX",
  AmS: "AMS", AmSTeX: "AMS-TeX", AmSLaTeX: "AMS-LaTeX", MF: "Metafont", MP: "MetaPost", ConTeXt: "ConTeXt",
  thinspace: " ", ",": " ", ":": " ", ">": " ", ";": " ", "!": "",
  negthinspace: "", enspace: " ", enskip: " ", quad: " ", qquad: "  ",
  allowbreak: "​", textdiscount: "⁒", textblank: "␢",
};

/** Accent commands → combining character. */
const ACCENTS: Record<string, string> = {
  "'": "́", "`": "̀", "^": "̂", "\"": "̈", "~": "̃", "=": "̄", ".": "̇",
  u: "̆", v: "̌", H: "̋", c: "̧", k: "̨", d: "̣", b: "̱", r: "̊",
  t: "͡", textcommabelow: "̦", textogonekcentered: "̨", G: "̏", U: "̎",
  textacute: "́", textgrave: "̀", textcircumflex: "̂", textdieresis: "̈",
  texttilde: "̃", textmacron: "̄", textbreve: "̆", textcaron: "̌", textring: "̊",
};

/** Applies a combining accent to the first character; dotless i/j regain their dot under accents above. */
export function accent(text: string, mark: string): string {
  const chars = [...text];
  if (!chars.length) return mark === "́" ? "´" : mark === "̈" ? "¨" : mark === "̃" ? "~" : mark === "̂" ? "^" : mark;
  let base = chars[0];
  const below = ["̧", "̨", "̣", "̱", "̦"].includes(mark);
  if (!below && base === "ı") base = "i";
  if (!below && base === "ȷ") base = "j";
  return (base + mark + chars.slice(1).join("")).normalize("NFC");
}

const NAMED_COLORS: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "00FF00", blue: "0000FF", cyan: "00FFFF",
  magenta: "FF00FF", yellow: "FFFF00", gray: "808080", grey: "808080", darkgray: "404040", lightgray: "BFBFBF",
  brown: "BF8040", lime: "BFFF00", olive: "808000", orange: "FF8000", pink: "FFBFBF", purple: "BF0040",
  teal: "008080", violet: "800080",
};

const hex2 = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0").toUpperCase();
const rgbOf = (hex: string): number[] => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));

/** Resolves an xcolor expression such as `red`, `blue!30`, `red!50!black`, `[HTML]{FF8800}`. */
export function resolveColor(d: Digester, expr: string, model?: string): string | undefined {
  if (model) return colorFromModel(model, expr);
  const parts = expr.split("!").map(s => s.trim());
  const named = (n: string): string | undefined => d.e.state.get<string>("color:" + n) ?? NAMED_COLORS[n];
  let cur = named(parts[0]);
  if (!cur) return undefined;
  for (let i = 1; i < parts.length; i += 2) {
    const pct = Math.max(0, Math.min(100, parseFloat(parts[i]) || 0)) / 100;
    const other = parts[i + 1] ? named(parts[i + 1]) ?? "FFFFFF" : "FFFFFF";
    const a = rgbOf(cur), b = rgbOf(other);
    cur = a.map((v, k) => hex2(v * pct + b[k] * (1 - pct))).join("");
  }
  return cur;
}

function colorFromModel(model: string, spec: string): string | undefined {
  const nums = spec.split(/[ ,]+/).filter(Boolean).map(Number);
  switch (model.toLowerCase()) {
    case "html": return spec.replace(/^#/, "").toUpperCase().padStart(6, "0");
    case "rgb": return nums.length === 3 ? nums.map(v => hex2(v * 255)).join("") : undefined;
    case "gray": return nums.length === 1 ? hex2(nums[0] * 255).repeat(3) : undefined;
    case "cmyk": {
      if (nums.length !== 4) return undefined;
      const [c, m, y, k] = nums;
      return [c, m, y].map(v => hex2(255 * (1 - v) * (1 - k))).join("");
    }
    default: {
      if (model === "RGB" && nums.length === 3) return nums.map(hex2).join("");
      return undefined;
    }
  }
}

export function installText(d: Digester): void {
  // ---- font commands with an argument, and the matching declarations
  const fontCmd = (name: string, f: (m: Marks) => Marks) => {
    d.def(name, { sig: "m", mode: "inline", run: (d, [a]) => d.withMarks(f, () => d.digestTokens(a.tokens)) });
  };
  const fontDecl = (name: string, f: (m: Marks) => Marks) => {
    d.def(name, { run: d => d.setMarks(f(d.marks)) });
  };
  const bold = (m: Marks): Marks => ({ ...m, bold: true });
  const medium = (m: Marks): Marks => ({ ...m, bold: false });
  // Since LaTeX 2020 shapes combine: \textit{\textsc{x}} is italic small caps; \upshape resets both.
  const italic = (m: Marks): Marks => ({ ...m, italic: true });
  const upright = (m: Marks): Marks => ({ ...m, italic: m.italic ? false : undefined, smallCaps: m.smallCaps ? false : undefined });
  const smallCaps = (m: Marks): Marks => ({ ...m, smallCaps: true });
  const family = (f: Marks["family"]) => (m: Marks): Marks => ({ ...m, family: f });
  const off = (v: boolean | undefined) => (v ? false : undefined);
  const normal = (m: Marks): Marks => ({ ...m, bold: off(m.bold), italic: off(m.italic), smallCaps: off(m.smallCaps), family: undefined });
  const emph = (m: Marks): Marks => ({ ...m, italic: !m.italic });

  for (const [cmd, decl, f] of [
    ["textbf", "bfseries", bold], ["textmd", "mdseries", medium], ["textit", "itshape", italic],
    ["textsl", "slshape", italic], ["textup", "upshape", upright], ["textsc", "scshape", smallCaps],
    ["textrm", "rmfamily", family("roman")], ["textsf", "sffamily", family("sans")], ["texttt", "ttfamily", family("mono")],
    ["textnormal", "normalfont", normal], ["emph", "em", emph],
  ] as const) {
    fontCmd(cmd, f);
    fontDecl(decl, f);
  }
  fontCmd("textsw", italic);
  fontDecl("upshape", upright);
  // Old-style declarations reset the other axes.
  fontDecl("bf", m => bold(normal(m)));
  fontDecl("it", m => italic(normal(m)));
  fontDecl("sl", m => italic(normal(m)));
  fontDecl("sc", m => smallCaps(normal(m)));
  fontDecl("tt", m => family("mono")(normal(m)));
  fontDecl("sf", m => family("sans")(normal(m)));
  fontDecl("rm", m => normal(m));
  fontCmd("underline", m => ({ ...m, underline: true }));
  fontCmd("uline", m => ({ ...m, underline: true }));
  fontCmd("ul", m => ({ ...m, underline: true }));
  fontCmd("sout", m => ({ ...m, strike: true }));
  fontCmd("st", m => ({ ...m, strike: true }));
  fontCmd("xout", m => ({ ...m, strike: true }));
  fontCmd("textsuperscript", m => ({ ...m, vertAlign: "superscript" }));
  fontCmd("textsubscript", m => ({ ...m, vertAlign: "subscript" }));
  fontCmd("mbox", m => m);
  fontCmd("hbox", m => m);
  fontCmd("text", m => m);
  fontCmd("textup", upright);
  fontCmd("enquote", m => m);
  d.def("enquote", { sig: "s m", mode: "inline", run: (d, [star, a]) => {
    d.literal(star.present ? "‘" : "“");
    d.e.beginGroup("internal");
    d.digestTokens(a.tokens);
    d.e.endGroup("internal");
    d.literal(star.present ? "’" : "”");
  } });
  for (const name of ["makebox", "framebox"]) {
    d.def(name, { sig: "o o m", mode: "inline", run: (d, [, , a]) => d.withMarks(m => m, () => d.digestTokens(a.tokens)) });
  }
  d.def("fbox", { sig: "m", mode: "inline", run: (d, [a]) => d.withMarks(m => m, () => d.digestTokens(a.tokens)) });
  d.def("raisebox", { sig: "m o o m", mode: "inline", run: (d, [, , , a]) => d.withMarks(m => m, () => d.digestTokens(a.tokens)) });
  d.def("parbox", { sig: "o o o m m", mode: "inline", run: (d, [, , , , a], t) => {
    d.warnOnce("parbox", "W014", "\\parbox content is flattened into the text", t);
    d.withMarks(m => m, () => d.digestTokens(a.tokens));
  } });

  // ---- sizes
  for (const size of SIZE_NAMES) {
    d.def(size, { run: d => d.setMarks({ ...d.marks, size: size === "normalsize" ? undefined : halfPoints(sizePt(d.doc.docClass.baseSize, size)) }) });
  }

  // ---- symbols and special characters
  for (const [name, s] of Object.entries(TEXT_SYMBOLS)) {
    if (s === "­" || name === "/" || name === "@") { d.def(name, { run: d => { if (s) d.literal(s); } }); continue; }
    d.def(name, { mode: "inline", run: d => d.literal(s) });
  }
  d.def("textellipsis", { mode: "inline", run: d => d.literal("…") });
  const nbsp = { mode: "inline" as const, run: (d: Digester) => d.literal(" ") };
  d.def("nobreakspace", nbsp);
  d.e.define({ kind: "cs", name: "~", active: true, file: -1, pos: 0 }, { type: "command", name: "nobreakspace" }, true);
  d.def(" ", { run: d => { d.ensurePara(); d.space(); } });
  d.def("today", { mode: "inline", run: d => d.literal(formatDate(d.opts.today ?? new Date())) });
  d.def("char", { mode: "inline", run: (d, _a, t) => d.literal(codePoint(d.e.readNumber(t))) });
  d.def("symbol", { sig: "m", mode: "inline", run: (d, [a], t) => {
    d.e.pushBack(a.tokens);
    d.literal(codePoint(d.e.readNumber(t)));
  } });

  // ---- accents
  for (const [name, mark] of Object.entries(ACCENTS)) {
    d.def(name, { sig: "m", mode: "inline", run: (d, [a]) => d.literal(accent(d.captureText(a.tokens), mark)) });
  }

  // ---- breaks and spacing
  d.def("\\", { sig: "s o", run: (d, _a, t) => {
    if (d.onRowEnd?.(t)) return;
    if (d.top.para) d.inline({ kind: "lineBreak" });
  } });
  d.def("newline", { run: d => { if (d.top.para) d.inline({ kind: "lineBreak" }); } });
  d.def("linebreak", { sig: "o", run: d => { if (d.top.para) d.inline({ kind: "lineBreak" }); } });
  d.def("par", { run: d => d.par() });
  d.def("endgraf", { run: d => d.par() });
  d.def("noindent", { run: d => { if (!d.top.para && d.inDocument) d.startParagraph(false); } });
  d.def("indent", { run: d => { if (!d.top.para && d.inDocument) d.startParagraph(true); } });
  for (const name of ["newpage", "clearpage", "cleardoublepage", "pagebreak", "eject"]) {
    d.def(name, { sig: name === "pagebreak" ? "o" : "", run: d => { if (d.inDocument) d.addBlock({ kind: "pageBreak" }); } });
  }
  const vskip = (pt: number) => (d: Digester) => { d.closeParagraph(); d.pendingSpaceBefore += pt; };
  d.def("smallskip", { run: vskip(3) });
  d.def("medskip", { run: vskip(6) });
  d.def("bigskip", { run: vskip(12) });
  d.def("vspace", { sig: "s m", run: (d, [, a], t) => {
    const pt = lengthPt(d, a.tokens, t);
    if (pt > 0 && !d.top.para) d.pendingSpaceBefore += pt;
  } });
  d.def("vskip", { run: (d, _a, t) => { const pt = d.e.readGlue(t) / 65536; if (pt > 0) vskip(pt)(d); } });
  d.def("addvspace", { sig: "m", run: (d, [a], t) => { const pt = lengthPt(d, a.tokens, t); if (pt > 0) vskip(pt)(d); } });
  d.def("hspace", { sig: "s m", mode: "inline", run: (d, [, a], t) => d.literal(horizontalSpace(lengthPt(d, a.tokens, t), d.doc.docClass.baseSize)) });
  d.def("hskip", { mode: "inline", run: (d, _a, t) => d.literal(horizontalSpace(d.e.readGlue(t) / 65536, d.doc.docClass.baseSize)) });
  d.def("kern", { run: (d, _a, t) => { d.e.readDimen(t); } });
  for (const name of ["hfill", "hfil", "hss", "dotfill", "hrulefill", "null", "strut", "leavevmode", "nopagebreak",
    "samepage", "nolinebreak", "break", "sloppy", "fussy", "frenchspacing", "nonfrenchspacing", "raggedbottom",
    "flushbottom", "vfill", "vfil", "unskip", "nobreak", "xspace", "onecolumn", "selectfont", "normalcolor"]) {
    if (d.commands.has(name)) continue;
    d.def(name, { sig: name === "nopagebreak" || name === "nolinebreak" ? "o" : "", run: (d, _a, t) => {
      if (name === "hfill" || name === "hfil" || name === "dotfill" || name === "hrulefill") {
        if (d.top.para) d.inline({ kind: "tab" });
        d.warnOnce("hfill", "W014", "\\hfill is approximated by a tab", t);
      }
      if (name === "leavevmode") d.ensurePara();
    } });
  }
  d.def("rule", { sig: "o m m", run: (d, _a, t) => d.warnOnce("rule", "W014", "\\rule is not drawn", t) });
  d.def("phantom", { sig: "m", mode: "inline", run: () => {} });
  d.def("hphantom", { sig: "m", mode: "inline", run: () => {} });
  d.def("vphantom", { sig: "m", run: () => {} });

  // ---- alignment declarations
  d.def("centering", { run: d => d.e.state.set("par:align", "center") });
  d.def("raggedright", { run: d => d.e.state.set("par:align", "left") });
  d.def("raggedleft", { run: d => d.e.state.set("par:align", "right") });
  d.def("RaggedRight", { run: d => d.e.state.set("par:align", "left") });
  d.def("justifying", { run: d => d.e.state.set("par:align", "justify") });

  // ---- colours (xcolor)
  d.def("definecolor", { sig: "o m m m", run: (d, [, name, model, spec]) => {
    const hex = colorFromModel(d.argString(model), d.argString(spec));
    if (hex) d.e.state.set("color:" + d.argString(name), hex, true);
  } });
  d.def("colorlet", { sig: "m m", run: (d, [name, expr]) => {
    const hex = resolveColor(d, d.argString(expr));
    if (hex) d.e.state.set("color:" + d.argString(name), hex, true);
  } });
  const colorArg = (d: Digester, model: { present: boolean; tokens: Token[] }, spec: { tokens: Token[] }, t: { file: number; pos: number }) => {
    const hex = resolveColor(d, d.argString(spec.tokens), model.present ? d.argString(model.tokens) : undefined);
    if (!hex) d.warnOnce("color:" + d.argString(spec.tokens), "W014", `unknown colour '${d.argString(spec.tokens)}'`, t);
    return hex;
  };
  d.def("color", { sig: "o m", run: (d, [model, spec], t) => {
    const hex = colorArg(d, model, spec, t);
    if (hex) d.setMarks({ ...d.marks, color: hex });
  } });
  d.def("textcolor", { sig: "o m m", mode: "inline", run: (d, [model, spec, body], t) => {
    const hex = colorArg(d, model, spec, t);
    d.withMarks(m => (hex ? { ...m, color: hex } : m), () => d.digestTokens(body.tokens));
  } });
  for (const name of ["colorbox", "fcolorbox", "hl", "highlight"]) {
    const sig = name === "fcolorbox" ? "o m m m" : name === "colorbox" ? "o m m" : "m";
    d.def(name, { sig, mode: "inline", run: (d, args) => d.withMarks(m => m, () => d.digestTokens(args[args.length - 1].tokens)) });
  }

  // ---- links
  d.def("url", { mode: "inline", run: (d, _a, t) => {
    const url = d.e.readVerbatimArg(t).trim();
    d.inline({ kind: "link", href: url, content: [{ kind: "text", text: url, marks: { ...d.marks, family: "mono" } }] });
  } });
  d.def("nolinkurl", { mode: "inline", run: (d, _a, t) => {
    const url = d.e.readVerbatimArg(t).trim();
    d.literal("");
    d.withMarks(m => ({ ...m, family: "mono" }), () => d.literal(url));
  } });
  d.def("path", { mode: "inline", run: (d, _a, t) => {
    const p = d.e.readVerbatimArg(t);
    d.withMarks(m => ({ ...m, family: "mono" }), () => d.literal(p));
  } });
  d.def("href", { mode: "inline", run: (d, _a, t) => {
    const url = d.e.readVerbatimArg(t).trim().replace(/\\([#%&_~])/g, "$1");
    const text = d.e.readUndelimited(t) ?? [];
    const content = d.captureInline(text);
    d.inline({ kind: "link", href: url, content });
  } });
  d.def("hyperref", { sig: "o m", mode: "inline", run: (d, [label, text], t) => {
    if (!label.present) { d.digestTokens(text.tokens); void t; return; }
    d.inline({ kind: "link", href: "#" + d.argString(label), content: d.captureInline(text.tokens) });
  } });
  d.def("hyperlink", { sig: "m m", mode: "inline", run: (d, [target, text]) => {
    d.inline({ kind: "link", href: "#" + d.argString(target), content: d.captureInline(text.tokens) });
  } });
  d.def("hypertarget", { sig: "m m", mode: "inline", run: (d, [target, text]) => {
    d.inline({ kind: "anchor", label: d.argString(target) });
    d.digestTokens(text.tokens);
  } });
  d.def("email", { sig: "m", mode: "inline", run: (d, [a]) => {
    const addr = d.argString(a);
    d.inline({ kind: "link", href: "mailto:" + addr, content: [{ kind: "text", text: addr, marks: d.marks }] });
  } });

  // ---- inline verbatim
  d.def("verb", { mode: "inline", run: (d, _a, t) => {
    const lx = d.e.currentLexer();
    let star = false;
    let text: string;
    if (lx) {
      if (lx.peekRawChar() === "*") { lx.readRawChar(); star = true; }
      const delim = lx.readRawChar();
      if (delim === undefined) return;
      const end = lx.readRawUntil(new RegExp(escapeRe(delim) + "|\\n"));
      text = end ? end.text : "";
    } else {
      // Inside an argument the text was already tokenized: rebuild it up to the delimiter.
      const first = d.e.nextRaw();
      star = !!first && first.kind === "char" && first.ch === "*";
      const delimTok = star ? d.e.nextRaw() : first;
      const delim = delimTok && delimTok.kind === "char" ? delimTok.ch : "";
      text = "";
      for (;;) {
        const u = d.e.nextRaw();
        if (!u || (u.kind === "char" && u.ch === delim)) break;
        text += u.kind === "char" ? u.ch : u.kind === "cs" ? (u.active ? u.name : "\\" + u.name + (/^[A-Za-z]+$/.test(u.name) ? " " : "")) : "";
      }
      d.warnOnce("verb-arg", "W014", "\\verb inside an argument: spacing may differ from LaTeX", t);
    }
    // \verbatim@font is \normalfont\ttfamily: upright, medium, typewriter whatever surrounds it.
    d.withMarks(m => ({ ...m, family: "mono", bold: m.bold ? false : undefined, italic: m.italic ? false : undefined, smallCaps: m.smallCaps ? false : undefined }),
      () => d.literal(star ? text.replace(/ /g, "␣") : text));
  } });
  for (const name of ["lstinline", "mintinline", "Verb", "texttt@verb"]) {
    d.def(name, { mode: "inline", run: (d, _a, t) => {
      d.e.readOptional();
      if (name === "mintinline") d.e.readUndelimited(t);
      const code = d.e.readVerbatimArg(t);
      d.withMarks(m => ({ ...m, family: "mono" }), () => d.literal(code));
    } });
  }
}

/** \char⟨n⟩ as text; control characters and invalid code points produce nothing. */
function codePoint(n: number): string {
  if (!Number.isInteger(n) || n < 32 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF) || n === 127) return "";
  return String.fromCodePoint(n);
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Evaluates a length argument (e.g. "1.5em", "\baselineskip") to points. */
export function lengthPt(d: Digester, toks: Token[], t: { file: number; pos: number }): number {
  d.e.pushBack([...toks, { kind: "cs", name: "relax", file: -1, pos: 0 }]);
  const sp = d.e.readGlue(t);
  const r = d.e.next();
  if (r && !(r.kind === "cs" && r.name === "relax")) {
    // Drop anything left over (e.g. "plus 1fill" remains are consumed by readGlue already).
    for (let u: Token | null = r; u && !(u.kind === "cs" && u.name === "relax"); u = d.e.next()) { /* skip */ }
  }
  return sp / 65536;
}

/** Approximates horizontal space with Unicode spaces. */
export function horizontalSpace(pt: number, em: number): string {
  if (pt <= 0) return "";
  if (pt < 0.3 * em) return " ";
  if (pt < 0.75 * em) return " ";
  return " ".repeat(Math.min(10, Math.round(pt / em)));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function formatDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export { Cat };
