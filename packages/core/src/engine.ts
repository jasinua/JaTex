// The "gullet": input stack, meanings, macro expansion, argument reading, numbers and dimensions.
// Unexpandable tokens are handed to the consumer (the digester), which executes commands.

import type { ArgSpec, Arg } from "./argspec.ts";
import { Diagnostics } from "./diagnostics.ts";
import { Lexer } from "./lexer.ts";
import { SourceMap } from "./source.ts";
import { State, type GroupKind } from "./state.ts";
import {
  Cat, charTok, csTok, defaultCat, fenceTok, isBeginGroup, isChar, isCs, isEndGroup, isFence, isSpace, meaningKey, sameToken,
  stringToTokens, type CharToken, type CsToken, type Loc, type Token,
} from "./tokens.ts";

export type Meaning =
  /** \def-style macro: prefix delimiter, per-parameter delimiters ([] = undelimited), body with ParamTokens. */
  | { type: "macro"; name: string; prefix: Token[]; params: Token[][]; braceDelim: boolean; body: Token[]; protected?: boolean }
  /** \newcommand / \NewDocumentCommand macro with xparse-style arguments. */
  | { type: "latex"; name: string; spec: ArgSpec[]; body: Token[]; protected?: boolean }
  /** Expandable primitive implemented in TypeScript. */
  | { type: "expandable"; name: string; isIf?: boolean }
  /** Unexpandable command executed by the consumer (core command or digester handler). */
  | { type: "command"; name: string }
  /** A character meaning, from \let\x=a or \let\bgroup={. */
  | { type: "char"; ch: string; cat: Cat }
  | { type: "register"; reg: "count" | "dimen" | "skip" | "toks"; key: string }
  | { type: "chardef"; value: number; math?: boolean };

export type Expandable = (e: Engine, tok: CsToken) => void;
export type CoreCommand = (e: Engine, tok: CsToken, prefixes: Prefixes) => void;
export interface Prefixes { global: boolean; protected: boolean; long: boolean }

export class BudgetError extends Error {
  readonly macroStack: string[];
  constructor(message: string, macroStack: string[]) {
    super(message);
    this.macroStack = macroStack;
  }
}

export interface FileRequest {
  path: string;
  /** Extensions to try when the name has none, in order; "" allows the bare name. */
  extensions: string[];
  from: Loc;
  command: string;
  /** Read bytes (images) instead of UTF-8 text. */
  binary?: boolean;
  /** Folders to search, relative to the project root (\graphicspath). */
  searchPaths?: string[];
}
export type FileResult = { name: string; text: string; data?: Uint8Array } | { error: "denied" | "not-found"; message: string };

export interface EngineOptions {
  maxSteps?: number;
  maxDepth?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Sandboxed file access; without it, \input and friends fail with a diagnostic. */
  readFile?: (req: FileRequest) => FileResult;
  jobname?: string;
}

type Source =
  | { kind: "lexer"; lexer: Lexer }
  | { kind: "tokens"; toks: Token[]; i: number; macro?: string };

const SP = 65536;

export class Engine {
  readonly state = new State();
  readonly diag = new Diagnostics();
  readonly sources = new SourceMap();
  readonly expandables = new Map<string, Expandable>();
  readonly commands = new Map<string, CoreCommand>();
  /** Hooks the consumer provides for \ifvmode etc. */
  modeQuery: () => "vertical" | "horizontal" | "math" = () => "vertical";
  readonly opts: Required<Omit<EngineOptions, "readFile">> & Pick<EngineOptions, "readFile">;

  private inputs: Source[] = [];
  private steps = 0;
  private tokensPushed = 0;
  private deadline = 0;
  /** Conditional stack: each entry is the kind of construct whose true branch we are inside. */
  condStack: ("if" | "case")[] = [];

  constructor(opts: EngineOptions = {}) {
    this.opts = {
      maxSteps: opts.maxSteps ?? 5_000_000,
      maxDepth: opts.maxDepth ?? 10_000,
      maxTokens: opts.maxTokens ?? 50_000_000,
      timeoutMs: opts.timeoutMs ?? 60_000,
      jobname: opts.jobname ?? "texput",
      readFile: opts.readFile,
    };
    this.deadline = Date.now() + this.opts.timeoutMs;
  }

  // ---------------------------------------------------------------- catcodes and meanings

