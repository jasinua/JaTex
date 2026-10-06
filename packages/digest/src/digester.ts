// The "stomach": turns unexpandable tokens into the document model.
// TeX's modes become builder states: vertical = between blocks, horizontal = inside a paragraph,
// math = inside the math parser.

import {
  Cat, NO_PREFIX, assignRegister, csTok, isSpace, parseSpec, refStepCounter,
  theCounter, tokensToString, type Arg, type ArgSpec, type CsToken, type Engine, type Loc, type Token,
} from "@texdocx/core";
import { MathParser } from "@texdocx/math";
import {
  emptyDocument, pushText, sameMarks, trimInlines, type Align, type Block, type Document, type Inline,
  type ListItem, type Marks, type MathNode, type ParagraphRole, type Span,
} from "@texdocx/model";

export interface CommandHandler {
  /** xparse-style signature; arguments are read before `run` is called. */
  sig?: string;
  run(d: Digester, args: Arg[], t: CsToken): void;
  /** "inline" starts a paragraph in vertical mode; "block" ends the current paragraph first. */
  mode?: "inline" | "block";
}

export interface EnvHandler {
  sig?: string;
  begin(d: Digester, args: Arg[], t: CsToken): void;
  end?(d: Digester, t: CsToken): void;
  mode?: "inline" | "block";
  /** The handler consumes \end{name} itself (verbatim-like and math environments). */
  selfClosing?: boolean;
  /** Paragraphs after the environment continue without indentation unless a blank line follows. */
  display?: boolean;
}

export interface Container {
  kind: "body" | "item" | "footnote" | "inline" | "cell" | "float";
  blocks: Block[];
  para: Inline[] | null;
  indent: boolean;
  paraLoc?: Loc;
}

export interface ListState {
  block: Extract<Block, { kind: "list" }>;
  /** enumitem label used for \ref text (enumitem refs default to the label). */
  refLabel?: Token[];
  /** Key for enumitem's `resume`: environment name and level, and the options to repeat for `resume*`. */
  seriesKey?: string;
  seriesOpts?: object;
  depth: number;            // nesting of this list type (enumerate depth for enumerate)
  counter?: string;         // enumi … enumiv
  open: boolean;            // an item container is on the container stack
  containerDepth: number;   // container stack length when the list began
}

interface EnvFrame { name: string; handler?: EnvHandler; user?: boolean; loc: Loc; containerDepth: number }

export type TargetKind = "heading" | "number" | "item";
export interface LabelTarget { kind: TargetKind; claim(key: string): string }
interface LabelEntry { text: string; counter?: string; bookmark?: string; kind?: TargetKind; loc: Loc }

type RefInline = Extract<Inline, { kind: "ref" }>;

export interface DigestOptions {
  today?: Date;
}

const LIGATURES: Record<string, string> = { "--": "–", "–-": "—", "‘`": "“", "’'": "”", "!‘": "¡", "?‘": "¿" };

export class Digester {
  readonly e: Engine;
  readonly doc: Document = emptyDocument();
  readonly commands = new Map<string, CommandHandler & { spec: ArgSpec[] }>();
  readonly environments = new Map<string, EnvHandler & { spec: ArgSpec[] }>();
  readonly opts: DigestOptions;

  containers: Container[] = [];
  envStack: EnvFrame[] = [];
  lists: ListState[] = [];
  inDocument = false;
  stopped = false;
  afterHeading = false;
  noIndentNext = false;
  pendingSpaceBefore = 0;
  ligOk = false;
  readonly labels = new Map<string, LabelEntry>();
  readonly refs: { node: RefInline; loc: Loc; wrap?: [string, string] }[] = [];
  /**
   * What the next \label binds to (set alongside \refstepcounter): stores the key on the heading,
   * item or equation row unless it already has one, and returns the label that owns the bookmark.
   */
  get labelTarget(): LabelTarget | null { return this.e.state.get<LabelTarget>("@labeltarget") ?? null; }
  set labelTarget(t: LabelTarget | null) { this.e.state.set("@labeltarget", t ?? undefined, true); }
  readonly packages = new Set<string>();
  readonly warnedOnce = new Set<string>();
  atBeginDocument: Token[] = [];
  /** Run after the whole document is digested (page styles resolve fancyhdr settings here). */
  readonly finishers: (() => void)[] = [];
  pendingFootnoteMarks: Extract<Inline, { kind: "footnote" }>[] = [];

