// Unexpandable core commands: definitions, assignments, groups, registers, LaTeX counters.
// The digester calls Engine.commands for any command token it does not handle itself.

import { parseSpecTokens, type ArgSpec } from "./argspec.ts";
import type { Engine, Meaning, Prefixes } from "./engine.ts";
import {
  Cat, charTok, csTok, isBeginGroup, isChar, isCs, isSpace, tokensToString, type CsToken, type Loc, type Token,
} from "./tokens.ts";

export const NO_PREFIX: Prefixes = { global: false, protected: false, long: false };

/** Reads the control sequence being defined: \foo, {\foo} or an active character. */
export function readDefinedName(e: Engine, from: Loc): CsToken | null {
  e.skipSpacesRaw();
  let t = e.nextRaw();
  if (t && isBeginGroup(t)) {
    const inner = e.readGroupBody(t).filter(x => !isSpace(x));
    t = inner[0] ?? null;
  }
  if (!t || t.kind !== "cs") {
    e.diag.error("E008", "missing control sequence name in definition", from);
    return null;
  }
  return t;
}

/** Parses a \def parameter text from the raw input, up to the body's `{`. */
function readParamText(e: Engine, from: Loc): { prefix: Token[]; params: Token[][]; braceDelim: boolean } | null {
  const prefix: Token[] = [];
  const params: Token[][] = [];
  let braceDelim = false;
  for (;;) {
    const t = e.nextRaw();
    if (!t) { e.diag.error("E008", "end of input in parameter text", from); return null; }
    if (isBeginGroup(t)) { e.pushBackOne(t); break; }
    if (isChar(t, Cat.Param)) {
      const n = e.nextRaw();
      if (n && isBeginGroup(n)) { braceDelim = true; e.pushBackOne(n); break; }
      if (!n || n.kind !== "char" || n.ch !== String(params.length + 1)) {
        e.diag.error("E008", `parameters must be numbered consecutively (expected #${params.length + 1})`, t);
        if (n) e.pushBackOne(n);
        continue;
      }
      params.push([]);
      continue;
    }
    if (params.length === 0) prefix.push(t);
    else params[params.length - 1].push(t);
  }
  return { prefix, params, braceDelim };
}

/** Converts `#n` in a body to ParamTokens and `##` to a single `#`. */
export function compileBody(body: Token[], nparams: number, e: Engine, from: Loc): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < body.length; i++) {
    const t = body[i];
    if (isChar(t, Cat.Param)) {
      const n = body[i + 1];
      if (n && isChar(n, Cat.Param)) { out.push(n); i++; continue; }
      if (n && n.kind === "char" && /^[1-9]$/.test(n.ch) && Number(n.ch) <= nparams) {
        out.push({ kind: "param", n: Number(n.ch), file: t.file, pos: t.pos });
        i++;
        continue;
      }
      e.diag.error("E008", `illegal parameter number in definition (only ${nparams} declared)`, t);
      continue;
    }
    out.push(t);
  }
  return out;
}

function readBody(e: Engine, from: Loc): Token[] {
  e.skipSpacesRaw();
  const t = e.nextRaw();
  if (!t || !isBeginGroup(t)) {
    e.diag.error("E008", "missing { before definition body", from);
    if (t) e.pushBackOne(t);
    return [];
  }
  return e.readGroupBody(t);
}

function doDef(e: Engine, t: CsToken, p: Prefixes, expand: boolean, global: boolean): void {
  const name = readDefinedName(e, t);
  if (!name) return;
  const pt = readParamText(e, t);
  if (!pt) return;
  let body = readBody(e, t);
  if (expand) body = e.expandFully(body);
  body = compileBody(body, pt.params.length, e, t);
  if (pt.braceDelim) body.push(charTok("{", Cat.BeginGroup, t));
  e.define(name, { type: "macro", name: name.name, ...pt, body, protected: p.protected || undefined }, global || p.global);
}