  catcode(cp: number): Cat {
    return this.state.get<Cat>("cat:" + cp) ?? defaultCat(cp);
  }
  setCatcode(ch: string, cat: Cat, global = false): void {
    this.state.set("cat:" + ch.codePointAt(0)!, cat, global);
  }

  meaning(t: Token): Meaning | undefined {
    if (t.kind === "char") return { type: "char", ch: t.ch, cat: t.cat };
    if (t.kind === "param") return undefined;
    return this.state.get<Meaning>("cs:" + meaningKey(t));
  }
  meaningOf(name: string): Meaning | undefined { return this.state.get<Meaning>("cs:" + name); }

  define(name: string | CsToken, m: Meaning | undefined, global = false): void {
    const key = typeof name === "string" ? name : meaningKey(name);
    this.state.set("cs:" + key, m, global);
  }

  isDefined(name: string): boolean { return this.meaningOf(name) !== undefined; }

  /** Registers an expandable primitive. */
  primitive(name: string, fn: Expandable, isIf = false): void {
    this.expandables.set(name, fn);
    this.define(name, { type: "expandable", name, isIf }, true);
  }
  /** Registers an unexpandable core command (e.g. \def). */
  command(name: string, fn: CoreCommand): void {
    this.commands.set(name, fn);
    this.define(name, { type: "command", name }, true);
  }

  isExpandable(m: Meaning | undefined): boolean {
    return !!m && (m.type === "macro" || m.type === "latex" || m.type === "expandable");
  }

  // ---------------------------------------------------------------- groups

  beginGroup(kind: GroupKind, name?: string): void { this.state.beginGroup(kind, name); }
  endGroup(expect: GroupKind, loc?: Loc): void {
    const g = this.state.currentGroup();
    if (!g) { this.diag.error("E006", "extra group end ignored", loc); return; }
    if (g.kind !== expect && !(expect === "brace" && g.kind === "internal")) {
      const what = (k: GroupKind) => (k === "brace" ? "}" : k === "semi" ? "\\endgroup" : k === "env" ? "\\end" : k === "math" ? "end of math" : "internal group end");
      this.diag.error("E006", `${what(expect)} closes a group opened by ${g.kind === "env" ? `\\begin{${g.name}}` : g.kind === "semi" ? "\\begingroup" : g.kind === "brace" ? "{" : g.kind}`, loc);
    }
    this.state.endGroup();
  }

  // ---------------------------------------------------------------- input

  /** Starts reading a file. Its tokens come before anything already pending. */
  pushFile(name: string, text: string): number {
    const file = this.sources.add(name, text);
    const src = this.sources.get(file)!.text;
    this.dropExhausted();
    this.inputs.push({ kind: "lexer", lexer: new Lexer(file, src, cp => this.catcode(cp), {
      invalidChar: (pos, ch) => this.diag.error("E001", `invalid character U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`, { file, pos }),
    }) });
    if (this.inputs.length > this.opts.maxDepth) throw new BudgetError("input nesting too deep", this.macroStack());
    return file;
  }

  private dropExhausted(): void {
    while (this.inputs.length) {
      const top = this.inputs[this.inputs.length - 1];
      if (top.kind === "tokens" && top.i >= top.toks.length) this.inputs.pop();
      else break;
    }
  }

  /** Pushes tokens so they are read next (before the rest of the input). */
  pushBack(toks: Token[], macro?: string): void {
    if (!toks.length) return;
    this.dropExhausted();
    this.inputs.push({ kind: "tokens", toks, i: 0, macro });
    this.tokensPushed += toks.length;
    const where = macro ? ` in \\${macro}` : "";
    if (this.inputs.length > this.opts.maxDepth)
      throw new BudgetError(`expansion depth exceeded ${this.opts.maxDepth}${where} (runaway recursion?)`, this.macroStack());
    if (this.tokensPushed > this.opts.maxTokens)
      throw new BudgetError(`expansion produced more than ${this.opts.maxTokens} tokens${where}`, this.macroStack());
  }
  pushBackOne(t: Token): void {
    const top = this.inputs[this.inputs.length - 1];
    if (top && top.kind === "tokens" && top.i > 0 && top.toks[top.i - 1] === t) { top.i--; return; }
    this.pushBack([t]);
  }