  constructor(e: Engine, opts: DigestOptions = {}) {
    this.e = e;
    this.opts = opts;
    this.containers.push({ kind: "body", blocks: this.doc.blocks, para: null, indent: true });
    e.modeQuery = () => (this.top.para !== null ? "horizontal" : "vertical");
  }

  // ------------------------------------------------------------------ registry

  def(name: string, h: CommandHandler): void {
    this.commands.set(name, { ...h, spec: parseSpec(h.sig ?? "") });
    this.e.define(name, { type: "command", name }, true);
  }
  env(name: string, h: EnvHandler): void {
    this.environments.set(name, { ...h, spec: parseSpec(h.sig ?? "") });
  }

  // ------------------------------------------------------------------ state

  get top(): Container { return this.containers[this.containers.length - 1]; }

  get marks(): Marks { return this.e.state.get<Marks>("marks") ?? {}; }
  setMarks(m: Marks): void { this.e.state.set("marks", m); }
  withMarks(f: (m: Marks) => Marks, body: () => void): void {
    this.e.beginGroup("internal");
    this.setMarks(f(this.marks));
    body();
    this.e.endGroup("internal");
  }

  span(loc: Loc, end?: number): Span {
    return { file: this.e.sources.get(loc.file)?.name ?? "", start: loc.pos, end: end ?? loc.pos };
  }

  warnOnce(key: string, code: string, message: string, loc?: Loc, hint?: string, length?: number): void {
    if (this.warnedOnce.has(key)) return;
    this.warnedOnce.add(key);
    this.e.diag.warn(code, message, loc, hint, length);
  }

  // ------------------------------------------------------------------ main loop

  run(): void {
    this.loop();
    this.closeParagraph();
    while (this.containers.length > 1) this.popContainer();
    for (const f of this.envStack.slice().reverse()) {
      if (f.name !== "document") this.e.diag.error("E006", `\\begin{${f.name}} was never closed`, f.loc);
    }
    if (!this.inDocument && !this.stopped) this.e.diag.error("E006", "no \\begin{document} found", undefined);
    // Finishers digest stored material (header content), so reading must be live again.
    this.stopped = false;
    for (const f of this.finishers) f();
    this.stopped = true;
    this.resolveRefs();
  }

  /** Processes tokens until the fence (or end of input / \end{document}). */
  private loop(fence?: CsToken): void {
    for (;;) {
      const t = this.e.next();
      if (!t) {
        if (fence) this.e.discardToFence(fence);
        return;
      }
      if (this.stopped) {
        if (!fence) return;
        continue;
      }
      this.step(t);
    }
  }

  /** Digests a token list in the current context; reading stops at its end even on malformed input. */
  digestTokens(toks: Token[]): void {
    const fence = this.e.newFence();
    this.e.pushBack([...toks, fence]);
    this.loop(fence);
  }

  step(t: Token): void {
    if (t.file >= 0) this.currentLoc = t;
    if (t.kind === "char") {
      if (t.cat !== Cat.Letter && t.cat !== Cat.Other) this.ligOk = false;
      this.char(t.ch, t.cat, t);
      return;
    }
    if (t.kind !== "cs") return;
    this.ligOk = false;
    const m = this.e.meaning(t);
    if (t.noexpand && this.e.isExpandable(m)) return;
    if (!m) { this.unknown(t); return; }
    switch (m.type) {
      case "char": this.char(m.ch, m.cat, t); return;
      case "chardef": if (!m.math) this.text(String.fromCodePoint(m.value)); return;
      case "register": assignRegister(this.e, t, m.reg, m.key, false); return;
      case "command": {
        const h = this.commands.get(m.name);
        if (h) { this.runCommand(h, t); return; }
        const core = this.e.commands.get(m.name);
        if (core) { core(this.e, t, NO_PREFIX); return; }
        if (this.mathOnly(m.name)) { this.inlineMathFromCommand(t); return; }
        this.unknown(t);
        return;
      }
      default:
        this.unknown(t);
    }
  }

  runCommand(h: CommandHandler & { spec: ArgSpec[] }, t: CsToken): void {
    if (h.mode === "block") this.closeParagraph();
    else if (h.mode === "inline") this.ensurePara();
    const args = h.spec.length ? this.e.readArgs(h.spec, t) : [];
    h.run(this, args, t);
  }

