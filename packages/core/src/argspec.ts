// xparse-style argument specifications: "s o m", "O{default} m", "D<>{x}", "r()", "t+", "v", "b".

import { Cat, charTok, type Token } from "./tokens.ts";

export type ArgSpec =
  | { t: "m" }
  | { t: "o"; default?: Token[] }
  | { t: "s" }
  | { t: "t"; ch: string }
  | { t: "d"; open: string; close: string; default?: Token[] }
  | { t: "r"; open: string; close: string; default?: Token[] }
  | { t: "v" }
  | { t: "b" }
  | { t: "e"; chars: string };

export interface Arg {
  present: boolean;
  tokens: Token[];
  /** Raw text for verbatim (v) arguments. */
  text?: string;
}

const strTokens = (s: string): Token[] => [...s].map(ch => charTok(ch, ch === " " ? Cat.Space : /[A-Za-z]/.test(ch) ? Cat.Letter : Cat.Other));

/** Parses a signature written as a plain string (used by built-in handlers). */
export function parseSpec(sig: string): ArgSpec[] {
  const out: ArgSpec[] = [];
  let i = 0;
  const readBraced = (): string => {
    if (sig[i] !== "{") return "";
    let depth = 0, s = "";
    for (; i < sig.length; i++) {
      const c = sig[i];
      if (c === "{") { if (depth++ > 0) s += c; }
      else if (c === "}") { if (--depth === 0) { i++; break; } s += c; }
      else s += c;
    }
    return s;
  };
  while (i < sig.length) {
    const c = sig[i++];
    if (c === " " || c === "+" || c === "!") continue;
    switch (c) {
      case "m": out.push({ t: "m" }); break;
      case "o": out.push({ t: "o" }); break;
      case "O": out.push({ t: "o", default: strTokens(readBraced()) }); break;
      case "s": out.push({ t: "s" }); break;
      case "t": out.push({ t: "t", ch: sig[i++] }); break;
      case "d": case "r": { const open = sig[i++], close = sig[i++]; out.push({ t: c, open, close }); break; }
      case "D": case "R": {
        const open = sig[i++], close = sig[i++];
        out.push({ t: c === "D" ? "d" : "r", open, close, default: strTokens(readBraced()) });
        break;
      }
      case "v": out.push({ t: "v" }); break;
      case "b": out.push({ t: "b" }); break;
      case "e": out.push({ t: "e", chars: readBraced() }); break;
      default: throw new Error(`unknown argument type '${c}' in signature "${sig}"`);
    }
  }
  return out;
}

/** Parses a signature given as tokens (\NewDocumentCommand{\foo}{s o m}{…}). */
export function parseSpecTokens(ts: Token[]): ArgSpec[] {
  const out: ArgSpec[] = [];
  let i = 0;
  const skip = () => { while (i < ts.length && ts[i].kind === "char" && (ts[i] as { cat: number }).cat === Cat.Space) i++; };
  const ch = (t: Token | undefined): string => (t && t.kind === "char" ? t.ch : t && t.kind === "cs" ? t.name : "");
  const readGroup = (): Token[] => {
    skip();
    const t = ts[i];
    if (!t || t.kind !== "char" || t.cat !== Cat.BeginGroup) return [];
    let depth = 0;
    const start = ++i;
    for (; i < ts.length; i++) {
      const u = ts[i];
      if (u.kind === "char" && u.cat === Cat.BeginGroup) depth++;
      if (u.kind === "char" && u.cat === Cat.EndGroup) { if (depth-- === 0) return ts.slice(start, i++); }
    }
    return ts.slice(start);
  };
  while (i < ts.length) {
    skip();
    if (i >= ts.length) break;
    const c = ch(ts[i++]);
    switch (c) {
      case "m": out.push({ t: "m" }); break;
      case "o": out.push({ t: "o" }); break;
      case "O": out.push({ t: "o", default: readGroup() }); break;
      case "s": out.push({ t: "s" }); break;
      case "t": out.push({ t: "t", ch: ch(ts[i++]) }); break;
      case "d": case "r": { const open = ch(ts[i++]), close = ch(ts[i++]); out.push({ t: c, open, close }); break; }
      case "D": case "R": {
        const open = ch(ts[i++]), close = ch(ts[i++]);
        out.push({ t: c === "D" ? "d" : "r", open, close, default: readGroup() });
        break;
      }
      case "v": out.push({ t: "v" }); break;
      case "b": out.push({ t: "b" }); break;
      case "e": case "E": { const g = readGroup(); out.push({ t: "e", chars: g.map(ch).join("") }); if (c === "E") readGroup(); break; }
      case "+": case "!": break;                        // modifiers are accepted and ignored
      case ">": case "=": readGroup(); break;           // processors >{\SplitList{,}} and ={key} are ignored
      case "{": case "}": break;
      default: throw new Error(`unknown argument type '${c}'`);
    }
  }
  return out;
}
