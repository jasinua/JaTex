// LaTeX math command → Unicode character and TeX atom class.
// Code points follow the unicode-math package's command table.

export type Cls = "ord" | "op" | "bin" | "rel" | "open" | "close" | "punct";

const S: Record<string, [string, Cls]> = {};
const add = (cls: Cls, entries: Record<string, string>) => { for (const [k, v] of Object.entries(entries)) S[k] = [v, cls]; };

add("ord", {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", varkappa: "ϰ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ",
  omicron: "ο", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ",
  upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", digamma: "ϝ",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ",
  Phi: "Φ", Psi: "Ψ", Omega: "Ω", varGamma: "𝛤", varDelta: "𝛥", varTheta: "𝛩", varLambda: "𝛬",
  varXi: "𝛯", varPi: "𝛱", varSigma: "𝛴", varUpsilon: "𝛶", varPhi: "𝛷", varPsi: "𝛹", varOmega: "𝛺",
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃", nexists: "∄", emptyset: "∅",
  varnothing: "∅", neg: "¬", lnot: "¬", angle: "∠", measuredangle: "∡", sphericalangle: "∢",
  triangle: "△", triangledown: "▽", hbar: "ℏ", hslash: "ℏ", ell: "ℓ", wp: "℘", Re: "ℜ", Im: "ℑ",
  aleph: "ℵ", beth: "ℶ", gimel: "ℷ", daleth: "ℸ", top: "⊤", bot: "⊥", prime: "′", backprime: "‵",
  dagger: "†", ddagger: "‡", surd: "√", Box: "□", square: "□", blacksquare: "■", Diamond: "◇",
  diamondsuit: "♢", heartsuit: "♡", clubsuit: "♣", spadesuit: "♠", flat: "♭", natural: "♮", sharp: "♯",
  ldots: "…", dots: "…", dotsc: "…", dotso: "…", cdots: "⋯", dotsb: "⋯", dotsm: "⋯", dotsi: "⋯",
  vdots: "⋮", ddots: "⋱", iddots: "⋰", checkmark: "✓", circledR: "®", maltese: "✠", complement: "∁",
  imath: "ı", jmath: "ȷ", mho: "℧", eth: "ð", Finv: "Ⅎ", Game: "⅁", Bbbk: "𝕜", degree: "°",
  backslash: "\\", vert: "|", Vert: "‖", "|": "‖", "#": "#", "$": "$", "%": "%", "&": "&", _: "_",
  S: "§", P: "¶", pounds: "£", copyright: "©", textbackslash: "\\", infin: "∞",
  blacktriangle: "▲", blacktriangledown: "▼", lozenge: "◊", blacklozenge: "⧫", bigstar: "★",
  diagup: "╱", diagdown: "╲", varclubsuit: "♧", vardiamondsuit: "♦", varheartsuit: "♥", varspadesuit: "♤",
});

add("bin", {
  pm: "±", mp: "∓", times: "×", div: "÷", cdot: "⋅", ast: "∗", star: "⋆", circ: "∘", bullet: "∙",
  oplus: "⊕", ominus: "⊖", otimes: "⊗", oslash: "⊘", odot: "⊙", cup: "∪", cap: "∩", uplus: "⊎",
  sqcup: "⊔", sqcap: "⊓", vee: "∨", lor: "∨", wedge: "∧", land: "∧", setminus: "∖", smallsetminus: "∖",
  wr: "≀", diamond: "⋄", bigtriangleup: "△", bigtriangledown: "▽", triangleleft: "◁", triangleright: "▷",
  lhd: "⊲", rhd: "⊳", unlhd: "⊴", unrhd: "⊵", amalg: "⨿", dotplus: "∔", ltimes: "⋉", rtimes: "⋊",
  bigcirc: "◯", boxplus: "⊞", boxminus: "⊟", boxtimes: "⊠", boxdot: "⊡", circledast: "⊛",
  circledcirc: "⊚", circleddash: "⊝", centerdot: "⋅", intercal: "⊺", barwedge: "⊼", veebar: "⊻",
  curlywedge: "⋏", curlyvee: "⋎", divideontimes: "⋇", Cap: "⋒", Cup: "⋓", leftthreetimes: "⋋",
  rightthreetimes: "⋌", dagger: "†", ddagger: "‡",
});