  private char(ch: string, cat: Cat, t: Loc): void {
    switch (cat) {
      case Cat.Letter: case Cat.Other: this.text(ch, t); return;
      case Cat.Space: this.space(); return;
      case Cat.BeginGroup: this.e.beginGroup("brace"); return;
      case Cat.EndGroup: this.e.endGroup("brace", t); return;
      case Cat.MathShift: this.mathShift(t); return;
      case Cat.AlignTab: this.alignTab(t); return;
      case Cat.Sup: case Cat.Sub:
        this.e.diag.error("E006", `missing $ inserted: ${ch} is only allowed in math`, t);
        this.text(ch, t);
        return;
      default: return;
    }
  }

  /** Set by the table handlers: `&` and `\\` inside a cell end the cell or row. */
  onAlignTab?: (t: Loc) => boolean;
  onRowEnd?: (t: Loc) => boolean;
  /** Lets a longtable put its \caption above the table instead of into a cell. */
  placeCaption?: (b: Block) => boolean;

  alignTab(t: Loc): void {
    if (this.onAlignTab?.(t)) return;
    this.e.diag.error("E006", "misplaced alignment tab character &", t);
  }

  // ------------------------------------------------------------------ paragraphs and text

  /** Location of the token being digested, for paragraph spans. */
  private currentLoc: Loc = { file: -1, pos: 0 };

  ensurePara(): Inline[] | null {
    if (!this.inDocument) return null;
    const c = this.top;
    if (c.para) return c.para;
    // Text after \begin{itemize} but before the first \item gets an implicit item.
    const L = this.lists[this.lists.length - 1];
    if (L && !L.open && L.containerDepth === this.containers.length) {
      this.e.diag.error("E006", "something's wrong: perhaps a missing \\item", undefined);
      this.startItem(undefined);
    }
    return this.startParagraph();
  }

  startParagraph(indent?: boolean): Inline[] {
    const c = this.top;
    c.para = [];
    c.paraLoc = this.currentLoc;
    c.indent = indent ?? !(this.afterHeading || this.noIndentNext);
    this.afterHeading = false;
    this.noIndentNext = false;
    return c.para;
  }

  text(ch: string, _loc?: Loc): void {
    const para = this.ensurePara();
    if (!para) {
      if (!this.inDocument && ch.trim()) this.warnOnce("preamble-text", "W001", "text before \\begin{document} is ignored", _loc);
      return;
    }
    const marks = this.marks;
    const last = para[para.length - 1];
    const mono = marks.family === "mono";
    if (this.ligOk && !mono && last && last.kind === "text" && sameMarks(last.marks, marks)) {
      const rep = LIGATURES[last.text.slice(-1) + (ch === "`" ? "‘" : ch === "'" ? "’" : ch)] ?? LIGATURES[last.text.slice(-1) + ch];
      if (rep) { last.text = last.text.slice(0, -1) + rep; return; }
    }
    pushText(para, mono ? ch : ch === "`" ? "‘" : ch === "'" ? "’" : ch, marks);
    this.ligOk = true;
  }

  /** Text that must not form ligatures (from \textendash, \&, …). */
  literal(s: string): void {
    const para = this.ensurePara();
    if (!para) return;
    pushText(para, s, this.marks);
    this.ligOk = false;
  }

  inline(n: Inline): void {
    const para = this.ensurePara();
    if (!para) return;
    para.push(n);
    this.ligOk = false;
  }

  space(): void {
    const c = this.top;
    if (!c.para) return;
    const last = c.para[c.para.length - 1];
    if (!last) { if (c.kind !== "inline") return; }
    if (last && last.kind === "text" && /[ \n]$/.test(last.text)) return;
    if (last && last.kind === "lineBreak") return;
    pushText(c.para, " ", this.marks);
  }

  par(): void {
    const c = this.top;
    if (c.kind === "inline") { this.space(); return; }
    if (c.para === null) { this.noIndentNext = false; return; }
    this.closeParagraph();
  }