function doLet(e: Engine, t: CsToken, p: Prefixes): void {
  const name = readDefinedName(e, t);
  if (!name) return;
  // \let\a= b : optional spaces, optional =, one optional space.
  let u = e.nextRaw();
  while (u && isSpace(u)) u = e.nextRaw();
  if (u && isChar(u, Cat.Other, "=")) {
    u = e.nextRaw();
    if (u && isSpace(u)) u = e.nextRaw();
  }
  if (!u) return;
  e.define(name, letMeaning(e, u), p.global);
}

function letMeaning(e: Engine, u: Token): Meaning | undefined {
  if (u.kind === "char") return { type: "char", ch: u.ch, cat: u.cat };
  return e.meaning(u);
}

type Reg = "count" | "dimen" | "skip" | "toks";

function readRegisterTarget(e: Engine, from: CsToken): { reg: Reg; key: string } | null {
  const t = e.next();
  if (!t || t.kind !== "cs") { e.diag.error("E009", "missing register", from); if (t) e.pushBackOne(t); return null; }
  const m = e.meaning(t);
  if (m && m.type === "register") return { reg: m.reg, key: m.key };
  if (m && m.type === "command" && ["count", "dimen", "skip", "toks"].includes(m.name))
    return { reg: m.name as Reg, key: String(e.readNumber(t)) };
  e.diag.error("E009", `\\${t.name} is not a register`, t);
  return null;
}

/** Performs `⟨register⟩ = ⟨value⟩` given the register target. */
export function assignRegister(e: Engine, from: CsToken, reg: Reg, key: string, global: boolean): void {
  e.readEquals();
  if (reg === "toks") {
    e.skipSpacesExpanded();
    const t = e.next();
    if (t && t.kind === "cs") {
      const m = e.meaning(t);
      if (m && m.type === "register" && m.reg === "toks") { e.setRegister("toks", key, e.register("toks", m.key), global); return; }
    }
    if (t) e.pushBackOne(t);
    e.setRegister("toks", key, e.readGeneralText(from), global);
    return;
  }
  const v = reg === "count" ? e.readNumber(from) : reg === "dimen" ? e.readDimen(from) : e.readGlue(from);
  e.setRegister(reg, key, v, global);
}

function arith(e: Engine, t: CsToken, p: Prefixes, op: "advance" | "multiply" | "divide"): void {
  const target = readRegisterTarget(e, t);
  if (!target || target.reg === "toks") return;
  e.readKeyword("by");
  const cur = e.register(target.reg, target.key) as number;
  let v: number;
  if (op === "advance") v = cur + (target.reg === "count" ? e.readNumber(t) : target.reg === "dimen" ? e.readDimen(t) : e.readGlue(t));
  else {
    const n = e.readNumber(t);
    v = op === "multiply" ? cur * n : n === 0 ? (e.diag.error("E009", "arithmetic overflow (division by zero)", t), cur) : Math.trunc(cur / n);
  }
  e.setRegister(target.reg, target.key, v, p.global);
}

// ---------------------------------------------------------------- LaTeX layer

const csFromName = (name: string, loc: Loc) => csTok(name, loc);

/** Plain text of a braced argument after full expansion (counter names, environment names). */
export function argText(e: Engine, from: Loc): string {
  return tokensToString(e.expandFully(e.readUndelimited(from) ?? [])).trim();
}

export function newCounter(e: Engine, name: string, within: string | undefined, from: Loc): void {
  e.define("c@" + name, { type: "register", reg: "count", key: "c@" + name }, true);
  e.setRegister("count", "c@" + name, 0, true);
  e.state.set("cl@" + name, [], true);
  // Like LaTeX, \newcounter{x}[y] does not change \thex; classes redefine formats explicitly.
  const the: Token[] = [csFromName("@arabic", from), csFromName("c@" + name, from)];
  e.define("the" + name, { type: "macro", name: "the" + name, prefix: [], params: [], braceDelim: false, body: the }, true);
  e.define("p@" + name, { type: "macro", name: "p@" + name, prefix: [], params: [], braceDelim: false, body: [] }, true);
  if (within) addToReset(e, name, within);
}

export function addToReset(e: Engine, name: string, within: string): void {
  const list = e.state.get<string[]>("cl@" + within) ?? [];
  if (!list.includes(name)) e.state.set("cl@" + within, [...list, name], true);
}