  /**
   * Next token without expansion, or null at end of input. A fence also reads as end of input and
   * stays in place: nothing but its owner (via takeFence) can consume it, so a command that reads
   * past the end of a digested argument stops there instead of swallowing the rest of the document.
   */
  nextRaw(): Token | null {
    while (this.inputs.length) {
      const top = this.inputs[this.inputs.length - 1];
      if (top.kind === "tokens") {
        if (top.i < top.toks.length) {
          const t = top.toks[top.i];
          if (t.kind === "cs" && isFence(t)) return null;
          top.i++;
          return t;
        }
        this.inputs.pop();
        continue;
      }
      const t = top.lexer.next();
      if (t) return t;
      this.inputs.pop();
    }
    return null;
  }

  private fenceCount = 0;
  /** A new fence token for marking the end of a token list being processed. */
  newFence(): CsToken { return fenceTok(this.fenceCount++); }

  /** Consumes `f` if it is the next raw token. */
  takeFence(f: CsToken): boolean {
    this.dropExhausted();
    const top = this.inputs[this.inputs.length - 1];
    if (top && top.kind === "tokens" && top.toks[top.i] === f) { top.i++; return true; }
    return false;
  }

  /** Skips everything up to and including fence `f` (error recovery). */
  discardToFence(f: CsToken): void {
    for (;;) {
      if (this.takeFence(f)) return;
      this.dropExhausted();
      const top = this.inputs[this.inputs.length - 1];
      if (!top) return;
      if (top.kind === "tokens" && top.i < top.toks.length && isFence(top.toks[top.i])) {
        // Another fence sits on top of ours: it belongs to an abandoned inner list.
        top.i++;
        continue;
      }
      if (this.nextRaw() === null && !this.inputs.length) return;
    }
  }

  peekRaw(): Token | null {
    const t = this.nextRaw();
    if (t) this.pushBackOne(t);
    return t;
  }

  /** The lexer currently being read, when no pending tokens sit in front of it. */
  currentLexer(): Lexer | undefined {
    this.dropExhausted();
    const top = this.inputs[this.inputs.length - 1];
    return top && top.kind === "lexer" ? top.lexer : undefined;
  }

  macroStack(): string[] {
    return this.inputs.filter(s => s.kind === "tokens" && s.macro).map(s => "\\" + (s as { macro: string }).macro).reverse().slice(0, 12);
  }

  private tick(name: string): void {
    if (++this.steps > this.opts.maxSteps)
      throw new BudgetError(`expansion budget of ${this.opts.maxSteps} steps exhausted in \\${name}`, this.macroStack());
    if ((this.steps & 4095) === 0 && Date.now() > this.deadline)
      throw new BudgetError(`time budget of ${this.opts.timeoutMs} ms exhausted`, this.macroStack());
  }

  // ---------------------------------------------------------------- expansion

  /** Next unexpandable token, expanding macros and expandable primitives on the way. */
  next(): Token | null {
    for (;;) {
      const t = this.nextRaw();
      if (!t) return null;
      if (t.kind !== "cs" || t.noexpand) return t;
      const m = this.meaning(t);
      if (!this.isExpandable(m)) return t;
      this.expand(t, m!);
    }
  }

  /** Expands one expandable token once. */
  expand(t: CsToken, m: Meaning): void {
    this.tick(t.name);
    switch (m.type) {
      case "macro": this.expandMacro(t, m); break;
      case "latex": this.expandLatex(t, m); break;
      case "expandable": this.expandables.get(m.name)!(this, t); break;
      default: break;
    }
  }

  private expandMacro(t: CsToken, m: Extract<Meaning, { type: "macro" }>): void {
    // Match the prefix delimiter exactly.
    for (const d of m.prefix) {
      const u = this.nextRaw();
      if (!u || !sameToken(u, d)) {
        this.diag.error("E002", `use of \\${t.name} doesn't match its definition`, t);
        if (u) this.pushBackOne(u);
        return;
      }
    }
    const args: Token[][] = [];
    for (let i = 0; i < m.params.length; i++) {
      const delim = m.params[i];
      if (delim.length) args.push(this.readDelimited(delim, t));
      else if (i === m.params.length - 1 && m.braceDelim) args.push(this.readUntilBrace(t));
      else args.push(this.readUndelimited(t) ?? []);
    }
    const body = substitute(m.body, args);
    this.pushBack(body, t.name);
  }