  closeParagraph(): void {
    const c = this.top;
    if (c.kind === "inline" || c.para === null) return;
    const content = trimInlines(c.para);
    const indent = c.indent;
    c.para = null;
    if (!content.length) return;
    const role = this.e.state.get<ParagraphRole>("par:role") ?? (indent ? "body" : "firstParagraph");
    const align = this.e.state.get<Align>("par:align");
    const block: Block = { kind: "paragraph", role, align, content, span: this.span(c.paraLoc ?? { file: -1, pos: 0 }) };
    if (this.pendingSpaceBefore) {
      block.spacing = { before: Math.round(this.pendingSpaceBefore * 20) };
      this.pendingSpaceBefore = 0;
    }
    c.blocks.push(block);
  }

  addBlock(b: Block): void {
    this.closeParagraph();
    this.top.blocks.push(b);
  }

  pushContainer(kind: Container["kind"], blocks: Block[] = []): Container {
    const c: Container = { kind, blocks, para: kind === "inline" ? [] : null, indent: true };
    this.containers.push(c);
    return c;
  }
  popContainer(): Container {
    this.closeParagraph();
    if (this.containers.length === 1) return this.containers[0];   // the body is never popped
    return this.containers.pop()!;
  }

  /** Pops containers until `c` has been removed (recovers from unbalanced nesting). */
  popUntil(c: Container): void {
    const i = this.containers.lastIndexOf(c);
    if (i <= 0) return;
    while (this.containers.length > i) this.containers.pop();
  }

  /** Digests tokens into inline content (heading titles, captions, authors). */
  captureInline(toks: Token[], trim = true): Inline[] {
    const saved = { lig: this.ligOk };
    const c = this.pushContainer("inline");
    this.e.beginGroup("internal");
    this.digestTokens(toks);
    this.e.endGroup("internal");
    this.popUntil(c);
    this.ligOk = saved.lig;
    if (c.blocks.length) this.e.diag.warn("W014", "block content inside inline material was dropped", undefined);
    return trim ? trimInlines(c.para ?? []) : (c.para ?? []);
  }

  /** Plain text of digested tokens (for \text in math, labels, metadata). */
  captureText(toks: Token[], trim = true): string {
    return this.captureInline(toks, trim).map(n => (n.kind === "text" ? n.text : n.kind === "lineBreak" ? " "
      : n.kind === "math" ? mathText(n.tree) : "")).join("");
  }

  /** Digests tokens into blocks (footnote bodies, minipages). */
  captureBlocks(toks: Token[], kind: "footnote" | "item" = "footnote"): Block[] {
    const saved = { afterHeading: this.afterHeading, noIndentNext: this.noIndentNext, lig: this.ligOk };
    this.afterHeading = false;
    this.noIndentNext = true;
    const c = this.pushContainer(kind);
    this.e.beginGroup("internal");
    this.e.state.set("par:role", undefined);
    this.e.state.set("par:align", undefined);
    this.digestTokens(toks);
    this.closeParagraph();
    this.e.endGroup("internal");
    this.popUntil(c);
    Object.assign(this, { afterHeading: saved.afterHeading, noIndentNext: saved.noIndentNext, ligOk: saved.lig });
    return c.blocks;
  }

  // ------------------------------------------------------------------ environments

  beginEnvironment(name: string, t: CsToken): void {
    const e = this.e;
    const h = this.environments.get(name);
    const userDefined = !!e.state.get("userenv:" + name);
    if (userDefined || (!h && e.meaningOf(name)?.type === "latex")) {
      e.beginGroup("env", name);
      this.envStack.push({ name, user: true, loc: t, containerDepth: this.containers.length });
      const spec = e.state.get<ArgSpec[]>("userenvspec:" + name);
      if (spec && spec.some(s => s.t === "b")) {
        // xparse body argument: read the body now, then run begin code, body and end code.
        const m = e.meaningOf(name);
        if (m && m.type === "latex") {
          const args = e.readArgs(spec.filter(s => s.t !== "b"), t);
          const body = this.readEnvBody(name, t);
          const vals: Token[][] = [];
          let ai = 0;
          for (const s of spec) {
            if (s.t === "b") { vals.push(body); continue; }
            const a = args[ai++];
            vals.push(s.t === "s" || s.t === "t" ? [csTok(a.present ? "BooleanTrue" : "BooleanFalse")]
              : a.present ? a.tokens : (s as { default?: Token[] }).default ?? [csTok("\u0000NoValue")]);
          }
          const endM = e.meaningOf("end" + name);
          const sub = (b: Token[]) => b.flatMap(x => (x.kind === "param" ? vals[x.n - 1] ?? [] : [x]));
          e.pushBack([...sub(m.body), ...(endM && endM.type === "latex" ? sub(endM.body) : []), ...endEnvMarker(name, t)]);
          return;
        }
      }
      e.pushBack([csTok(name, t)]);
      return;
    }
    if (h) {
      if (h.mode === "block" || h.display) this.closeParagraph();
      else if (h.mode === "inline") this.ensurePara();
      e.beginGroup("env", name);
      this.envStack.push({ name, handler: h, loc: t, containerDepth: this.containers.length });
      const args = h.spec.length ? e.readArgs(h.spec, t) : [];
      h.begin(this, args, t);
      return;
    }
    const m = e.meaningOf(name);
    e.beginGroup("env", name);
    this.envStack.push({ name, loc: t, containerDepth: this.containers.length });
    if (m) { e.pushBack([csTok(name, t)]); return; }
    this.warnOnce("env:" + name, "W011", `unknown environment ${name}; its content is kept`, t, "define it with \\newenvironment or add a package handler");
  }

