// Expandable primitives: conditionals, \expandafter, \csname, \string, \the, \number, …

import { Cat, charTok, csTok, isChar, isCs, isSpace, stringToTokens, tokensToString, type CsToken, type Token } from "./tokens.ts";
import type { Engine, Meaning } from "./engine.ts";

type IfTest = (e: Engine, t: CsToken) => boolean;

const IF_TESTS = new Map<string, IfTest>();

export function toRoman(n: number): string {
  if (n <= 0) return "";
  const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let s = "";
  for (const [v, r] of table) while (n >= v) { s += r; n -= v; }
  return s;
}
export const toAlph = (n: number): string => (n >= 1 && n <= 26 ? String.fromCharCode(96 + n) : "");
export function toFnSymbol(n: number): string {
  const syms = ["*", "†", "‡", "§", "¶", "‖", "**", "††", "‡‡"];
  return n >= 1 && n <= syms.length ? syms[n - 1] : "";
}

/** Reads a control sequence name up to \endcsname, expanding as it goes. */
export function readCsName(e: Engine, from: CsToken): string {
  let name = "";
  for (;;) {
    const t = e.next();
    if (!t) { e.diag.error("E002", "missing \\endcsname", from); return name; }
    if (t.kind === "char") { name += t.ch; continue; }
    if (t.kind === "cs" && isEndCsname(e, t)) return name;
    e.diag.error("E007", `\\${t.kind === "cs" ? t.name : "#"} is not allowed inside \\csname`, t.kind === "cs" ? t : from);
  }
}
const isEndCsname = (e: Engine, t: CsToken): boolean => {
  const m = e.meaning(t);
  return !!m && m.type === "command" && m.name === "endcsname";
};

function meaningIs(m: Meaning | undefined, name: string): boolean {
  return !!m && m.type === "expandable" && m.name === name;
}

/** Skips a conditional branch; returns which delimiter ended it. */
function skipBranch(e: Engine, from: CsToken): "else" | "or" | "fi" | "eof" {
  let depth = 0;
  for (;;) {
    const t = e.nextRaw();
    if (!t) { e.diag.error("E006", `incomplete \\${from.name}; all text was ignored after it`, from); return "eof"; }
    if (t.kind !== "cs") continue;
    const m = e.meaning(t);
    if (!m || m.type !== "expandable") continue;
    if (m.isIf) depth++;
    else if (m.name === "fi") { if (depth === 0) return "fi"; depth--; }
    else if (depth === 0 && m.name === "else") return "else";
    else if (depth === 0 && m.name === "or") return "or";
  }
}

function conditional(e: Engine, b: boolean, t: CsToken): void {
  if (b) { e.condStack.push("if"); return; }
  const end = skipBranch(e, t);
  if (end === "else") e.condStack.push("if");
  else if (end === "or") { e.diag.error("E006", "extra \\or", t); e.condStack.push("if"); }
}

/** Two tokens for \if / \ifcat: (code, catcode), with unexpandable control sequences as (256, 16). */
function charPair(e: Engine, t: Token | null): [string, number] {
  if (!t) return ["", -1];
  if (t.kind === "char") return [t.ch, t.cat];
  if (t.kind === "cs") {
    const m = t.noexpand ? undefined : e.meaning(t);
    if (m && m.type === "char") return [m.ch, m.cat];
    if (t.active && !m) return [t.name, Cat.Active];
  }
  return ["Ā", 16];
}

function nextForIf(e: Engine): Token | null {
  const t = e.next();
  return t;
}

export function sameMeaning(a: Meaning | undefined, b: Meaning | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "char": { const bb = b as typeof a; return a.ch === bb.ch && a.cat === bb.cat; }
    case "expandable": case "command": return a.name === (b as typeof a).name;
    case "register": { const bb = b as typeof a; return a.reg === bb.reg && a.key === bb.key; }
    case "chardef": return a.value === (b as typeof a).value;
    case "macro": {
      const bb = b as typeof a;
      return !!a.protected === !!bb.protected && a.braceDelim === bb.braceDelim && tokensEqual(a.prefix, bb.prefix)
        && a.params.length === bb.params.length && a.params.every((p, i) => tokensEqual(p, bb.params[i])) && tokensEqual(a.body, bb.body);
    }
    case "latex": {
      const bb = b as typeof a;
      return JSON.stringify(a.spec) === JSON.stringify(bb.spec) && tokensEqual(a.body, bb.body);
    }
  }
}

function tokensEqual(a: Token[], b: Token[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.kind !== y.kind) return false;
    if (x.kind === "char" && y.kind === "char" && (x.ch !== y.ch || x.cat !== y.cat)) return false;
    if (x.kind === "cs" && y.kind === "cs" && (x.name !== y.name || !!x.active !== !!y.active)) return false;
    if (x.kind === "param" && y.kind === "param" && x.n !== y.n) return false;
  }
  return true;
}

function readRelation(e: Engine, from: CsToken): string {
  e.skipSpacesExpanded();
  const t = e.next();
  if (t && t.kind === "char" && t.cat === Cat.Other && "<=>".includes(t.ch)) return t.ch;
  e.diag.error("E009", "missing = inserted for comparison", from);
  if (t) e.pushBackOne(t);
  return "=";
}
const compare = (a: number, rel: string, b: number): boolean => (rel === "<" ? a < b : rel === ">" ? a > b : a === b);