  private expandLatex(t: CsToken, m: Extract<Meaning, { type: "latex" }>): void {
    const args = this.readArgs(m.spec, t);
    const vals = args.map((a, i) => {
      const s = m.spec[i];
      if (s.t === "s" || s.t === "t") return [csTok(a.present ? "BooleanTrue" : "BooleanFalse", t)];
      if (s.t === "v") return stringToTokens(a.text ?? "", t);
      if (!a.present) return (s as { default?: Token[] }).default ?? [csTok("\u0000NoValue", t)];
      return a.tokens;
    });
    this.pushBack(substitute(m.body, vals), t.name);
  }

  /** Fully expands a token list as \edef does; protected macros and \noexpand'ed tokens stay. */
  expandFully(toks: Token[]): Token[] {
    const out: Token[] = [];
    const END = this.newFence();
    this.pushBack([...toks, END]);
    for (;;) {
      const t = this.nextRaw();
      if (!t) { this.discardToFence(END); break; }
      if (t.kind !== "cs") { out.push(t); continue; }
      if (t.noexpand) { out.push({ ...t, noexpand: undefined }); continue; }
      const m = this.meaning(t);
      if (!this.isExpandable(m) || (m as { protected?: boolean }).protected) { out.push(t); continue; }
      if (m!.type === "expandable" && m!.name === "the") { out.push(...this.theTokens(t)); continue; }
      if (m!.type === "expandable" && m!.name === "unexpanded") { out.push(...this.readGeneralText(t)); continue; }
      if (m!.type === "expandable" && m!.name === "noexpand") {
        const u = this.nextRaw();
        if (u) out.push(u.kind === "cs" ? { ...u, noexpand: undefined } : u);
        continue;
      }
      this.expand(t, m!);
    }
    return out;
  }

  // ---------------------------------------------------------------- argument reading (unexpanded)

  skipSpacesRaw(): void {
    for (;;) {
      const t = this.nextRaw();
      if (!t) return;
      if (!isSpace(t)) { this.pushBackOne(t); return; }
    }
  }

  /** Skips spaces and \relax-free space tokens with expansion (used before numbers, keywords). */
  skipSpacesExpanded(): void {
    for (;;) {
      const t = this.next();
      if (!t) return;
      if (!isSpace(t)) { this.pushBackOne(t); return; }
    }
  }

  /** After `{` was consumed: tokens up to the matching `}` (consumed, not included). */
  readGroupBody(from?: Loc): Token[] {
    const out: Token[] = [];
    let depth = 0;
    for (;;) {
      const t = this.nextRaw();
      if (!t) { this.diag.error("E002", "runaway argument: end of input inside a group", from); return out; }
      if (isBeginGroup(t)) depth++;
      else if (isEndGroup(t)) { if (depth === 0) return out; depth--; }
      out.push(t);
    }
  }

  /** One undelimited argument: a single token or a braced group (braces stripped). */
  readUndelimited(from?: Loc): Token[] | null {
    this.skipSpacesRaw();
    const t = this.nextRaw();
    if (!t) { this.diag.error("E002", "missing argument at end of input", from); return null; }
    if (isBeginGroup(t)) return this.readGroupBody(t);
    if (isEndGroup(t)) {
      this.diag.error("E002", "argument expected but found }", t);
      this.pushBackOne(t);
      return [];
    }
    return [t];
  }

  private readUntilBrace(from?: Loc): Token[] {
    const out: Token[] = [];
    for (;;) {
      const t = this.nextRaw();
      if (!t) { this.diag.error("E002", "runaway argument", from); return out; }
      if (isBeginGroup(t)) { this.pushBackOne(t); return out; }
      if (isEndGroup(t)) { this.diag.error("E002", "unexpected } in argument", t); this.pushBackOne(t); return out; }
      out.push(t);
    }
  }

  /** Argument delimited by `delim` at brace depth 0; a sole braced group loses its braces. */
  readDelimited(delim: Token[], from?: Loc): Token[] {
    const out: Token[] = [];
    const grouped: boolean[] = [];
    for (;;) {
      const t = this.nextRaw();
      if (!t) { this.diag.error("E002", "runaway argument: delimiter never found", from); break; }
      if (isEndGroup(t)) { this.diag.error("E002", "unexpected } while looking for a delimiter", t); this.pushBackOne(t); break; }
      if (isBeginGroup(t)) {
        const body = this.readGroupBody(t);
        out.push(t, ...body, charTok("}", Cat.EndGroup, t));
        for (let i = 0; i < body.length + 2; i++) grouped.push(true);
        continue;
      }
      out.push(t);
      grouped.push(false);
      const n = delim.length;
      if (out.length >= n) {
        let ok = true;
        for (let k = 0; k < n; k++) {
          const j = out.length - n + k;
          if (grouped[j] || !sameToken(out[j], delim[k])) { ok = false; break; }
        }
        if (ok) { out.length -= n; break; }
      }
    }
    if (out.length >= 2 && isBeginGroup(out[0]) && isEndGroup(out[out.length - 1])) {
      // Strip braces only if they enclose the whole argument.
      let depth = 0, whole = true;
      for (let i = 0; i < out.length; i++) {
        if (isBeginGroup(out[i])) depth++;
        else if (isEndGroup(out[i])) { depth--; if (depth === 0 && i < out.length - 1) { whole = false; break; } }
      }
      if (whole) return out.slice(1, -1);
    }
    return out;
  }