  endEnvironment(name: string, t: CsToken): void {
    // Like LaTeX, a user environment's end code runs first (it may close inner environments),
    // and only then is the name checked against the innermost open environment.
    const e = this.e;
    const userEnd = e.meaningOf("end" + name);
    if (!this.environments.has(name) && (e.state.get("userenv:" + name) || (userEnd && userEnd.type !== "command"))) {
      e.pushBack([csTok("end" + name, t), ...endEnvMarker(name, t)]);
      return;
    }
    this.closeEnvironmentNamed(name, t);
  }

  /** Checks `name` against the environment stack, recovers from mismatches, then closes it. */
  closeEnvironmentNamed(name: string, t: CsToken): void {
    const top = this.envStack[this.envStack.length - 1];
    if (!top) { this.e.diag.error("E006", `\\end{${name}} without matching \\begin`, t); return; }
    if (top.name !== name) {
      const idx = this.envStack.map(f => f.name).lastIndexOf(name);
      this.e.diag.error("E006", `\\end{${name}} closes \\begin{${top.name}}`, t);
      if (idx < 0) return;
      while (this.envStack.length - 1 > idx) this.finishEnvironment(this.envStack[this.envStack.length - 1], t);
    }
    this.finishEnvironment(this.envStack[this.envStack.length - 1], t);
  }

  finishEnvironment(frame: EnvFrame, t: CsToken): void {
    if (frame.handler?.end) frame.handler.end(this, t);
    if (frame.handler?.display || frame.handler?.mode === "block") { this.closeParagraph(); this.noIndentNext = true; }
    this.e.endGroup("env", t);
    this.envStack.pop();
  }

  /** For self-closing handlers: pops the frame they opened (they consumed \end{name} themselves). */
  closeSelf(t: Loc): void {
    const frame = this.envStack.pop();
    if (frame) this.e.endGroup("env", t);
    if (frame?.handler?.display) this.noIndentNext = true;
  }

  /** Raw tokens of an environment body up to the matching \end{name} (consumed). */
  readEnvBody(name: string, from: Loc): Token[] {
    const out: Token[] = [];
    let depth = 0;
    for (;;) {
      const t = this.e.nextRaw();
      if (!t) { this.e.diag.error("E006", `\\begin{${name}} not closed`, from); return out; }
      if (t.kind === "cs" && (t.name === "begin" || t.name === "end")) {
        const arg = this.e.readUndelimited(t) ?? [];
        const n = tokensToString(arg).trim();
        if (n === name) {
          if (t.name === "begin") depth++;
          else if (depth === 0) return out;
          else depth--;
        }
        out.push(t, { kind: "char", ch: "{", cat: Cat.BeginGroup, file: t.file, pos: t.pos }, ...arg,
          { kind: "char", ch: "}", cat: Cat.EndGroup, file: t.file, pos: t.pos });
        continue;
      }
      out.push(t);
    }
  }

  // ------------------------------------------------------------------ lists

  beginList(style: "itemize" | "enumerate" | "description", t: Loc): ListState {
    const depth = this.lists.filter(l => l.block.style === style).length + 1;
    const block: Extract<Block, { kind: "list" }> = { kind: "list", style, items: [], span: this.span(t) };
    this.closeParagraph();
    this.top.blocks.push(block);
    const L: ListState = { block, depth, open: false, containerDepth: this.containers.length };
    if (style === "enumerate") {
      L.counter = "enum" + ["i", "ii", "iii", "iv"][Math.min(depth, 4) - 1];
      this.e.setRegister("count", "c@" + L.counter, 0, true);
    }
    this.lists.push(L);
    return L;
  }