export function counterExists(e: Engine, name: string): boolean { return e.isDefined("c@" + name); }

export function setCounterValue(e: Engine, name: string, n: number, from: Loc): void {
  if (!counterExists(e, name)) { e.diag.error("E009", `no counter '${name}' defined`, from); return; }
  e.setRegister("count", "c@" + name, n, true);
}

export function stepCounter(e: Engine, name: string, from: Loc): void {
  if (!counterExists(e, name)) { e.diag.error("E009", `no counter '${name}' defined`, from); return; }
  e.setRegister("count", "c@" + name, (e.register("count", "c@" + name) as number) + 1, true);
  for (const child of e.state.get<string[]>("cl@" + name) ?? []) {
    e.setRegister("count", "c@" + child, 0, true);
    for (const g of e.state.get<string[]>("cl@" + child) ?? []) resetTree(e, g);
  }
}
function resetTree(e: Engine, name: string): void {
  e.setRegister("count", "c@" + name, 0, true);
  for (const g of e.state.get<string[]>("cl@" + name) ?? []) resetTree(e, g);
}

/** Expanded \the<counter> text, as \refstepcounter stores it in \@currentlabel. */
export function theCounter(e: Engine, name: string): string {
  return tokensToString(e.expandFully([csTok("p@" + name), csTok("the" + name)]));
}

export function refStepCounter(e: Engine, name: string, from: Loc): void {
  stepCounter(e, name, from);
  // A new \@currentlabel invalidates whatever object the previous \label would have bound to;
  // handlers that create a bookmark target (headings, items, captions) set it again afterwards.
  e.state.set("@labeltarget", undefined, true);
  e.state.set("@currentlabel", theCounter(e, name));
  e.state.set("@currentcounter", name);
}

function defineLatexCommand(e: Engine, t: CsToken, mode: "new" | "renew" | "provide" | "declare", starred: boolean): void {
  void starred;
  const name = readDefinedName(e, t);
  if (!name) return;
  const nArgs = e.readOptional();
  const n = nArgs ? parseInt(tokensToString(nArgs).trim(), 10) || 0 : 0;
  const def = e.readOptional();
  const body = readBody(e, t);
  const existing = e.meaning(name);
  if (mode === "provide" && existing) return;
  if (mode === "new" && existing && existing.type !== "command") {
    // Real LaTeX would stop here; the document compiled there, so a clash means our kernel predefined it.
    e.diag.report({ severity: "info", code: "W013", message: `\\newcommand redefines \\${name.name}`, loc: t });
  }
  const spec: ArgSpec[] = [];
  for (let i = 0; i < n; i++) spec.push(i === 0 && def ? { t: "o", default: def } : { t: "m" });
  e.define(name, { type: "latex", name: name.name, spec, body: compileBody(body, n, e, t) });
}

function defineLatexEnvironment(e: Engine, t: CsToken, mode: "new" | "renew" | "provide"): void {
  const env = argText(e, t);
  const nArgs = e.readOptional();
  const n = nArgs ? parseInt(tokensToString(nArgs).trim(), 10) || 0 : 0;
  const def = e.readOptional();
  const begin = readBody(e, t);
  const end = readBody(e, t);
  if (mode === "provide" && e.isDefined(env)) return;
  const spec: ArgSpec[] = [];
  for (let i = 0; i < n; i++) spec.push(i === 0 && def ? { t: "o", default: def } : { t: "m" });
  e.define(env, { type: "latex", name: env, spec, body: compileBody(begin, n, e, t) });
  e.define("end" + env, { type: "macro", name: "end" + env, prefix: [], params: [], braceDelim: false, body: compileBody(end, 0, e, t) });
  e.state.set("userenv:" + env, true);
}