  /** Optional argument in `open`…`close` (default brackets); null when absent. */
  readOptional(open = "[", close = "]", skipSpaces = true): Token[] | null {
    if (skipSpaces) this.skipSpacesRaw();
    const t = this.nextRaw();
    if (!t) return null;
    if (t.kind !== "char" || t.ch !== open || t.cat === Cat.BeginGroup) { this.pushBackOne(t); return null; }
    const out: Token[] = [];
    let depth = 0, nest = 0;
    for (;;) {
      const u = this.nextRaw();
      if (!u) { this.diag.error("E002", `runaway optional argument (missing ${close})`, t); return out; }
      if (isBeginGroup(u)) depth++;
      else if (isEndGroup(u)) depth--;
      else if (depth === 0 && isChar(u, undefined, open) && open !== close) nest++;
      else if (depth === 0 && isChar(u, undefined, close)) { if (nest === 0) break; nest--; }
      out.push(u);
    }
    // A sole braced group protects brackets inside optional arguments: [{a]b}] → a]b
    if (out.length >= 2 && isBeginGroup(out[0]) && isEndGroup(out[out.length - 1])) {
      let d = 0, whole = true;
      for (let i = 0; i < out.length; i++) {
        if (isBeginGroup(out[i])) d++;
        else if (isEndGroup(out[i])) { d--; if (d === 0 && i < out.length - 1) { whole = false; break; } }
      }
      if (whole) return out.slice(1, -1);
    }
    return out;
  }

  /** Consumes a following `ch` (after optional spaces) and reports whether it was there. */
  readFlag(ch: string): boolean {
    this.skipSpacesRaw();
    const t = this.nextRaw();
    if (t && t.kind === "char" && t.ch === ch && t.cat !== Cat.BeginGroup && t.cat !== Cat.EndGroup) return true;
    if (t) this.pushBackOne(t);
    return false;
  }

  /** Verbatim argument: delimiter char or braces, read from the source text without tokenizing. */
  readVerbatimArg(from?: Loc): string {
    const lx = this.currentLexer();
    if (!lx) {
      // Already tokenized (inside a macro argument): fall back to the token text.
      const toks = this.readUndelimited(from) ?? [];
      return toks.map(t => (t.kind === "char" ? t.ch : t.kind === "cs" ? (t.active ? t.name : "\\" + t.name) : "")).join("");
    }
    let open = lx.readRawChar();
    while (open === " ") open = lx.readRawChar();
    if (open === undefined) return "";
    if (open === "{") {
      let depth = 0, s = "";
      for (;;) {
        const c = lx.readRawChar();
        if (c === undefined) { this.diag.error("E002", "runaway verbatim argument", from); return s; }
        if (c === "{") depth++;
        if (c === "}") { if (depth === 0) return s; depth--; }
        s += c;
      }
    }
    let s = "";
    for (;;) {
      const c = lx.readRawChar();
      if (c === undefined || c === "\n") { this.diag.error("E002", `verbatim argument not closed by ${open}`, from); return s; }
      if (c === open) return s;
      s += c;
    }
  }