  startItem(label: Token[] | undefined, t?: Loc): void {
    const L = this.lists[this.lists.length - 1];
    if (!L) return;
    if (L.open) this.endItem();
    const item: ListItem = { blocks: [] };
    if (label) item.label = this.captureInline(label);
    else if (L.counter) {
      // \setcounter{enumi}{n} before the first \item changes where numbering starts.
      const before = this.e.register("count", "c@" + L.counter) as number;
      if (!L.block.items.length && before > 0 && L.block.start === undefined) L.block.start = before + 1;
      refStepCounter(this.e, L.counter, t ?? { file: -1, pos: 0 });
      if (L.refLabel) this.e.state.set("@currentlabel", this.captureText(L.refLabel));
      this.labelTarget = { kind: "item", claim: key => (item.anchor ??= key) };
    }
    L.block.items.push(item);
    this.pushContainer("item", item.blocks);
    L.open = true;
    this.noIndentNext = true;
  }

  endItem(): void {
    const L = this.lists[this.lists.length - 1];
    if (!L || !L.open) return;
    this.closeParagraph();
    while (this.containers.length > L.containerDepth) this.popContainer();
    L.open = false;
  }

  endList(): void {
    this.endItem();
    this.lists.pop();
    this.noIndentNext = true;
  }

  // ------------------------------------------------------------------ math

  /** \text in math keeps its spaces: $a \text{ if } b$ reads "a if b". */
  mathHooks = { text: (toks: Token[]) => this.captureText(toks, false) };

  private mathShift(t: Loc): void {
    const next = this.e.nextRaw();
    if (next && next.kind === "char" && next.cat === Cat.MathShift && this.top.kind !== "inline") {
      const p = new MathParser(this.e, this.mathHooks, true, t);
      const tree = p.parseUntil(u => {
        if (u.kind !== "char" || u.cat !== Cat.MathShift) return false;
        const v = this.e.nextRaw();
        if (!(v && v.kind === "char" && v.cat === Cat.MathShift)) {
          this.e.diag.error("E006", "display math should end with $$", u);
          if (v) this.e.pushBackOne(v);
        }
        return true;
      });
      this.displayMath(tree, t);
      return;
    }
    if (next) this.e.pushBackOne(next);
    this.inlineMath(u => u.kind === "char" && u.cat === Cat.MathShift, t);
  }

  inlineMath(stop: (t: Token) => boolean, t: Loc): void {
    this.ensurePara();
    this.e.beginGroup("math");
    const p = new MathParser(this.e, this.mathHooks, false, t);
    const tree = p.parseUntil(stop);
    this.e.endGroup("math", t);
    this.inline({ kind: "math", tree });
  }

  displayMath(tree: MathNode, t: Loc): void {
    this.addBlock({ kind: "math", tree, span: this.span(t) });
    this.noIndentNext = true;
  }

  /** A math-only command used in text (e.g. \alpha without $): LaTeX errors; we typeset it as math. */
  private inlineMathFromCommand(t: CsToken): void {
    this.e.diag.error("E006", `missing $ inserted: \\${t.name} is only allowed in math`, t);
    this.ensurePara();
    const p = new MathParser(this.e, this.mathHooks, false, t);
    const END = this.e.newFence();
    this.e.pushBack([t, END]);
    const tree = p.parseToEnd();
    this.e.discardToFence(END);
    this.inline({ kind: "math", tree });
  }

  private mathOnly(name: string): boolean {
    return this.e.meaningOf(name)?.type === "command" && !this.commands.has(name) && !this.e.commands.has(name);
  }

  // ------------------------------------------------------------------ labels and references

  setLabel(key: string, t: Loc): void {
    if (this.labels.has(key)) this.e.diag.warn("W021", `label '${key}' multiply defined`, t);
    const text = this.e.state.get<string>("@currentlabel") ?? "";
    const counter = this.e.state.get<string>("@currentcounter");
    const bookmark = this.labelTarget ? this.labelTarget.claim(key) : undefined;
    this.labels.set(key, { text, counter, bookmark, kind: this.labelTarget?.kind, loc: t });
  }

