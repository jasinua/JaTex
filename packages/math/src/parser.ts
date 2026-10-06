// Stream math parser: pulls expanded tokens from the engine (so user macros work inside math)
// and builds a MathNode tree. Layout is left to Word; only structure is recovered.

import {
  Cat, isBeginGroup, isEndGroup, isSpace, tokensToString, type CsToken, type Engine, type Loc, type Token,
} from "@texdocx/core";
import type { MathNode } from "@texdocx/model";
import { ACCENTS, DELIMS, FUNCTIONS, FUNCTION_TEXT, MATH_CHAR, NARY, NEGATIONS, SYMBOLS, charClass, mapAlphabet, type Cls } from "./symbols.ts";

export interface MathHooks {
  /** Plain text of text-mode material inside math (\text{…}). */
  text(tokens: Token[]): string;
}

export interface MathRow { cells: MathNode[]; label?: string; tag?: string; notag: boolean }

type Atom = Extract<MathNode, { k: "atom" }>;
type Font = { style?: "p" | "b" | "i" | "bi"; alphabet?: string };

type End =
  | { kind: "stop" } | { kind: "group" } | { kind: "amp" } | { kind: "cr" } | { kind: "eof" }
  | { kind: "right"; delim: string } | { kind: "middle"; delim: string } | { kind: "end"; name: string };

interface ListOpts {
  stop?: (t: Token) => boolean;
  group?: boolean;
  cells?: boolean;
  left?: boolean;
  env?: string;
}

const row = (items: MathNode[]): MathNode => (items.length === 1 ? items[0] : { k: "row", items });
const atom = (text: string, extra: Partial<Atom> = {}): Atom => ({ k: "atom", text, ...extra });
const EMPTY = (): MathNode => ({ k: "row", items: [] });
const isEmpty = (n: MathNode): boolean => n.k === "row" && n.items.length === 0;

/** Environments that build matrices, with their delimiters. */
const MATRIX_ENVS: Record<string, [string, string] | null> = {
  matrix: null, smallmatrix: null, pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"],
  vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], array: null, subarray: null,
  "matrix*": null, "pmatrix*": ["(", ")"], "bmatrix*": ["[", "]"], "Bmatrix*": ["{", "}"], "vmatrix*": ["|", "|"], "Vmatrix*": ["‖", "‖"],
};
const ALIGNED_ENVS = new Set(["aligned", "alignedat", "split", "gathered", "multlined", "eqnarray", "align", "align*", "gather", "gather*", "alignat", "alignat*", "flalign", "flalign*", "multline", "multline*", "eqnarray*"]);

export class MathParser {
  private e: Engine;
  private hooks: MathHooks;
  private display: boolean;
  private font: Font = {};
  private numbers = new WeakSet<MathNode>();
  private pendingFuncs = new WeakMap<MathNode, { limits: boolean }>();
  private rowMeta: { label?: string; tag?: string; notag: boolean } | null = null;
  private from: Loc;

  constructor(e: Engine, hooks: MathHooks, display: boolean, from: Loc) {
    this.e = e;
    this.hooks = hooks;
    this.display = display;
    this.from = from;
  }

  /** Parses until `stop` accepts a token (consumed). */
  parseUntil(stop: (t: Token) => boolean): MathNode {
    const r = this.parseList({ stop });
    if (r.end.kind === "eof") this.e.diag.error("E002", "math mode not closed before end of input", this.from);
    return row(r.items);
  }

  /** Parses everything up to the end of the current input (a fence), without an error at the end. */
  parseToEnd(): MathNode {
    return row(this.parseList({}).items);
  }

  /** Rows of a display environment (equation, align, gather, …) up to \end{env}. */
  parseRows(env: string, cellsAllowed = true): MathRow[] {
    const outerMeta = this.rowMeta;   // a matrix inside a display row must not wipe that row's \label/\tag
    const rows: MathRow[] = [];
    for (;;) {
      const cells: MathNode[] = [];
      this.rowMeta = { notag: false };
      let end: End;
      for (;;) {
        const r = this.parseList({ env, cells: cellsAllowed });
        cells.push(row(r.items));
        end = r.end;
        if (end.kind !== "amp") break;
      }
      const meta = this.rowMeta;
      this.rowMeta = null;
      const blank = cells.every(isEmpty);
      if (!(blank && end.kind !== "cr" && rows.length > 0)) rows.push({ cells, ...meta });
      if (end.kind !== "cr") {
        if (end.kind === "eof") this.e.diag.error("E006", `\\begin{${env}} not closed`, this.from);
        break;
      }
    }
    this.rowMeta = outerMeta;
    return rows;
  }