  /** Reads arguments per an xparse-style spec. `b` (environment body) is handled by the consumer. */
  readArgs(spec: ArgSpec[], from?: Loc): Arg[] {
    const out: Arg[] = [];
    for (const s of spec) {
      switch (s.t) {
        case "m": { const toks = this.readUndelimited(from); out.push({ present: toks !== null, tokens: toks ?? [] }); break; }
        case "o": { const toks = this.readOptional(); out.push({ present: toks !== null, tokens: toks ?? s.default ?? [] }); break; }
        case "s": out.push({ present: this.readFlag("*"), tokens: [] }); break;
        case "t": out.push({ present: this.readFlag(s.ch), tokens: [] }); break;
        case "d": { const toks = this.readOptional(s.open, s.close); out.push({ present: toks !== null, tokens: toks ?? s.default ?? [] }); break; }
        case "r": {
          const toks = this.readOptional(s.open, s.close);
          if (toks === null) this.diag.error("E002", `missing required argument ${s.open}…${s.close}`, from);
          out.push({ present: toks !== null, tokens: toks ?? s.default ?? [] });
          break;
        }
        case "v": { const text = this.readVerbatimArg(from); out.push({ present: true, tokens: [], text }); break; }
        case "e": {
          for (;;) {
            this.skipSpacesRaw();
            const t = this.nextRaw();
            if (t && t.kind === "char" && s.chars.includes(t.ch)) { out.push({ present: true, tokens: this.readUndelimited(from) ?? [] }); continue; }
            if (t) this.pushBackOne(t);
            break;
          }
          break;
        }
        case "b": out.push({ present: false, tokens: [] }); break;
      }
    }
    return out;
  }

  /** `{…}` read with expansion until the opening brace (as \uppercase, \unexpanded, \detokenize do). */
  readGeneralText(from?: Loc): Token[] {
    for (;;) {
      const t = this.next();
      if (!t) return [];
      if (isSpace(t) || isCs(t, "relax")) continue;
      if (isBeginGroup(t)) return this.readGroupBody(t);
      this.diag.error("E002", "missing { inserted", from);
      this.pushBackOne(t);
      return [];
    }
  }

  // ---------------------------------------------------------------- numbers, dimensions, registers

  register(reg: "count" | "dimen" | "skip" | "toks", key: string): number | Token[] {
    const v = this.state.get<number | Token[]>(`${reg}:${key}`);
    return v ?? (reg === "toks" ? [] : 0);
  }
  setRegister(reg: "count" | "dimen" | "skip" | "toks", key: string, v: number | Token[], global = false): void {
    this.state.set(`${reg}:${key}`, v, global);
  }

  /** Reads an optional `=` and spaces, as assignments do. */
  readEquals(): void {
    this.skipSpacesExpanded();
    const t = this.next();
    if (t && !(isChar(t, Cat.Other, "="))) this.pushBackOne(t);
    else this.skipSpacesExpanded();
  }

  /** TeX's ⟨number⟩: optional signs, then digits/'octal/"hex/`char, or an internal integer. */
  readNumber(from?: Loc): number {
    let sign = 1;
    for (;;) {
      this.skipSpacesExpanded();
      const t = this.next();
      if (t && isChar(t, Cat.Other, "-")) { sign = -sign; continue; }
      if (t && isChar(t, Cat.Other, "+")) continue;
      if (!t) { this.diag.error("E009", "missing number, treated as zero", from); return 0; }
      return sign * this.readUnsigned(t, from);
    }
  }

  private readUnsigned(t: Token, from?: Loc): number {
    const digitsOf = (radix: number, first?: string): number => {
      let s = first ?? "";
      const re = radix === 10 ? /[0-9]/ : radix === 8 ? /[0-7]/ : /[0-9A-F]/;
      for (;;) {
        const u = this.next();
        if (u && u.kind === "char" && (u.cat === Cat.Other || (radix === 16 && u.cat === Cat.Letter)) && re.test(u.ch)) { s += u.ch; continue; }
        if (u && !isSpace(u)) this.pushBackOne(u);       // one optional space ends the number
        break;
      }
      return s ? parseInt(s, radix) : 0;
    };
    if (t.kind === "char") {
      if (t.cat === Cat.Other && /[0-9]/.test(t.ch)) return digitsOf(10, t.ch);
      if (isChar(t, Cat.Other, "'")) return digitsOf(8);
      if (isChar(t, Cat.Other, "\"")) return digitsOf(16);
      if (isChar(t, Cat.Other, "`")) {
        const c = this.nextRaw();
        const n = c ? (c.kind === "char" ? c.ch.codePointAt(0)! : c.kind === "cs" ? (c.name.codePointAt(0) ?? 0) : 0) : 0;
        const sp = this.next();
        if (sp && !isSpace(sp)) this.pushBackOne(sp);
        return n;
      }
    }
    if (t.kind === "cs") {
      const v = this.internalValue(t);
      if (v !== undefined) return Math.trunc(v.kind === "dimen" ? v.value : v.value);
    }
    this.diag.error("E009", "missing number, treated as zero", t.kind === "param" ? from : t);
    this.pushBackOne(t);
    return 0;
  }