add("rel", {
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", equiv: "≡", approx: "≈", approxeq: "≊",
  sim: "∼", simeq: "≃", cong: "≅", propto: "∝", ll: "≪", gg: "≫", lll: "⋘", ggg: "⋙", prec: "≺",
  succ: "≻", preceq: "⪯", succeq: "⪰", precsim: "≾", succsim: "≿", subset: "⊂", supset: "⊃",
  subseteq: "⊆", supseteq: "⊇", subsetneq: "⊊", supsetneq: "⊋", nsubseteq: "⊈", nsupseteq: "⊉",
  sqsubset: "⊏", sqsupset: "⊐", sqsubseteq: "⊑", sqsupseteq: "⊒", in: "∈", notin: "∉", ni: "∋",
  owns: "∋", perp: "⊥", parallel: "∥", nparallel: "∦", mid: "∣", nmid: "∤", vdash: "⊢", dashv: "⊣",
  models: "⊨", vDash: "⊨", Vdash: "⊩", nvdash: "⊬", asymp: "≍", bowtie: "⋈", Join: "⋈", doteq: "≐",
  doteqdot: "≑", triangleq: "≜", coloneqq: "≔", eqqcolon: "≕", coloneq: "≔", lesssim: "≲",
  gtrsim: "≳", lessapprox: "⪅", gtrapprox: "⪆", leqslant: "⩽", geqslant: "⩾", lneq: "⪇", gneq: "⪈",
  lneqq: "≨", gneqq: "≩", nless: "≮", ngtr: "≯", nleq: "≰", ngeq: "≱", nsim: "≁", ncong: "≇",
  leqq: "≦", geqq: "≧", lessgtr: "≶", gtrless: "≷", smile: "⌣", frown: "⌢", between: "≬",
  pitchfork: "⋔", therefore: "∴", because: "∵", sqsubsetneq: "⋤", varpropto: "∝", eqcirc: "≖",
  circeq: "≗", bumpeq: "≏", Bumpeq: "≎", risingdotseq: "≓", fallingdotseq: "≒", backsim: "∽",
  backsimeq: "⋍", thicksim: "∼", thickapprox: "≈", trianglelefteq: "⊴", trianglerighteq: "⊵",
  vartriangleleft: "⊲", vartriangleright: "⊳", ntriangleleft: "⋪", ntriangleright: "⋫",
  to: "→", rightarrow: "→", gets: "←", leftarrow: "←", leftrightarrow: "↔", Rightarrow: "⇒",
  Leftarrow: "⇐", Leftrightarrow: "⇔", longrightarrow: "⟶", longleftarrow: "⟵",
  longleftrightarrow: "⟷", Longrightarrow: "⟹", Longleftarrow: "⟸", Longleftrightarrow: "⟺",
  implies: "⟹", impliedby: "⟸", iff: "⟺", mapsto: "↦", longmapsto: "⟼", hookrightarrow: "↪",
  hookleftarrow: "↩", uparrow: "↑", downarrow: "↓", updownarrow: "↕", Uparrow: "⇑", Downarrow: "⇓",
  Updownarrow: "⇕", nearrow: "↗", searrow: "↘", swarrow: "↙", nwarrow: "↖", leadsto: "⇝",
  rightharpoonup: "⇀", rightharpoondown: "⇁", leftharpoonup: "↼", leftharpoondown: "↽",
  rightleftharpoons: "⇌", leftrightharpoons: "⇋", twoheadrightarrow: "↠", twoheadleftarrow: "↞",
  rightarrowtail: "↣", leftarrowtail: "↢", curvearrowright: "↷", curvearrowleft: "↶",
  circlearrowright: "↻", circlearrowleft: "↺", rightrightarrows: "⇉", leftleftarrows: "⇇",
  rightleftarrows: "⇄", leftrightarrows: "⇆", upuparrows: "⇈", downdownarrows: "⇊", Lsh: "↰", Rsh: "↱",
  nrightarrow: "↛", nleftarrow: "↚", nRightarrow: "⇏", nLeftarrow: "⇍", nleftrightarrow: "↮",
  nLeftrightarrow: "⇎", multimap: "⊸", rightsquigarrow: "⇝", leftrightsquigarrow: "↭",
  dashrightarrow: "⇢", dashleftarrow: "⇠", Rrightarrow: "⇛", Lleftarrow: "⇚",
  colon: ":", vcentcolon: ":", ratio: "∶", Colon: "∷", sqsupsetneq: "⋥", eqsim: "≂",
});