  /** One aligned row: cells joined, with an alignment point at the start of every cell but the first. */
  static alignRow(cells: MathNode[]): MathNode {
    const items: MathNode[] = [];
    cells.forEach((c, i) => {
      const parts = c.k === "row" ? [...c.items] : [c];
      if (i > 0) {
        const first = parts[0];
        if (first && first.k === "atom") parts[0] = { ...first, aln: true };
        else parts.unshift(atom("​", { aln: true }));
      }
      items.push(...parts);
    });
    return row(items);
  }

  // ------------------------------------------------------------------ lists

  private parseList(opts: ListOpts): { items: MathNode[]; end: End } {
    const items: MathNode[] = [];
    for (;;) {
      const t = this.e.next();
      if (!t) return { items: this.finish(items), end: { kind: "eof" } };
      if (opts.stop && opts.stop(t)) return { items: this.finish(items), end: { kind: "stop" } };
      if (t.kind === "char") {
        const end = this.char(t.ch, t.cat, items, opts, t);
        if (end) return { items: this.finish(items), end };
        continue;
      }
      if (t.kind === "cs") {
        if (t.noexpand) continue;
        const end = this.command(t, items, opts);
        if (end) return { items: this.finish(items), end };
      }
    }
  }

  private char(ch: string, cat: Cat, items: MathNode[], opts: ListOpts, t: Loc): End | undefined {
    switch (cat) {
      case Cat.Space: return undefined;
      case Cat.BeginGroup: {
        const saved = this.font;
        const r = this.parseList({ group: true });
        this.font = saved;
        items.push(row(r.items));
        return undefined;
      }
      case Cat.EndGroup:
        if (opts.group) return { kind: "group" };
        this.e.diag.error("E006", "extra } in math", t);
        return undefined;
      case Cat.Sup: this.script(items, "sup", t); return undefined;
      case Cat.Sub: this.script(items, "sub", t); return undefined;
      case Cat.AlignTab:
        if (opts.cells) return { kind: "amp" };
        this.e.diag.error("E006", "misplaced alignment tab & in math", t);
        return undefined;
      case Cat.MathShift:
        this.e.diag.error("E006", "unexpected $ inside math", t);
        return opts.group ? undefined : { kind: "stop" };
      case Cat.Param: return undefined;
      case Cat.Letter: items.push(this.letter(ch)); return undefined;
      default: {
        if (ch === "'") { this.prime(items); return undefined; }
        const last = items[items.length - 1];
        if (/[0-9]/.test(ch) || (ch === "." && last && this.numbers.has(last))) {
          if (last && last.k === "atom" && this.numbers.has(last) && !this.font.alphabet) { last.text += ch; return undefined; }
          const a = this.styled(ch, "ord");
          this.numbers.add(a);
          items.push(a);
          return undefined;
        }
        items.push(atom(MATH_CHAR[ch] ?? ch, { cls: charClass(ch) }));
        return undefined;
      }
    }
  }

  private letter(ch: string): Atom {
    return this.styled(ch, "ord");
  }

  private styled(text: string, cls: Cls): Atom {
    const f = this.font;
    if (f.alphabet) return atom(mapAlphabet(text, f.alphabet), { cls, style: "p" });
    return atom(text, { cls, style: f.style });
  }

  private prime(items: MathNode[]): void {
    let n = 1;
    for (;;) {
      const u = this.e.peekRaw();
      if (u && u.kind === "char" && u.ch === "'") { this.e.nextRaw(); n++; } else break;
    }
    const primes = n === 1 ? "′" : n === 2 ? "″" : n === 3 ? "‴" : "′".repeat(n);
    const base = items.pop() ?? atom("");
    let sup: MathNode = atom(primes);
    const u = this.e.peekRaw();
    if (u && u.kind === "char" && u.cat === Cat.Sup) {
      this.e.nextRaw();
      sup = row([sup, this.scriptArg()]);
    }
    items.push(base.k === "sub" ? { k: "subsup", base: base.base, sub: base.sub, sup } : { k: "sup", base, sup });
  }