export function installPrimitives(e: Engine): void {
  const ifp = (name: string, test: IfTest) => {
    IF_TESTS.set(name, test);
    e.primitive(name, (e, t) => conditional(e, test(e, t), t), true);
  };

  ifp("iftrue", () => true);
  ifp("iffalse", () => false);
  ifp("if", e => { const a = charPair(e, nextForIf(e)), b = charPair(e, nextForIf(e)); return a[0] === b[0]; });
  ifp("ifcat", e => { const a = charPair(e, nextForIf(e)), b = charPair(e, nextForIf(e)); return a[1] === b[1]; });
  ifp("ifx", e => {
    const a = e.nextRaw(), b = e.nextRaw();
    if (!a || !b) return false;
    const ma = a.kind === "cs" && a.noexpand ? { type: "command", name: "relax" } as Meaning : e.meaning(a);
    const mb = b.kind === "cs" && b.noexpand ? { type: "command", name: "relax" } as Meaning : e.meaning(b);
    return sameMeaning(ma, mb);
  });
  ifp("ifnum", (e, t) => { const a = e.readNumber(t); const r = readRelation(e, t); return compare(a, r, e.readNumber(t)); });
  ifp("ifdim", (e, t) => { const a = e.readDimen(t); const r = readRelation(e, t); return compare(a, r, e.readDimen(t)); });
  ifp("ifodd", (e, t) => Math.abs(e.readNumber(t)) % 2 === 1);
  ifp("ifdefined", e => { const t = e.nextRaw(); return !!t && (t.kind !== "cs" || e.meaning(t) !== undefined); });
  ifp("ifcsname", (e, t) => e.isDefined(readCsName(e, t)));
  ifp("ifvmode", e => e.modeQuery() === "vertical");
  ifp("ifhmode", e => e.modeQuery() === "horizontal");
  ifp("ifmmode", e => e.modeQuery() === "math");
  ifp("ifinner", () => false);
  ifp("ifeof", e => { e.readNumber(); return true; });
  ifp("ifvoid", e => { e.readNumber(); return true; });
  ifp("ifhbox", e => { e.readNumber(); return false; });
  ifp("ifvbox", e => { e.readNumber(); return false; });

  e.primitive("unless", (e, t) => {
    const u = e.nextRaw();
    const m = u && u.kind === "cs" ? e.meaning(u) : undefined;
    const test = m && m.type === "expandable" && m.isIf ? IF_TESTS.get(m.name) : undefined;
    if (!u || !test) { e.diag.error("E009", "\\unless must be followed by a conditional other than \\ifcase", t); if (u) e.pushBackOne(u); return; }
    conditional(e, !test(e, u as CsToken), u as CsToken);
  });

  e.primitive("ifcase", (e, t) => {
    let n = e.readNumber(t);
    while (n > 0) {
      const end = skipBranch(e, t);
      if (end === "or") { n--; continue; }
      if (end === "else") e.condStack.push("if");
      return;
    }
    if (n < 0) {
      // Negative cases select \else.
      for (;;) {
        const end = skipBranch(e, t);
        if (end === "or") continue;
        if (end === "else") e.condStack.push("if");
        return;
      }
    }
    e.condStack.push("case");
  }, true);

  e.primitive("else", (e, t) => {
    if (!e.condStack.length) { e.diag.error("E006", "extra \\else", t); return; }
    for (;;) {
      const end = skipBranch(e, t);
      if (end === "fi" || end === "eof") break;
    }
    e.condStack.pop();
  });
  e.primitive("or", (e, t) => {
    if (e.condStack[e.condStack.length - 1] !== "case") { e.diag.error("E006", "extra \\or", t); return; }
    for (;;) {
      const end = skipBranch(e, t);
      if (end === "fi" || end === "eof") break;
    }
    e.condStack.pop();
  });
  e.primitive("fi", (e, t) => {
    if (!e.condStack.length) { e.diag.error("E006", "extra \\fi", t); return; }
    e.condStack.pop();
  });

  e.primitive("expandafter", e => {
    const a = e.nextRaw(), b = e.nextRaw();
    if (b) {
      const m = b.kind === "cs" && !b.noexpand ? e.meaning(b) : undefined;
      if (b.kind === "cs" && e.isExpandable(m)) e.expand(b, m!);
      else e.pushBackOne(b);
    }
    if (a) e.pushBackOne(a);
  });

  e.primitive("noexpand", e => {
    const t = e.nextRaw();
    if (!t) return;
    if (t.kind === "cs" && e.isExpandable(e.meaning(t))) e.pushBack([{ ...t, noexpand: true }]);
    else e.pushBackOne(t);
  });

  e.primitive("csname", (e, t) => {
    const name = readCsName(e, t);
    if (!e.isDefined(name)) e.define(name, { type: "command", name: "relax" });
    e.pushBack([csTok(name, t)]);
  });

  e.primitive("string", (e, t) => {
    const u = e.nextRaw();
    if (!u) return;
    const s = u.kind === "char" ? u.ch : u.kind === "cs" ? (u.active ? u.name : "\\" + u.name) : "#";
    e.pushBack(stringToTokens(s, t));
  });

  e.primitive("number", (e, t) => e.pushBack(stringToTokens(String(e.readNumber(t)), t)));
  e.primitive("romannumeral", (e, t) => e.pushBack(stringToTokens(toRoman(e.readNumber(t)), t)));
  e.primitive("the", (e, t) => e.pushBack(e.theTokens(t)));
  e.primitive("detokenize", (e, t) => e.pushBack(stringToTokens(tokensToString(e.readGeneralText(t)), t)));
  e.primitive("unexpanded", (e, t) => e.pushBack(e.readGeneralText(t)));
  e.primitive("jobname", (e, t) => e.pushBack(stringToTokens(e.opts.jobname, t)));
  e.primitive("meaning", (e, t) => {
    const u = e.nextRaw();
    if (!u) return;
    const m = e.meaning(u);
    let s: string;
    if (!m) s = "undefined";
    else if (m.type === "char") s = (m.cat === Cat.Letter ? "the letter " : "the character ") + m.ch;
    else if (m.type === "macro") s = "macro:" + tokensToString(m.params.flatMap((d, i) => [{ kind: "param", n: i + 1, file: -1, pos: 0 } as Token, ...d])) + "->" + tokensToString(m.body);
    else if (m.type === "latex") s = "\\protected macro:->" + tokensToString(m.body);
    else s = "\\" + ("name" in m ? m.name : "register");
    e.pushBack(stringToTokens(s, t));
  });

  e.primitive("input", (e, t) => {
    // LaTeX syntax \input{file} or TeX syntax \input file⟨space⟩.
    e.skipSpacesRaw();
    const first = e.nextRaw();
    let name = "";
    if (first && isChar(first, Cat.BeginGroup)) name = tokensToString(e.expandFully(e.readGroupBody(first))).trim();
    else {
      if (first) e.pushBackOne(first);
      for (;;) {
        const u = e.next();
        if (!u || isSpace(u) || u.kind !== "char") { if (u && !isSpace(u)) e.pushBackOne(u); break; }
        name += u.ch;
      }
    }
    if (name) e.inputFile(name, t, "input");
  });
  e.primitive("endinput", e => { e.currentLexer()?.endInput(); });

  // xparse helpers on argument values.
  const branch2 = (name: string, test: (arg: Token[]) => boolean, which: "TF" | "T" | "F") => {
    e.primitive(name, (e, t) => {
      const arg = e.readUndelimited(t) ?? [];
      const yes = which !== "F" ? e.readUndelimited(t) ?? [] : [];
      const no = which !== "T" ? e.readUndelimited(t) ?? [] : [];
      e.pushBack(test(arg) ? yes : no);
    });
  };
  const isTrue = (a: Token[]) => a.some(x => isCs(x, "BooleanTrue"));
  const isNoValue = (a: Token[]) => a.length === 1 && isCs(a[0], "\u0000NoValue");
  for (const w of ["TF", "T", "F"] as const) {
    branch2("IfBooleanTF".replace("TF", w), isTrue, w);
    branch2("IfNoValueTF".replace("TF", w), isNoValue, w);
    branch2("IfValueTF".replace("TF", w), a => !isNoValue(a), w);
  }
  e.primitive("IfBlankTF", (e, t) => {
    const arg = e.readUndelimited(t) ?? [], yes = e.readUndelimited(t) ?? [], no = e.readUndelimited(t) ?? [];
    e.pushBack(arg.every(x => isSpace(x)) ? yes : no);
  });

  // LaTeX counters print through these (\arabic{x} → \@arabic\c@x).
  e.primitive("@arabic", (e, t) => e.pushBack(stringToTokens(String(e.readNumber(t)), t)));
  e.primitive("@roman", (e, t) => e.pushBack(stringToTokens(toRoman(e.readNumber(t)), t)));
  e.primitive("@Roman", (e, t) => e.pushBack(stringToTokens(toRoman(e.readNumber(t)).toUpperCase(), t)));
  e.primitive("@alph", (e, t) => e.pushBack(stringToTokens(toAlph(e.readNumber(t)), t)));
  e.primitive("@Alph", (e, t) => e.pushBack(stringToTokens(toAlph(e.readNumber(t)).toUpperCase(), t)));
  e.primitive("@fnsymbol", (e, t) => e.pushBack(stringToTokens(toFnSymbol(e.readNumber(t)), t)));

  // \@ifundefined{name}{yes}{no}: undefined or \relax counts as undefined.
  e.primitive("@ifundefined", (e, t) => {
    const name = tokensToString(e.expandFully(e.readUndelimited(t) ?? [])).trim();
    const yes = e.readUndelimited(t) ?? [], no = e.readUndelimited(t) ?? [];
    const m = e.meaningOf(name);
    e.pushBack(!m || (m.type === "command" && m.name === "relax") ? yes : no);
  });
}

export const spaceToken = () => charTok(" ", Cat.Space);
