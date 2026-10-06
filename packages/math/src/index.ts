import { type Engine } from "@texdocx/core";
import { ACCENTS, FUNCTIONS, NARY, SYMBOLS } from "./symbols.ts";

export { MathParser, type MathHooks, type MathRow } from "./parser.ts";
export { SYMBOLS, NARY, FUNCTIONS, ACCENTS, DELIMS, mapAlphabet } from "./symbols.ts";

/** Gives every math command a meaning, so \let, \ifx and \newcommand aliases resolve to it. */
export function installMath(e: Engine): void {
  const names = new Set([...Object.keys(SYMBOLS), ...Object.keys(NARY), ...Object.keys(FUNCTIONS), ...Object.keys(ACCENTS),
    "frac", "dfrac", "tfrac", "cfrac", "binom", "dbinom", "tbinom", "genfrac", "sqrt", "left", "right", "middle",
    "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr", "bigm", "Bigm",
    "operatorname", "mathop", "limits", "nolimits", "overline", "underline", "overbrace", "underbrace", "overset",
    "underset", "stackrel", "xrightarrow", "xleftarrow", "boxed", "phantom", "hphantom", "vphantom", "smash",
    "mathrm", "mathit", "mathbf", "boldsymbol", "bm", "mathsf", "mathtt", "mathbb", "mathcal", "mathscr", "mathfrak",
    "mathnormal", "displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle", "not", "tag", "notag", "nonumber",
    "pmod", "bmod", "pod", "mathbin", "mathrel", "mathord", "mathpunct", "mathopen", "mathclose", "substack",
    "intertext", "shortintertext", "quad", "qquad", "mathstrut", "boldmath", "mathchoice", "Bbb"]);
  for (const n of names) if (!e.isDefined(n)) e.define(n, { type: "command", name: n }, true);
}