  /** The argument of ^ or _: a group, or a single token's worth of math. */
  private scriptArg(): MathNode {
    for (;;) {
      const t = this.e.next();
      if (!t) return EMPTY();
      if (t.kind === "char") {
        if (t.cat === Cat.Space) continue;
        if (t.cat === Cat.BeginGroup) {
          const saved = this.font;
          const r = this.parseList({ group: true });
          this.font = saved;
          return row(r.items);
        }
        if (t.cat === Cat.Letter) return this.letter(t.ch);
        if (t.cat === Cat.Other) return /[0-9]/.test(t.ch) ? this.styled(t.ch, "ord") : atom(MATH_CHAR[t.ch] ?? t.ch, { cls: charClass(t.ch) });
        this.e.pushBackOne(t);
        return EMPTY();
      }
      if (t.kind === "cs") {
        const tmp: MathNode[] = [];
        this.command(t, tmp, {});
        return row(this.finish(tmp));
      }
      return EMPTY();
    }
  }

  private script(items: MathNode[], kind: "sup" | "sub", t: Loc): void {
    const arg = this.scriptArg();
    const base = items.pop() ?? atom("");
    if (base.k === "nary" && !base[kind]) { base[kind] = arg; items.push(base); return; }
    const pf = this.pendingFuncs.get(base);
    if (pf && base.k === "func") {
      // Scripts on \lim, \max, \sin: limits under the name in display style, else a script on the name.
      if (pf.limits && this.display && kind === "sub") base.name = { k: "limLow", base: base.name, lim: arg };
      else base.name = attach(base.name, kind, arg);
      items.push(base);
      return;
    }
    if (base.k === "groupChr" && base.pos === "top" && kind === "sup") { items.push({ k: "limUpp", base, lim: arg }); return; }
    if (base.k === "groupChr" && base.pos === "bot" && kind === "sub") { items.push({ k: "limLow", base, lim: arg }); return; }
    if ((base.k === "sup" && kind === "sup") || (base.k === "sub" && kind === "sub") || base.k === "subsup") {
      this.e.diag.error("E002", `double ${kind === "sup" ? "superscript" : "subscript"}`, t);
      items.push(attach(row([base]), kind, arg));
      return;
    }
    items.push(attach(base, kind, arg));
  }

  /** Fills bodies of large operators and functions from the items that follow them. */
  private finish(items: MathNode[]): MathNode[] {
    const out: MathNode[] = [];
    for (let i = 0; i < items.length; i++) {
      const n = items[i];
      if (n.k === "nary" && isEmpty(n.body)) {
        // The body runs to the next relation/binary operator outside brackets opened inside it.
        const body: MathNode[] = [];
        let depth = 0;
        while (i + 1 < items.length) {
          const next = items[i + 1];
          if (next.k === "atom" && next.cls === "close" && depth === 0) break;
          if (depth === 0 && isBreak(next)) break;
          if (next.k === "atom" && next.cls === "open") depth++;
          if (next.k === "atom" && next.cls === "close") depth--;
          body.push(items[++i]);
        }
        n.body = row(body);
      } else if (n.k === "func" && this.pendingFuncs.has(n)) {
        this.pendingFuncs.delete(n);
        const next = items[i + 1];
        if (next && !isBreak(next)) { n.body = next; i++; }
      }
      out.push(n);
    }
    return out;
  }

  // ------------------------------------------------------------------ commands

  private arg(): MathNode {
    this.e.skipSpacesExpanded();
    const t = this.e.next();
    if (!t) return EMPTY();
    if (isBeginGroup(t)) {
      const saved = this.font;
      const r = this.parseList({ group: true });
      this.font = saved;
      return row(r.items);
    }
    this.e.pushBackOne(t);
    return this.scriptArg();
  }

  private withFont(f: Font): MathNode {
    const saved = this.font;
    this.font = f;
    const n = this.arg();
    this.font = saved;
    return n;
  }

  private tokensToMath(toks: Token[]): MathNode {
    const END = this.e.newFence();
    this.e.pushBack([...toks, END]);
    const r = this.parseList({});
    this.e.discardToFence(END);
    return row(r.items);
  }

  private readDelim(from: Loc): string {
    for (;;) {
      const t = this.e.next();
      if (!t) return "";
      if (isSpace(t)) continue;
      if (t.kind === "char") return DELIMS[t.ch] ?? t.ch;
      if (t.kind === "cs") {
        const m = this.e.meaning(t);
        const name = m && m.type === "command" ? m.name : t.name;
        if (name === "|") return "‖";
        if (DELIMS[name] !== undefined) return DELIMS[name];
        if (SYMBOLS[name]) return SYMBOLS[name][0];
        this.e.diag.warn("W013", `unknown delimiter \\${t.name}`, from);
        return "";
      }
      return "";
    }
  }