  /** Value of an internal quantity token (register, \count5, \catcode…, chardef). */
  internalValue(t: CsToken): { kind: "int" | "dimen"; value: number } | undefined {
    const m = this.meaning(t);
    if (!m) return undefined;
    if (m.type === "register") {
      if (m.reg === "toks") return undefined;
      return { kind: m.reg === "count" ? "int" : "dimen", value: this.register(m.reg, m.key) as number };
    }
    if (m.type === "chardef") return { kind: "int", value: m.value };
    if (m.type === "command") {
      switch (m.name) {
        case "count": return { kind: "int", value: this.register("count", String(this.readNumber(t))) as number };
        case "dimen": return { kind: "dimen", value: this.register("dimen", String(this.readNumber(t))) as number };
        case "skip": return { kind: "dimen", value: this.register("skip", String(this.readNumber(t))) as number };
        case "catcode": return { kind: "int", value: this.catcode(this.readNumber(t)) };
        case "lastpenalty": case "inputlineno": return { kind: "int", value: 0 };
      }
    }
    return undefined;
  }

  /** Reads a keyword such as "pt" or "plus" (case-insensitive), with expansion; restores on mismatch. */
  readKeyword(word: string): boolean {
    this.skipSpacesExpanded();
    const seen: Token[] = [];
    for (const ch of word) {
      const t = this.next();
      if (!t) break;
      seen.push(t);
      if (!(t.kind === "char" && t.ch.toLowerCase() === ch)) {
        for (let i = seen.length - 1; i >= 0; i--) this.pushBack([seen[i]]);
        return false;
      }
    }
    if (seen.length < word.length) { for (let i = seen.length - 1; i >= 0; i--) this.pushBack([seen[i]]); return false; }
    return true;
  }

  /** Font-relative units resolve against this size (points); the consumer keeps it current. */
  emPt = 10;

  /** TeX's ⟨dimen⟩ in scaled points. */
  readDimen(from?: Loc, mu = false): number {
    let sign = 1;
    let t: Token | null;
    for (;;) {
      this.skipSpacesExpanded();
      t = this.next();
      if (t && isChar(t, Cat.Other, "-")) { sign = -sign; continue; }
      if (t && isChar(t, Cat.Other, "+")) continue;
      break;
    }
    if (!t) { this.diag.error("E009", "missing dimension, treated as zero", from); return 0; }
    // Internal dimension: \parindent, \dimen3 …
    if (t.kind === "cs") {
      const v = this.internalValue(t);
      if (v && v.kind === "dimen") return sign * v.value;
      if (v && v.kind === "int") return sign * this.readUnit(v.value, from, mu);
      this.diag.error("E009", "missing dimension, treated as zero", t);
      this.pushBackOne(t);
      return 0;
    }
    // Decimal factor.
    let s = "";
    if (t.kind === "char" && (/[0-9]/.test(t.ch) || t.ch === "." || t.ch === ",") && t.cat === Cat.Other) {
      s = t.ch === "," ? "." : t.ch;
      for (;;) {
        const u = this.next();
        if (u && u.kind === "char" && u.cat === Cat.Other && (/[0-9]/.test(u.ch) || ((u.ch === "." || u.ch === ",") && !s.includes(".")))) { s += u.ch === "," ? "." : u.ch; continue; }
        if (u) this.pushBackOne(u);
        break;
      }
    } else {
      this.pushBackOne(t);
      const n = this.readNumber(from);
      return sign * this.readUnit(n, from, mu);
    }
    return sign * this.readUnit(parseFloat(s || "0"), from, mu);
  }

  private readUnit(factor: number, from?: Loc, mu = false): number {
    this.skipSpacesExpanded();
    const t = this.next();
    if (t && t.kind === "cs") {
      const v = this.internalValue(t);
      if (v && v.kind === "dimen") return Math.round(factor * v.value);
      this.pushBackOne(t);
    } else if (t) this.pushBackOne(t);
    this.readKeyword("true");
    const units: [string, number][] = [
      ["pt", SP], ["bp", SP * 72.27 / 72], ["in", SP * 72.27], ["cm", SP * 72.27 / 2.54], ["mm", SP * 72.27 / 25.4],
      ["pc", SP * 12], ["dd", SP * 1238 / 1157], ["cc", SP * 12 * 1238 / 1157], ["sp", 1],
      ["em", SP * this.emPt], ["ex", SP * this.emPt * 0.43], ["mu", SP * this.emPt / 18], ["px", SP * 72.27 / 96],
    ];
    for (const [u, size] of units) {
      if (this.readKeyword(u)) {
        const sp = this.next();
        if (sp && !isSpace(sp)) this.pushBackOne(sp);
        return Math.round(factor * size);
      }
    }
    this.diag.error("E009", "illegal unit of measure (pt inserted)", from);
    return Math.round(factor * SP);
  }