function defineDocumentCommand(e: Engine, t: CsToken, mode: "new" | "renew" | "provide" | "declare"): void {
  const name = readDefinedName(e, t);
  if (!name) return;
  const specToks = e.readUndelimited(t) ?? [];
  const body = readBody(e, t);
  if (mode === "provide" && e.meaning(name)) return;
  let spec: ArgSpec[];
  try { spec = parseSpecTokens(specToks); }
  catch (err) { e.diag.error("E008", `bad argument specification: ${(err as Error).message}`, t); return; }
  e.define(name, { type: "latex", name: name.name, spec, body: compileBody(body, spec.length, e, t), protected: true });
}

function defineDocumentEnvironment(e: Engine, t: CsToken, mode: "new" | "renew" | "provide" | "declare"): void {
  const env = argText(e, t);
  const specToks = e.readUndelimited(t) ?? [];
  const begin = readBody(e, t);
  const end = readBody(e, t);
  if (mode === "provide" && e.isDefined(env)) return;
  let spec: ArgSpec[];
  try { spec = parseSpecTokens(specToks); }
  catch (err) { e.diag.error("E008", `bad argument specification: ${(err as Error).message}`, t); return; }
  e.define(env, { type: "latex", name: env, spec, body: compileBody(begin, spec.length, e, t), protected: true });
  // xparse makes the arguments available to the end code too.
  e.define("end" + env, { type: "latex", name: "end" + env, spec: [], body: compileBody(end, spec.length, e, t), protected: true });
  e.state.set("userenv:" + env, true);
  e.state.set("userenvspec:" + env, spec);
}

/** Skips raw input up to \ExplSyntaxOff (expl3 code is out of scope for v1). */
function skipExplBlock(e: Engine, t: CsToken): void {
  const lx = e.currentLexer();
  e.diag.warn("W015", "expl3 code between \\ExplSyntaxOn and \\ExplSyntaxOff was skipped", t,
    "commands defined in that block will be reported as unknown");
  if (lx) {
    if (!lx.readRawUntil(/\\ExplSyntaxOff(?![A-Za-z@])/)) lx.readRawUntil(/$(?![\s\S])/);
    lx.skipFollowingSpaces();
    return;
  }
  for (;;) {
    const u = e.nextRaw();
    if (!u || isCs(u, "ExplSyntaxOff")) return;
  }
}