  private envName(from: Loc): string {
    return tokensToString(this.e.expandFully(this.e.readUndelimited(from) ?? [])).trim();
  }

  private command(t: CsToken, items: MathNode[], opts: ListOpts): End | undefined {
    const e = this.e;
    const m = e.meaning(t);
    if (m && m.type === "char") return this.char(m.ch, m.cat, items, opts, t);
    const name = t.active ? (t.name === "~" ? "nobreakspace" : t.name) : m && m.type === "command" ? m.name : t.name;

    switch (name) {
      case "\\": case "cr": case "newline": case "tabularnewline":
        if (opts.cells || opts.env) { e.readFlag("*"); e.readOptional(); return { kind: "cr" }; }
        return undefined;
      case "right":
        if (opts.left) return { kind: "right", delim: this.readDelim(t) };
        e.diag.error("E006", "\\right without matching \\left", t);
        this.readDelim(t);
        return undefined;
      case "middle":
        if (opts.left) return { kind: "middle", delim: this.readDelim(t) };
        items.push(atom(this.readDelim(t), { cls: "rel" }));
        return undefined;
      case "end": {
        const env = this.envName(t);
        if (opts.env === env) return { kind: "end", name: env };
        e.diag.error("E006", `\\end{${env}} does not match ${opts.env ? `\\begin{${opts.env}}` : "math mode"}`, t);
        return opts.env ? { kind: "end", name: env } : undefined;
      }
      case "begin": items.push(this.environment(this.envName(t), t)); return undefined;
      case "left": {
        const open = this.readDelim(t);
        const parts: MathNode[] = [];
        let close = "";
        for (;;) {
          const r = this.parseList({ left: true });
          parts.push(row(r.items));
          if (r.end.kind === "middle") continue;
          if (r.end.kind === "right") close = r.end.delim;
          else e.diag.error("E006", "\\left without matching \\right", t);
          break;
        }
        items.push({ k: "delim", open, close, body: parts });
        return undefined;
      }
      case "big": case "Big": case "bigg": case "Bigg": case "bigm": case "Bigm": case "biggm": case "Biggm":
        items.push(atom(this.readDelim(t), { cls: "ord" })); return undefined;
      case "bigl": case "Bigl": case "biggl": case "Biggl":
        items.push(atom(this.readDelim(t), { cls: "open" })); return undefined;
      case "bigr": case "Bigr": case "biggr": case "Biggr":
        items.push(atom(this.readDelim(t), { cls: "close" })); return undefined;
      case "frac": case "dfrac": case "tfrac": case "cfrac": {
        if (name === "cfrac") e.readOptional();
        const num = this.arg(), den = this.arg();
        items.push({ k: "frac", num, den });
        return undefined;
      }
      case "binom": case "dbinom": case "tbinom": {
        const num = this.arg(), den = this.arg();
        items.push({ k: "delim", open: "(", close: ")", body: [{ k: "frac", num, den, bar: false }] });
        return undefined;
      }
      case "genfrac": {
        const l = tokensToString(e.readUndelimited(t) ?? []).trim(), r = tokensToString(e.readUndelimited(t) ?? []).trim();
        const thick = tokensToString(e.readUndelimited(t) ?? []).trim();
        e.readUndelimited(t);
        const num = this.arg(), den = this.arg();
        const f: MathNode = { k: "frac", num, den, bar: thick === "0pt" ? false : undefined };
        items.push(l || r ? { k: "delim", open: DELIMS[l.replace(/^\\/, "")] ?? l, close: DELIMS[r.replace(/^\\/, "")] ?? r, body: [f] } : f);
        return undefined;
      }
      case "sqrt": {
        const idx = e.readOptional();
        const body = this.arg();
        items.push({ k: "sqrt", body, index: idx ? this.tokensToMath(idx) : undefined });
        return undefined;
      }
      case "text": case "textrm": case "textnormal": case "mbox": case "hbox": case "textup": case "textit":
      case "textbf": case "textsf": case "texttt": case "emph": case "textmd": case "textsl": case "fbox": {
        const toks = e.readUndelimited(t) ?? [];
        const text = this.hooks.text(toks);
        const a = atom(text, { normal: true });
        items.push(name === "fbox" ? { k: "box", body: a } : a);
        return undefined;
      }
      case "operatorname": case "mathop": {
        const star = name === "operatorname" ? e.readFlag("*") : true;
        const toks = e.readUndelimited(t) ?? [];
        const text = name === "operatorname" ? this.hooks.text(toks) : "";
        const nameNode: MathNode = name === "operatorname" ? atom(text, { style: "p", cls: "op" }) : this.tokensToMath(toks);
        this.pushFunc(items, nameNode, star);
        return undefined;
      }
      case "limits": case "nolimits": case "displaylimits": {
        const last = items[items.length - 1];
        if (last && last.k === "nary") last.limits = name !== "nolimits";
        if (last && last.k === "func" && this.pendingFuncs.has(last)) this.pendingFuncs.set(last, { limits: name !== "nolimits" });
        return undefined;
      }
      case "overline": items.push({ k: "bar", pos: "top", body: this.arg() }); return undefined;
      case "underline": items.push({ k: "bar", pos: "bot", body: this.arg() }); return undefined;
      case "overbrace": items.push({ k: "groupChr", chr: "⏞", pos: "top", body: this.arg() }); return undefined;
      case "underbrace": items.push({ k: "groupChr", chr: "⏟", pos: "bot", body: this.arg() }); return undefined;
      case "overbracket": items.push({ k: "groupChr", chr: "⎴", pos: "top", body: this.arg() }); return undefined;
      case "underbracket": items.push({ k: "groupChr", chr: "⎵", pos: "bot", body: this.arg() }); return undefined;
      case "overset": case "stackrel": { const a = this.arg(), b = this.arg(); items.push({ k: "limUpp", base: b, lim: a }); return undefined; }
      case "underset": { const a = this.arg(), b = this.arg(); items.push({ k: "limLow", base: b, lim: a }); return undefined; }
      case "xrightarrow": case "xleftarrow": case "xLeftarrow": case "xRightarrow": case "xleftrightarrow": case "xmapsto": {
        const below = e.readOptional();
        const above = this.arg();
        const chr = { xrightarrow: "→", xleftarrow: "←", xLeftarrow: "⇐", xRightarrow: "⇒", xleftrightarrow: "↔", xmapsto: "↦" }[name]!;
        let n: MathNode = atom(chr, { cls: "rel" });
        if (below) n = { k: "limLow", base: n, lim: this.tokensToMath(below) };
        items.push({ k: "limUpp", base: n, lim: above });
        return undefined;
      }
      case "boxed": items.push({ k: "box", body: this.arg() }); return undefined;
      case "phantom": items.push({ k: "phantom", body: this.arg() }); return undefined;
      case "hphantom": items.push({ k: "phantom", body: this.arg(), height: false }); return undefined;
      case "vphantom": items.push({ k: "phantom", body: this.arg(), width: false }); return undefined;
      case "smash": e.readOptional(); items.push(this.arg()); return undefined;
      case "mathstrut": case "strut": return undefined;
      case "mathrm": case "mathup": case "textup@": items.push(this.withFont({ style: "p" })); return undefined;
      case "mathit": items.push(this.withFont({ style: "i" })); return undefined;
      case "mathbf": items.push(this.withFont({ style: "b" })); return undefined;
      case "boldsymbol": case "bm": case "mathbfit": items.push(this.withFont({ style: "bi" })); return undefined;
      case "mathnormal": items.push(this.withFont({})); return undefined;
      case "mathsf": case "mathsfup": items.push(this.withFont({ alphabet: "sf" })); return undefined;
      case "mathtt": items.push(this.withFont({ alphabet: "tt" })); return undefined;
      case "mathbb": case "Bbb": case "mathds": items.push(this.withFont({ alphabet: "bb" })); return undefined;
      case "mathcal": items.push(this.withFont({ alphabet: "cal" })); return undefined;
      case "mathscr": items.push(this.withFont({ alphabet: "scr" })); return undefined;
      case "mathfrak": items.push(this.withFont({ alphabet: "frak" })); return undefined;
      case "rm": this.font = { style: "p" }; return undefined;
      case "bf": this.font = { style: "b" }; return undefined;
      case "it": case "mit": this.font = { style: "i" }; return undefined;
      case "cal": this.font = { alphabet: "cal" }; return undefined;
      case "sf": this.font = { alphabet: "sf" }; return undefined;
      case "tt": this.font = { alphabet: "tt" }; return undefined;
      case "boldmath": this.font = { style: "bi" }; return undefined;
      case "displaystyle": case "textstyle": case "scriptstyle": case "scriptscriptstyle": case "nonscript":
      case "relax": case "allowbreak": case "nobreak": case "\u0000NoValue": case "protect": case "label@":
      case "nolinebreak": case "linebreak": case "hfil": case "hfill": case "hss": case "vfill":
        return undefined;
      case ",": case "thinspace": items.push(atom(" ")); return undefined;
      case ":": case ">": case "medspace": items.push(atom(" ")); return undefined;
      case ";": case "thickspace": items.push(atom(" ")); return undefined;
      case " ": case "nobreakspace": case "space": items.push(atom(" ")); return undefined;
      case "enspace": items.push(atom(" ")); return undefined;
      case "quad": items.push(atom(" ")); return undefined;
      case "qquad": items.push(atom("  ")); return undefined;
      case "!": case "negthinspace": case "negmedspace": case "negthickspace": return undefined;
      case "hspace": case "hspace*": e.readFlag("*"); e.readUndelimited(t); items.push(atom(" ")); return undefined;
      case "hskip": case "kern": case "mkern": case "mskip": case "vspace": case "vskip": {
        if (name === "vspace") { e.readFlag("*"); e.readUndelimited(t); }
        else if (name === "mkern" || name === "mskip") { e.readDimen(t, true); }
        else e.readGlue(t);
        return undefined;
      }
      case "not": {
        const tmp: MathNode[] = [];
        const u = e.next();
        if (!u) return undefined;
        if (u.kind === "char") this.char(u.ch, u.cat, tmp, {}, u); else if (u.kind === "cs") this.command(u, tmp, {});
        const a = tmp[0];
        if (a && a.k === "atom") items.push({ ...a, text: NEGATIONS[a.text] ?? a.text + "̸" });
        else items.push(...tmp);
        return undefined;
      }
      case "label": {
        const key = tokensToString(e.readUndelimited(t) ?? []).trim();
        if (this.rowMeta) this.rowMeta.label = key;
        return undefined;
      }
      case "tag": {
        const star = e.readFlag("*");
        const text = this.hooks.text(e.readUndelimited(t) ?? []);
        if (this.rowMeta) this.rowMeta.tag = star ? text : `(${text})`;
        return undefined;
      }
      case "notag": case "nonumber": if (this.rowMeta) this.rowMeta.notag = true; return undefined;
      case "color": e.readOptional(); e.readUndelimited(t); return undefined;
      case "textcolor": case "colorbox": e.readOptional(); e.readUndelimited(t); items.push(this.arg()); return undefined;
      case "mathchoice": { const a = this.arg(); this.arg(); this.arg(); this.arg(); items.push(a); return undefined; }
      case "pmod": {
        const a = this.arg();
        items.push({ k: "delim", open: "(", close: ")", body: [row([atom("mod", { style: "p" }), atom(" "), a])] });
        return undefined;
      }
      case "bmod": case "mod": items.push(atom(name === "mod" ? " mod " : " mod ", { style: "p", cls: "bin" })); return undefined;
      case "pod": items.push({ k: "delim", open: "(", close: ")", body: [this.arg()] }); return undefined;
      case "mathbin": case "mathrel": case "mathord": case "mathpunct": case "mathopen": case "mathclose": case "mathinner":
        items.push(this.arg()); return undefined;
      case "substack": {
        e.skipSpacesExpanded();
        const open = e.next();
        if (!open || !isBeginGroup(open)) { if (open) e.pushBackOne(open); return undefined; }
        const rows: MathNode[][] = [];
        for (;;) {
          const r = this.parseList({ group: true, cells: true });
          rows.push([row(r.items)]);
          if (r.end.kind !== "cr") break;
        }
        items.push({ k: "matrix", rows });
        return undefined;
      }
      case "intertext": case "shortintertext": {
        items.push(atom(this.hooks.text(e.readUndelimited(t) ?? []), { normal: true }));
        return undefined;
      }
      case "ensuremath": items.push(this.arg()); return undefined;
      case "hline": case "cline": case "hdashline": case "midrule": case "toprule": case "bottomrule": {
        if (name === "cline") e.readUndelimited(t);
        return undefined;
      }
      case "dots": case "ldots": case "cdots": case "dotsc": case "dotsb": case "dotsm": case "dotsi": case "dotso":
        items.push(atom(SYMBOLS[name][0], { cls: "ord" })); return undefined;
    }

    if (NARY[name]) {
      const [op, limits] = NARY[name];
      items.push({ k: "nary", op, body: EMPTY(), limits: this.display && limits });
      return undefined;
    }
    if (FUNCTIONS[name] !== undefined) {
      this.pushFunc(items, atom(FUNCTION_TEXT[name] ?? name, { style: "p", cls: "op" }), FUNCTIONS[name]);
      return undefined;
    }
    if (ACCENTS[name]) { items.push({ k: "acc", chr: ACCENTS[name], body: this.arg() }); return undefined; }
    if (SYMBOLS[name]) {
      const [ch, cls] = SYMBOLS[name];
      items.push(atom(ch, { cls }));
      return undefined;
    }
    if (MATRIX_ENVS[name] !== undefined) return undefined;

    // Unknown: keep the name visible and digest brace arguments so no content is lost.
    e.diag.warn("W013", `unknown math command \\${t.name}`, t, "define it with \\newcommand or \\DeclareMathOperator", t.name.length + 1);
    items.push(atom(t.name, { style: "p" }));
    for (;;) {
      const u = e.peekRaw();
      if (!u || !isBeginGroup(u)) break;
      items.push(this.arg());
    }
    return undefined;
  }