  ref(key: string, form: RefInline["form"], t: Loc, wrap?: [string, string]): void {
    const node: RefInline = { kind: "ref", label: key, form };
    this.refs.push({ node, loc: t, wrap });
    if (wrap?.[0]) this.literal(wrap[0]);
    this.inline(node);
    if (wrap?.[1]) this.literal(wrap[1]);
  }

  private resolveRefs(): void {
    for (const { node, loc } of this.refs) {
      const entry = this.labels.get(node.label);
      if (!entry) {
        this.e.diag.warn("W020", `reference '${node.label}' is undefined`, loc, "check the \\label name");
        node.text = "??";
        continue;
      }
      node.target = entry.bookmark;
      node.targetKind = entry.kind;
      if (node.form === "page") { node.text = "?"; continue; }
      if (node.form === "name+number") node.prefix = this.autorefName(entry.counter);
      node.text = entry.text;
    }
  }

  /** \autoref name: the document's \<counter>autorefname if defined, else hyperref's default. */
  private autorefName(counter: string | undefined): string {
    if (!counter) return "";
    const own = counter.replace(/^enum[iv]+$/, "item");
    if (this.e.meaningOf(own + "autorefname")) return this.argString([csTok(own + "autorefname")]);
    return refName(counter);
  }

  // ------------------------------------------------------------------ fallback

  unknown(t: CsToken): void {
    const name = t.active ? t.name : "\\" + t.name;
    this.warnOnce("cmd:" + t.name, "W013", `unknown command ${name}, rendered its arguments as text`, t,
      "define it with \\newcommand or add a package handler", name.length);
    if (t.active) return;
    // Optional argument is dropped; brace arguments are digested as text.
    const opt = this.e.peekRaw();
    if (opt && opt.kind === "char" && opt.ch === "[" ) this.e.readOptional();
    for (;;) {
      const u = this.e.peekRaw();
      if (!u || !(u.kind === "char" && u.cat === Cat.BeginGroup)) break;
      const toks = this.e.readUndelimited(t) ?? [];
      this.e.beginGroup("internal");
      this.digestTokens(toks);
      this.e.endGroup("internal");
    }
  }

  /** Argument text after full expansion (labels, keys, names). */
  argString(a: Arg | Token[]): string {
    const toks = Array.isArray(a) ? a : a.tokens;
    return tokensToString(this.e.expandFully(toks)).trim();
  }

  theCounter(name: string): string { return theCounter(this.e, name); }

  isSpaceToken = isSpace;
}

/** Characters of a math tree in reading order (for labels such as $\circ$ bullets). */
export function mathText(n: MathNode): string {
  switch (n.k) {
    case "atom": return n.text;
    case "row": return n.items.map(mathText).join("");
    case "sup": return mathText(n.base) + mathText(n.sup);
    case "sub": return mathText(n.base) + mathText(n.sub);
    case "subsup": return mathText(n.base) + mathText(n.sub) + mathText(n.sup);
    case "frac": return mathText(n.num) + "/" + mathText(n.den);
    case "delim": return n.open + n.body.map(mathText).join("") + n.close;
    case "func": return mathText(n.name) + " " + mathText(n.body);
    default: return "";
  }
}

/** Internal tokens that close environment `name` after its end code has been digested. */
function endEnvMarker(name: string, t: Loc): Token[] {
  return [csTok("\u0000endenv", t), { kind: "char", ch: "{", cat: Cat.BeginGroup, file: t.file, pos: t.pos },
    ...[...name].map(ch => ({ kind: "char" as const, ch, cat: Cat.Other, file: t.file, pos: t.pos })),
    { kind: "char", ch: "}", cat: Cat.EndGroup, file: t.file, pos: t.pos }];
}

/** hyperref's English \autoref names. */
const REF_NAMES: Record<string, string> = {
  section: "section", subsection: "subsection", subsubsection: "subsubsection", chapter: "chapter", part: "Part",
  paragraph: "paragraph", subparagraph: "subparagraph", figure: "Figure", table: "Table", equation: "Equation",
  footnote: "footnote", enumi: "item", enumii: "item", enumiii: "item", enumiv: "item", page: "page",
  appendix: "Appendix", theorem: "Theorem",
};
export function refName(counter: string | undefined): string {
  return counter ? REF_NAMES[counter] ?? counter.charAt(0).toUpperCase() + counter.slice(1) : "";
}
