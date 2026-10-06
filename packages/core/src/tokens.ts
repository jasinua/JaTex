// Category codes and tokens.

export const Cat = {
  Escape: 0, BeginGroup: 1, EndGroup: 2, MathShift: 3, AlignTab: 4, EndLine: 5, Param: 6,
  Sup: 7, Sub: 8, Ignored: 9, Space: 10, Letter: 11, Other: 12, Active: 13, Comment: 14, Invalid: 15,
} as const;
export type Cat = (typeof Cat)[keyof typeof Cat];

const DEFAULTS: Record<string, Cat> = {
  "\\": Cat.Escape, "{": Cat.BeginGroup, "}": Cat.EndGroup, "$": Cat.MathShift, "&": Cat.AlignTab,
  "\n": Cat.EndLine, "#": Cat.Param, "^": Cat.Sup, "_": Cat.Sub, " ": Cat.Space, "\t": Cat.Space,
  "~": Cat.Active, "%": Cat.Comment, "\u0000": Cat.Ignored, "\u007f": Cat.Invalid,
};

export function defaultCat(cp: number): Cat {
  const c = String.fromCodePoint(cp);
  if (c in DEFAULTS) return DEFAULTS[c];
  return (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) ? Cat.Letter : Cat.Other;
}

/** Where a token came from: index into the SourceMap plus a UTF-16 offset. */
export interface Loc { file: number; pos: number }

export interface CharToken extends Loc { kind: "char"; ch: string; cat: Cat }
/** Control word, control symbol, or (with `active`) an active character. */
export interface CsToken extends Loc { kind: "cs"; name: string; active?: boolean; noexpand?: boolean }
/** A macro parameter reference inside a stored macro body. Never leaves the expander. */
export interface ParamToken extends Loc { kind: "param"; n: number }

export type Token = CharToken | CsToken | ParamToken;

export const NO_LOC: Loc = { file: -1, pos: 0 };

export const charTok = (ch: string, cat: Cat, loc: Loc = NO_LOC): CharToken => ({ kind: "char", ch, cat, file: loc.file, pos: loc.pos });
export const csTok = (name: string, loc: Loc = NO_LOC): CsToken => ({ kind: "cs", name, file: loc.file, pos: loc.pos });

/** Fences end a token list being digested; argument readers never consume them. */
export const FENCE = "\u0000fence";
export const isFence = (t: Token | null | undefined): boolean => !!t && t.kind === "cs" && t.name.startsWith(FENCE);
export const fenceTok = (id: number): CsToken => csTok(FENCE + id);

/** Key under which a control sequence's meaning is stored. Active chars get a prefix no name can produce. */
export const meaningKey = (t: CsToken): string => (t.active ? "\u0001" + t.name : t.name);

// Plain booleans, not type guards: a false result must not narrow away every char/cs token.
export const isChar = (t: Token | null | undefined, cat?: Cat, ch?: string): boolean =>
  !!t && t.kind === "char" && (cat === undefined || t.cat === cat) && (ch === undefined || t.ch === ch);
export const isCs = (t: Token | null | undefined, name?: string): boolean =>
  !!t && t.kind === "cs" && !t.active && (name === undefined || t.name === name);

export const isBeginGroup = (t: Token | null | undefined): boolean => isChar(t, Cat.BeginGroup);
export const isEndGroup = (t: Token | null | undefined): boolean => isChar(t, Cat.EndGroup);
export const isSpace = (t: Token | null | undefined): boolean => isChar(t, Cat.Space);

/** Token equality as TeX uses it for delimiter matching and \ifx on characters. */
export function sameToken(a: Token, b: Token): boolean {
  if (a.kind === "char" && b.kind === "char") return a.ch === b.ch && a.cat === b.cat;
  if (a.kind === "cs" && b.kind === "cs") return a.name === b.name && !!a.active === !!b.active;
  if (a.kind === "param" && b.kind === "param") return a.n === b.n;
  return false;
}

/** Characters as TeX's \string / \detokenize would print them (escape char is backslash). */
export function tokensToString(ts: Token[]): string {
  let s = "";
  for (const t of ts) {
    if (t.kind === "char") s += t.ch;
    else if (t.kind === "param") s += "#" + t.n;
    else if (t.active) s += t.name;
    else s += "\\" + t.name + (t.name.length > 1 || /[A-Za-z]/.test(t.name) ? " " : "");
  }
  return s;
}

/** Tokens for a plain string, as \detokenize produces: spaces are space tokens, all else "other". */
export function stringToTokens(s: string, loc: Loc = NO_LOC): CharToken[] {
  return [...s].map(ch => charTok(ch, ch === " " ? Cat.Space : Cat.Other, loc));
}