  private pushFunc(items: MathNode[], name: MathNode, limits: boolean): void {
    const f: MathNode = { k: "func", name, body: EMPTY() };
    this.pendingFuncs.set(f, { limits });
    items.push(f);
  }

  // ------------------------------------------------------------------ environments inside math

  private environment(env: string, from: Loc): MathNode {
    const e = this.e;
    if (MATRIX_ENVS[env] !== undefined || env === "cases" || env === "dcases" || env === "rcases" || env === "cases*") {
      let align: ("l" | "c" | "r")[] | undefined;
      if (env === "array" || env === "subarray") {
        e.readOptional();
        const spec = tokensToString(e.readUndelimited(from) ?? []);
        align = [...spec.replace(/\{[^}]*\}/g, "").replace(/[^lcr]/g, "")] as ("l" | "c" | "r")[];
      } else if (env.endsWith("*") && env !== "cases*") {
        const o = e.readOptional();
        if (o) align = Array(16).fill(tokensToString(o).trim() || "c");
      }
      if (env.startsWith("cases") || env === "dcases") align = ["l", "l"];
      if (env === "rcases") align = ["l", "l"];
      const rows = this.parseRows(env, true);
      const m: MathNode = { k: "matrix", rows: rows.map(r => r.cells), align };
      if (env === "cases" || env === "dcases" || env === "cases*") return { k: "delim", open: "{", close: "", body: [m] };
      if (env === "rcases") return { k: "delim", open: "", close: "}", body: [m] };
      const d = MATRIX_ENVS[env];
      return d ? { k: "delim", open: d[0], close: d[1], body: [m] } : m;
    }
    if (ALIGNED_ENVS.has(env)) {
      if (env === "alignedat" || env === "alignat" || env === "alignat*") e.readUndelimited(from);
      if (env === "aligned" || env === "gathered" || env === "alignedat") e.readOptional();
      const rows = this.parseRows(env, true);
      const gather = env.startsWith("gather") || env.startsWith("multline");
      return { k: "eqArr", rows: rows.map(r => (gather ? row(r.cells) : MathParser.alignRow(r.cells))) };
    }
    // Unknown environment: parse its body as plain math.
    e.diag.warn("W011", `unknown math environment ${env}`, from);
    const r = this.parseList({ env });
    return row(r.items);
  }
}

function attach(base: MathNode, kind: "sup" | "sub", arg: MathNode): MathNode {
  if (base.k === "sup" && kind === "sub") return { k: "subsup", base: base.base, sub: arg, sup: base.sup };
  if (base.k === "sub" && kind === "sup") return { k: "subsup", base: base.base, sub: base.sub, sup: arg };
  return kind === "sup" ? { k: "sup", base, sup: arg } : { k: "sub", base, sub: arg };
}

/** Items that end the body of a large operator: relations, binary operators, punctuation. */
function isBreak(n: MathNode): boolean {
  return n.k === "atom" && (n.cls === "rel" || n.cls === "bin" || n.cls === "punct") && !n.aln;
}

export { isEndGroup };