  /** ⟨glue⟩: dimension plus optional stretch and shrink (stretch/shrink are read and dropped). */
  readGlue(from?: Loc): number {
    const d = this.readDimen(from);
    for (const kw of ["plus", "minus"]) {
      if (this.readKeyword(kw)) {
        this.skipSpacesExpanded();
        const save = this.next();
        if (save) this.pushBackOne(save);
        this.readDimenOrFil(from);
      }
    }
    return d;
  }

  private readDimenOrFil(from?: Loc): void {
    // "1fill", "2fil", "-1fil" or a dimension.
    const t = this.next();
    if (t) this.pushBackOne(t);
    const n = this.readNumberLike();
    if (this.readKeyword("fil")) { while (this.readKeyword("l")) { /* fill, filll */ } return; }
    this.pushBack(stringToTokens(String(n)));
    this.readDimen(from);
  }

  private readNumberLike(): number {
    let s = "";
    for (;;) {
      const u = this.next();
      if (u && u.kind === "char" && u.cat === Cat.Other && /[-+0-9.,]/.test(u.ch)) { s += u.ch === "," ? "." : u.ch; continue; }
      if (u) this.pushBackOne(u);
      break;
    }
    return parseFloat(s || "1");
  }

  /** Tokens produced by \the⟨internal quantity⟩. */
  theTokens(from: CsToken): Token[] {
    const t = this.next();
    if (!t || t.kind !== "cs") { this.diag.error("E009", "\\the needs an internal quantity", from); if (t) this.pushBackOne(t); return []; }
    const m = this.meaning(t);
    if (m && m.type === "register" && m.reg === "toks") return [...(this.register("toks", m.key) as Token[])];
    if (m && m.type === "command" && m.name === "toks") return [...(this.register("toks", String(this.readNumber(t))) as Token[])];
    const v = this.internalValue(t);
    if (!v) { this.diag.error("E009", `\\the cannot be applied to \\${t.name}`, t); return []; }
    return stringToTokens(v.kind === "int" ? String(v.value) : printScaled(v.value) + "pt", from);
  }

  // ---------------------------------------------------------------- files

  /** Reads a file through the sandbox and starts tokenizing it. Returns false on failure. */
  inputFile(path: string, from: Loc, command: string, extensions = [".tex"]): boolean {
    if (!this.opts.readFile) {
      this.diag.error("E004", `\\${command}{${path}}: file access is disabled`, from);
      return false;
    }
    const r = this.opts.readFile({ path, extensions, from, command });
    if ("error" in r) {
      this.diag.error(r.error === "denied" ? "E004" : "E005", r.message, from);
      return false;
    }
    this.pushFile(r.name, r.text);
    return true;
  }
}

/** Replaces ParamTokens with argument tokens. */
export function substitute(body: Token[], args: Token[][]): Token[] {
  let has = false;
  for (const t of body) if (t.kind === "param") { has = true; break; }
  if (!has) return body.slice();
  const out: Token[] = [];
  for (const t of body) {
    if (t.kind === "param") { const a = args[t.n - 1]; if (a) for (const x of a) out.push(x); }
    else out.push(t);
  }
  return out;
}

/** TeX's print_scaled: shortest decimal that reads back to the same scaled value. */
export function printScaled(sp: number): string {
  let out = "";
  let s = sp;
  if (s < 0) { out = "-"; s = -s; }
  out += Math.floor(s / SP);
  s = 10 * (s % SP) + 5;
  out += ".";
  let delta = 10;
  do {
    if (delta > SP) s = s + 0x8000 - 50000;
    out += Math.floor(s / SP);
    s = 10 * (s % SP);
    delta *= 10;
  } while (s > delta);
  return out;
}

export const spToPt = (sp: number): number => sp / SP;
export const ptToSp = (pt: number): number => Math.round(pt * SP);
export type { CharToken };