add("open", { langle: "⟨", lbrace: "{", "{": "{", lbrack: "[", lfloor: "⌊", lceil: "⌈", lvert: "|", lVert: "‖",
  ulcorner: "⌜", llcorner: "⌞", lgroup: "⟮", lmoustache: "⎰", llbracket: "⟦" });
add("close", { rangle: "⟩", rbrace: "}", "}": "}", rbrack: "]", rfloor: "⌋", rceil: "⌉", rvert: "|", rVert: "‖",
  urcorner: "⌝", lrcorner: "⌟", rgroup: "⟯", rmoustache: "⎱", rrbracket: "⟧" });
add("punct", { ldotp: ".", cdotp: "·", ";": ";" });

export const SYMBOLS = S;

/** Large operators: character, and whether limits go above/below in display style. */
export const NARY: Record<string, [string, boolean]> = {
  sum: ["∑", true], prod: ["∏", true], coprod: ["∐", true], bigcup: ["⋃", true], bigcap: ["⋂", true],
  bigoplus: ["⨁", true], bigotimes: ["⨂", true], bigodot: ["⨀", true], biguplus: ["⨄", true],
  bigsqcup: ["⨆", true], bigvee: ["⋁", true], bigwedge: ["⋀", true],
  int: ["∫", false], iint: ["∬", false], iiint: ["∭", false], iiiint: ["⨌", false], oint: ["∮", false],
  oiint: ["∯", false], oiiint: ["∰", false], intop: ["∫", false], smallint: ["∫", false],
};

/** Named operators (upright); `true` = takes limits below in display style. */
export const FUNCTIONS: Record<string, boolean> = {
  sin: false, cos: false, tan: false, cot: false, sec: false, csc: false, arcsin: false, arccos: false,
  arctan: false, sinh: false, cosh: false, tanh: false, coth: false, log: false, ln: false, lg: false,
  exp: false, ker: false, dim: false, deg: false, hom: false, arg: false,
  det: true, gcd: true, Pr: true, lim: true, liminf: true, limsup: true, max: true, min: true,
  sup: true, inf: true, injlim: true, projlim: true, argmax: true, argmin: true,
};
export const FUNCTION_TEXT: Record<string, string> = { liminf: "lim inf", limsup: "lim sup", injlim: "inj lim", projlim: "proj lim", argmax: "arg max", argmin: "arg min" };

/** Accents → combining characters as Word's equation editor uses them. */
export const ACCENTS: Record<string, string> = {
  hat: "̂", widehat: "̂", check: "̌", tilde: "̃", widetilde: "̃",
  acute: "́", grave: "̀", dot: "̇", ddot: "̈", dddot: "⃛", ddddot: "⃜",
  breve: "̆", bar: "̅", vec: "⃗", mathring: "̊", overrightarrow: "⃗",
  overleftarrow: "⃖", overleftrightarrow: "⃡",
};