export function installCommands(e: Engine): void {
  const prefixed = new Set(["def", "gdef", "edef", "xdef", "let", "futurelet", "global", "long", "outer", "protected",
    "count", "dimen", "skip", "toks", "advance", "multiply", "divide", "chardef", "mathchardef", "countdef",
    "dimendef", "skipdef", "toksdef", "catcode", "newif", "setlength", "addtolength"]);

  const prefix = (kind: "global" | "long" | "protected") => (e: Engine, t: CsToken, p: Prefixes) => {
    const np = { ...p, [kind]: true };
    for (;;) {
      const u = e.next();
      if (!u) return;
      if (isSpace(u) || isCs(u, "relax")) continue;
      const m = u.kind === "cs" ? e.meaning(u) : undefined;
      if (m && m.type === "command" && prefixed.has(m.name)) { e.commands.get(m.name)!(e, u as CsToken, np); return; }
      if (m && m.type === "register") { assignRegister(e, u as CsToken, m.reg, m.key, np.global); return; }
      if (m && m.type === "command" && e.commands.has(m.name) && kind === "global") { e.commands.get(m.name)!(e, u as CsToken, np); return; }
      e.diag.warn("W012", `\\${t.name} prefix ignored before ${u.kind === "cs" ? "\\" + u.name : "text"}`, t);
      e.pushBackOne(u);
      return;
    }
  };
  e.command("global", prefix("global"));
  e.command("long", prefix("long"));
  e.command("outer", prefix("long"));
  e.command("protected", prefix("protected"));

  e.command("relax", () => {});
  e.command("endcsname", (e, t) => e.diag.error("E006", "extra \\endcsname", t));
  e.command("def", (e, t, p) => doDef(e, t, p, false, false));
  e.command("gdef", (e, t, p) => doDef(e, t, p, false, true));
  e.command("edef", (e, t, p) => doDef(e, t, p, true, false));
  e.command("xdef", (e, t, p) => doDef(e, t, p, true, true));
  e.command("let", (e, t, p) => doLet(e, t, p));
  e.command("futurelet", (e, t, p) => {
    const name = readDefinedName(e, t);
    const a = e.nextRaw(), b = e.nextRaw();
    if (name && b) e.define(name, letMeaning(e, b), p.global);
    if (b) e.pushBackOne(b);
    if (a) e.pushBackOne(a);
  });

  e.command("begingroup", () => e.beginGroup("semi"));
  e.command("endgroup", (e, t) => e.endGroup("semi", t));

  e.command("catcode", (e, t, p) => {
    const cp = e.readNumber(t);
    e.readEquals();
    const cat = e.readNumber(t);
    if (cat < 0 || cat > 15) { e.diag.error("E009", `invalid catcode ${cat}`, t); return; }
    e.state.set("cat:" + cp, cat, p.global);
  });
  for (const code of ["lccode", "uccode", "sfcode", "mathcode", "delcode"]) {
    e.command(code, (e, t) => { e.readNumber(t); e.readEquals(); e.readNumber(t); });
  }

  for (const reg of ["count", "dimen", "skip", "toks"] as const) {
    e.command(reg, (e, t, p) => assignRegister(e, t, reg, String(e.readNumber(t)), p.global));
    e.command(reg + "def", (e, t, p) => {
      const name = readDefinedName(e, t);
      e.readEquals();
      const n = e.readNumber(t);
      if (name) e.define(name, { type: "register", reg, key: String(n) }, p.global);
    });
  }
  e.command("muskip", (e, t) => { e.readNumber(t); e.readEquals(); e.readGlue(t); });
  for (const op of ["advance", "multiply", "divide"] as const) e.command(op, (e, t, p) => arith(e, t, p, op));
  for (const name of ["chardef", "mathchardef"]) {
    e.command(name, (e, t, p) => {
      const cs = readDefinedName(e, t);
      e.readEquals();
      const n = e.readNumber(t);
      if (cs) e.define(cs, { type: "chardef", value: n, math: name === "mathchardef" }, p.global);
    });
  }

  // Register allocation: the register is keyed by its control sequence name.
  const alloc = (reg: Reg) => (e: Engine, t: CsToken) => {
    const name = readDefinedName(e, t);
    if (!name) return;
    if (!e.meaning(name)) e.setRegister(reg, name.name, reg === "toks" ? [] : 0, true);
    e.define(name, { type: "register", reg, key: name.name }, true);
  };
  e.command("newcount", alloc("count"));
  e.command("newdimen", alloc("dimen"));
  e.command("newskip", alloc("skip"));
  e.command("newlength", alloc("skip"));
  e.command("newtoks", alloc("toks"));
  e.command("newmuskip", alloc("skip"));
  for (const n of ["newbox", "newread", "newwrite", "newlanguage", "newinsert", "newfam"]) {
    e.command(n, (e, t) => {
      const name = readDefinedName(e, t);
      if (name) e.define(name, { type: "chardef", value: 0 }, true);
    });
  }
  e.command("setlength", (e, t, p) => {
    const target = e.readUndelimited(t) ?? [];
    const val = e.readUndelimited(t) ?? [];
    const cs = target.find(x => x.kind === "cs") as CsToken | undefined;
    const m = cs && e.meaning(cs);
    if (!m || m.type !== "register" || m.reg === "count" || m.reg === "toks") {
      e.diag.warn("W012", `\\setlength on ${cs ? "\\" + cs.name : "a non-length"} ignored`, t);
      return;
    }
    e.pushBack([...val, csTok("relax", t)]);
    e.setRegister(m.reg, m.key, m.reg === "dimen" ? e.readDimen(t) : e.readGlue(t), p.global);
    const r = e.next();
    if (r && !isCs(r, "relax")) e.pushBackOne(r);
  });
  e.command("addtolength", (e, t, p) => {
    const target = e.readUndelimited(t) ?? [];
    const val = e.readUndelimited(t) ?? [];
    const cs = target.find(x => x.kind === "cs") as CsToken | undefined;
    const m = cs && e.meaning(cs);
    if (!m || m.type !== "register" || m.reg === "count" || m.reg === "toks") return;
    e.pushBack([...val, csTok("relax", t)]);
    e.setRegister(m.reg, m.key, (e.register(m.reg, m.key) as number) + e.readGlue(t), p.global);
    const r = e.next();
    if (r && !isCs(r, "relax")) e.pushBackOne(r);
  });

  e.command("newif", (e, t, p) => {
    const name = readDefinedName(e, t);
    if (!name || !name.name.startsWith("if")) { e.diag.error("E008", "\\newif needs a name starting with \\if", t); return; }
    const base = name.name.slice(2);
    e.define(name, e.meaningOf("iffalse"), true);
    for (const v of ["true", "false"]) {
      e.define(base + v, { type: "macro", name: base + v, prefix: [], params: [], braceDelim: false,
        body: [csTok("let", t), csTok(name.name, t), csTok("if" + v, t)] }, true);
    }
    void p;
  });

  e.command("makeatletter", e => e.setCatcode("@", Cat.Letter));
  e.command("makeatother", e => e.setCatcode("@", Cat.Other));
  e.command("ExplSyntaxOn", (e, t) => skipExplBlock(e, t));
  e.command("ExplSyntaxOff", () => {});

  // LaTeX definitions.
  const star = (e: Engine) => e.readFlag("*");
  e.command("newcommand", (e, t) => defineLatexCommand(e, t, "new", star(e)));
  e.command("renewcommand", (e, t) => defineLatexCommand(e, t, "renew", star(e)));
  e.command("providecommand", (e, t) => defineLatexCommand(e, t, "provide", star(e)));
  e.command("DeclareRobustCommand", (e, t) => defineLatexCommand(e, t, "declare", star(e)));
  e.command("newenvironment", (e, t) => { star(e); defineLatexEnvironment(e, t, "new"); });
  e.command("renewenvironment", (e, t) => { star(e); defineLatexEnvironment(e, t, "renew"); });
  e.command("provideenvironment", (e, t) => { star(e); defineLatexEnvironment(e, t, "provide"); });
  for (const [cmd, mode] of [["NewDocumentCommand", "new"], ["RenewDocumentCommand", "renew"], ["ProvideDocumentCommand", "provide"],
    ["DeclareDocumentCommand", "declare"], ["NewExpandableDocumentCommand", "new"], ["RenewExpandableDocumentCommand", "renew"],
    ["DeclareExpandableDocumentCommand", "declare"], ["ProvideExpandableDocumentCommand", "provide"]] as const) {
    e.command(cmd, (e, t) => defineDocumentCommand(e, t, mode));
  }
  for (const [cmd, mode] of [["NewDocumentEnvironment", "new"], ["RenewDocumentEnvironment", "renew"],
    ["ProvideDocumentEnvironment", "provide"], ["DeclareDocumentEnvironment", "declare"]] as const) {
    e.command(cmd, (e, t) => defineDocumentEnvironment(e, t, mode));
  }

  // LaTeX counters.
  e.command("newcounter", (e, t) => {
    const name = argText(e, t);
    const within = e.readOptional();
    newCounter(e, name, within ? tokensToString(within).trim() : undefined, t);
  });
  e.command("setcounter", (e, t) => {
    const name = argText(e, t);
    const v = e.readUndelimited(t) ?? [];
    e.pushBack([...v, csTok("relax", t)]);
    const n = e.readNumber(t);
    const r = e.next(); if (r && !isCs(r, "relax")) e.pushBackOne(r);
    if (!counterExists(e, name)) { e.diag.error("E009", `no counter '${name}' defined`, t); return; }
    e.setRegister("count", "c@" + name, n, true);
  });
  e.command("addtocounter", (e, t) => {
    const name = argText(e, t);
    const v = e.readUndelimited(t) ?? [];
    e.pushBack([...v, csTok("relax", t)]);
    const n = e.readNumber(t);
    const r = e.next(); if (r && !isCs(r, "relax")) e.pushBackOne(r);
    if (!counterExists(e, name)) { e.diag.error("E009", `no counter '${name}' defined`, t); return; }
    e.setRegister("count", "c@" + name, (e.register("count", "c@" + name) as number) + n, true);
  });
  e.command("stepcounter", (e, t) => stepCounter(e, argText(e, t), t));
  e.command("refstepcounter", (e, t) => refStepCounter(e, argText(e, t), t));
  e.command("@addtoreset", (e, t) => { const a = argText(e, t), b = argText(e, t); addToReset(e, a, b); });
  e.command("counterwithin", (e, t) => {
    const s = star(e);
    const a = argText(e, t), b = argText(e, t);
    addToReset(e, a, b);
    if (!s) e.define("the" + a, { type: "macro", name: "the" + a, prefix: [], params: [], braceDelim: false,
      body: [csTok("the" + b, t), charTok(".", Cat.Other, t), csTok("@arabic", t), csTok("c@" + a, t)] }, true);
  });
  e.command("counterwithout", (e, t) => {
    const s = star(e);
    const a = argText(e, t), b = argText(e, t);
    const list = e.state.get<string[]>("cl@" + b) ?? [];
    e.state.set("cl@" + b, list.filter(x => x !== a), true);
    if (!s) e.define("the" + a, { type: "macro", name: "the" + a, prefix: [], params: [], braceDelim: false,
      body: [csTok("@arabic", t), csTok("c@" + a, t)] }, true);
  });

  // Lookahead helpers implemented natively instead of through \futurelet.
  e.command("@ifnextchar", (e, t) => {
    const c = e.nextRaw();
    const yes = e.readUndelimited(t) ?? [], no = e.readUndelimited(t) ?? [];
    e.skipSpacesRaw();
    const u = e.peekRaw();
    const match = !!c && !!u && (c.kind === "char" && u.kind === "char" ? c.ch === u.ch && c.cat === u.cat
      : c.kind === "cs" && u.kind === "cs" ? c.name === u.name : false);
    e.pushBack(match ? yes : no);
  });
  e.command("kernel@ifnextchar", (e, t) => e.commands.get("@ifnextchar")!(e, t, NO_PREFIX));
  e.command("@ifstar", (e, t) => {
    const yes = e.readUndelimited(t) ?? [], no = e.readUndelimited(t) ?? [];
    e.pushBack(e.readFlag("*") ? yes : no);
  });
  e.command("@ifpackageloaded", (e, t) => {
    const name = argText(e, t);
    const yes = e.readUndelimited(t) ?? [], no = e.readUndelimited(t) ?? [];
    e.pushBack(e.state.get("pkg:" + name) ? yes : no);
  });
  e.command("@ifclassloaded", (e, t) => {
    const name = argText(e, t);
    const yes = e.readUndelimited(t) ?? [], no = e.readUndelimited(t) ?? [];
    e.pushBack(e.state.get<string>("documentclass") === name ? yes : no);
  });

  // Case changing (LaTeX's \MakeUppercase expands first; TeX's \uppercase does not).
  const mapCase = (toks: Token[], up: boolean): Token[] =>
    toks.map(x => (x.kind === "char" && (x.cat === Cat.Letter || x.cat === Cat.Other) ? { ...x, ch: up ? x.ch.toUpperCase() : x.ch.toLowerCase() } : x));
  e.command("uppercase", (e, t) => e.pushBack(mapCase(e.readGeneralText(t), true)));
  e.command("lowercase", (e, t) => e.pushBack(mapCase(e.readGeneralText(t), false)));
  e.command("MakeUppercase", (e, t) => e.pushBack(mapCase(e.expandFully(e.readUndelimited(t) ?? []), true)));
  e.command("MakeLowercase", (e, t) => e.pushBack(mapCase(e.expandFully(e.readUndelimited(t) ?? []), false)));

  e.command("ignorespaces", e => e.skipSpacesExpanded());
  e.command("afterassignment", (e, t) => { e.nextRaw(); e.diag.warn("W012", "\\afterassignment is not supported", t); });
  e.command("aftergroup", (e, t) => { e.nextRaw(); e.diag.warn("W012", "\\aftergroup is not supported", t); });

  // Files: never written; reads go through the sandbox.
  e.command("immediate", () => {});
  e.command("openout", (e, t) => {
    e.readNumber(t); e.readEquals();
    for (;;) { const u = e.next(); if (!u || isSpace(u) || u.kind !== "char") { if (u && !isSpace(u)) e.pushBackOne(u); break; } }
    e.diag.warn("W016", "\\openout ignored: documents cannot write files", t);
  });
  e.command("closeout", (e, t) => { e.readNumber(t); });
  e.command("write", (e, t) => {
    const n = e.readNumber(t);
    e.readGeneralText(t);
    if (n === 18) e.diag.warn("W017", "\\write18 shell escape ignored: texdocx never runs commands", t);
  });
  e.command("openin", (e, t) => { e.readNumber(t); e.readEquals(); e.readUndelimited(t); });
  e.command("closein", (e, t) => { e.readNumber(t); });
  for (const name of ["message", "typeout", "wlog", "errmessage", "PackageInfo", "ClassInfo", "GenericInfo"]) {
    e.command(name, (e, t) => {
      const n = name === "PackageInfo" || name === "ClassInfo" ? 2 : name === "GenericInfo" ? 2 : 1;
      for (let i = 0; i < n; i++) {
        if (name === "message" || name === "errmessage") e.readGeneralText(t);
        else e.readUndelimited(t);
      }
    });
  }
  for (const name of ["PackageWarning", "ClassWarning", "PackageWarningNoLine", "ClassWarningNoLine", "PackageError", "ClassError", "GenericWarning", "GenericError"]) {
    e.command(name, (e, t) => {
      const n = name.endsWith("Error") ? (name === "GenericError" ? 4 : 3) : 2;
      for (let i = 0; i < n; i++) e.readUndelimited(t);
    });
  }
  for (const name of ["show", "showthe", "showbox", "showlists", "showgroups", "showtokens"]) {
    e.command(name, (e) => { e.nextRaw(); });
  }
  e.command("include", (e, t) => {
    const name = argText(e, t);
    e.pushBack([csTok("clearpage", t)]);
    e.inputFile(name, t, "include");
  });
  e.command("subfile", (e, t) => {
    const name = argText(e, t);
    e.state.set("subfile", true);
    e.inputFile(name, t, "subfile");
  });
  e.command("includeonly", (e, t) => { e.readUndelimited(t); });
  e.command("IfFileExists", (e, t) => {
    const name = argText(e, t);
    const yes = e.readUndelimited(t) ?? [], no = e.readUndelimited(t) ?? [];
    const r = e.opts.readFile?.({ path: name, extensions: [".tex", ""], from: t, command: "IfFileExists" });
    e.pushBack(r && !("error" in r) ? yes : no);
  });
  e.command("InputIfFileExists", (e, t) => {
    const name = argText(e, t);
    const yes = e.readUndelimited(t) ?? [], no = e.readUndelimited(t) ?? [];
    const r = e.opts.readFile?.({ path: name, extensions: [".tex", ""], from: t, command: "InputIfFileExists" });
    if (r && !("error" in r)) { e.pushFile(r.name, r.text); e.pushBack(yes); }
    else e.pushBack(no);
  });

  e.command("csdef", (e, t) => {
    // etoolbox: \csdef{name}{body}
    const name = argText(e, t);
    const body = readBody(e, t);
    e.define(name, { type: "macro", name, prefix: [], params: [], braceDelim: false, body: compileBody(body, 0, e, t) });
  });

  e.command("DeclareMathOperator", (e, t) => {
    const s = star(e);
    const name = readDefinedName(e, t);
    const body = e.readUndelimited(t) ?? [];
    if (!name) return;
    const op: Token[] = [csTok("operatorname", t)];
    if (s) op.push(charTok("*", Cat.Other, t));
    op.push(charTok("{", Cat.BeginGroup, t), ...body, charTok("}", Cat.EndGroup, t));
    e.define(name, { type: "macro", name: name.name, prefix: [], params: [], braceDelim: false, body: op });
  });

  e.command("@namedef", (e, t) => {
    const name = argText(e, t);
    e.pushBack([csTok("def", t), csTok(name, t)]);
  });
}