/** Delimiter names usable after \left, \right, \big… */
export const DELIMS: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", "/": "/", "<": "⟨", ">": "⟩", ".": "",
  "{": "{", "}": "}", lbrace: "{", rbrace: "}", langle: "⟨", rangle: "⟩", lvert: "|", rvert: "|",
  vert: "|", lVert: "‖", rVert: "‖", Vert: "‖", "|\u0000": "‖", lfloor: "⌊", rfloor: "⌋", lceil: "⌈",
  rceil: "⌉", lbrack: "[", rbrack: "]", backslash: "\\", uparrow: "↑", downarrow: "↓", updownarrow: "↕",
  Uparrow: "⇑", Downarrow: "⇓", Updownarrow: "⇕", lgroup: "⟮", rgroup: "⟯", llbracket: "⟦", rrbracket: "⟧",
  ulcorner: "⌜", urcorner: "⌝", llcorner: "⌞", lrcorner: "⌟", lmoustache: "⎰", rmoustache: "⎱",
};

/** Negated forms for \not. */
export const NEGATIONS: Record<string, string> = {
  "=": "≠", "<": "≮", ">": "≯", "∈": "∉", "∋": "∌", "⊂": "⊄", "⊃": "⊅", "⊆": "⊈", "⊇": "⊉", "≡": "≢",
  "≤": "≰", "≥": "≱", "∼": "≁", "≈": "≉", "≅": "≇", "≃": "≄", "∃": "∄", "∣": "∤", "∥": "∦", "≺": "⊀",
  "≻": "⊁", "⊢": "⊬", "⊨": "⊭", "→": "↛", "←": "↚", "↔": "↮", "⇒": "⇏", "⇐": "⇍", "⇔": "⇎",
};

const ALPHABETS: Record<string, { upper: number; lower?: number; digit?: number; exceptions: Record<string, string> }> = {
  bb: { upper: 0x1D538, lower: 0x1D552, digit: 0x1D7D8, exceptions: { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" } },
  cal: { upper: 0x1D49C, lower: 0x1D4B6, exceptions: { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ", e: "ℯ", g: "ℊ", o: "ℴ" } },
  frak: { upper: 0x1D504, lower: 0x1D51E, exceptions: { C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ" } },
  sf: { upper: 0x1D5A0, lower: 0x1D5BA, digit: 0x1D7E2, exceptions: {} },
  tt: { upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6, exceptions: {} },
  bfcal: { upper: 0x1D4D0, lower: 0x1D4EA, exceptions: {} },
};
ALPHABETS.scr = ALPHABETS.cal;

/** Maps ASCII letters/digits to a Unicode math alphabet (\mathbb, \mathcal, \mathfrak, \mathsf, \mathtt). */
export function mapAlphabet(text: string, alphabet: string): string {
  const a = ALPHABETS[alphabet];
  if (!a) return text;
  let out = "";
  for (const ch of text) {
    if (a.exceptions[ch]) { out += a.exceptions[ch]; continue; }
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) out += String.fromCodePoint(a.upper + c - 65);
    else if (c >= 97 && c <= 122 && a.lower) out += String.fromCodePoint(a.lower + c - 97);
    else if (c >= 48 && c <= 57 && a.digit) out += String.fromCodePoint(a.digit + c - 48);
    else out += ch;
  }
  return out;
}

/** Class of a single character typed directly in math. */
export function charClass(ch: string): Cls {
  if ("+-*".includes(ch)) return "bin";
  if ("=<>:".includes(ch)) return "rel";
  if ("([".includes(ch)) return "open";
  if (")]".includes(ch)) return "close";
  if (",;".includes(ch)) return "punct";
  return "ord";
}

/** Characters typed in math that TeX's math fonts render differently from their ASCII code. */
export const MATH_CHAR: Record<string, string> = { "-": "−", "*": "∗", "'": "′" };

/** Names whose definitions live in the math package (registered as engine meanings). */
export function mathCommandNames(): string[] {
  return [...Object.keys(S), ...Object.keys(NARY), ...Object.keys(FUNCTIONS), ...Object.keys(ACCENTS)];
}
