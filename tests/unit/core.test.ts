import { describe, expect, test } from "vitest";
import {
  BudgetError, Cat, Lexer, NO_PREFIX, assignRegister, createEngine, defaultCat, formatDiagnostic, isSpace, printScaled,
  type CsToken, type Engine, type EngineOptions, type Token,
} from "@texdocx/core";

function lex(src: string, cats: Record<string, Cat> = {}): string[] {
  const lx = new Lexer(0, src, cp => cats[String.fromCodePoint(cp)] ?? defaultCat(cp));
  const out: string[] = [];
  for (let t = lx.next(); t; t = lx.next()) {
    out.push(t.kind === "cs" ? (t.active ? `~${t.name}` : `\\${t.name}`) : t.kind === "char" ? (t.cat === Cat.Space ? "␣" : t.ch) : "#");
  }
  return out;
}

/** Runs input through the engine, executing core commands; returns the remaining tokens as text. */
function run(src: string, opts: EngineOptions = {}): { out: string; e: Engine } {
  const e = createEngine(opts);
  e.pushFile("test.tex", src);
  let out = "";
  for (;;) {
    const t: Token | null = e.next();
    if (!t) break;
    if (t.kind === "cs") {
      const m = e.meaning(t);
      if (m?.type === "command" && e.commands.has(m.name)) { e.commands.get(m.name)!(e, t, NO_PREFIX); continue; }
      if (m?.type === "register") { assignRegister(e, t as CsToken, m.reg, m.key, false); continue; }
      if (m?.type === "char") { out += m.ch === "{" || m.ch === "}" ? "" : m.ch; continue; }
      out += t.noexpand ? "" : `\\${t.name}`;
      continue;
    }
    if (t.kind === "char") {
      if (t.cat === Cat.BeginGroup) { e.beginGroup("brace"); continue; }
      if (t.cat === Cat.EndGroup) { e.endGroup("brace", t); continue; }
      out += isSpace(t) ? " " : t.ch;
    }
  }
  return { out, e };
}

describe("lexer", () => {
  test("control words eat following spaces; control symbols do not", () => {
    expect(lex("\\foo  bar \\% x")).toEqual(["\\foo", "b", "a", "r", "␣", "\\%", "␣", "x"]);
  });
  test("blank line gives \\par; single newline gives a space", () => {
    expect(lex("a\nb\n\nc")).toEqual(["a", "␣", "b", "␣", "\\par", "c"]);
  });
  test("leading spaces on a line are skipped (state N)", () => {
    expect(lex("a\n   b")).toEqual(["a", "␣", "b"]);
  });
  test("comment removes rest of line including newline", () => {
    expect(lex("a% comment\n  b")).toEqual(["a", "b"]);
  });
  test("multiple spaces collapse to one", () => {
    expect(lex("a   b")).toEqual(["a", "␣", "b"]);
  });
  test("@ is a letter only after makeatletter catcode change", () => {
    expect(lex("\\@title")).toEqual(["\\@", "t", "i", "t", "l", "e"]);
    expect(lex("\\@title", { "@": Cat.Letter })).toEqual(["\\@title"]);
  });
  test("active ~ and ^^ notation", () => {
    expect(lex("a~b")).toEqual(["a", "~~", "b"]);
    expect(lex("^^41^^7a")).toEqual(["A", "z"]);
  });
  test("backslash at end of line is a control space", () => {
    expect(lex("a\\\nb")).toEqual(["a", "\\ ", "b"]);
  });
});

describe("expander", () => {
  test("\\def with undelimited parameters", () => {
    expect(run("\\def\\pair#1#2{(#1, #2)}\\pair{a}b").out).toBe("(a, b)");
  });
  test("\\def with delimited parameters", () => {
    expect(run("\\def\\range#1--#2.{from #1 to #2}\\range 3--5.").out).toBe("from 3 to 5");
  });
  test("delimited argument that is one group loses its braces", () => {
    expect(run("\\def\\x#1.{[#1]}\\x{a.b}.").out).toBe("[a.b]");
  });
  test("\\newcommand with optional argument", () => {
    const src = "\\newcommand{\\vect}[2][n]{#2_1..#2_#1}\\vect{x} \\vect[m]{y}";
    expect(run(src).out).toBe("x_1..x_n y_1..y_m");
  });
  test("\\NewDocumentCommand with s o m", () => {
    const src = "\\NewDocumentCommand{\\norm}{s o m}{\\IfBooleanTF{#1}{S}{N}\\IfNoValueTF{#2}{-}{#2}#3}\\norm*{a}\\norm[x]{b}";
    expect(run(src).out).toBe("S-aNxb");
  });
  test("xparse processors and modifiers are skipped in signatures", () => {
    expect(run("\\NewDocumentCommand{\\f}{>{\\SplitList{,}} m !o}{[#1|\\IfNoValueTF{#2}{-}{#2}]}\\f{a,b}[c]").out).toBe("[a,b|c]");
  });
  test("groups scope definitions; \\global escapes", () => {
    expect(run("\\def\\a{1}{\\def\\a{2}\\global\\def\\b{3}}\\a\\b").out).toBe("13");
  });
  test("\\gdef survives an inner local redefinition (TeX retain rule)", () => {
    expect(run("\\def\\a{1}{\\def\\a{2}\\gdef\\a{3}}\\a").out).toBe("3");
  });
  test("\\edef expands at definition time; \\noexpand protects", () => {
    expect(run("\\def\\a{x}\\edef\\b{\\a\\noexpand\\a}\\def\\a{y}\\b").out).toBe("xy");
  });
  test("\\expandafter and \\csname", () => {
    expect(run("\\def\\foo{F}\\expandafter\\def\\csname bar\\endcsname{B}\\bar\\csname foo\\endcsname").out).toBe("BF");
  });
  test("conditionals: \\ifx, \\ifnum, \\ifcase, \\unless, nesting", () => {
    expect(run("\\def\\a{x}\\def\\b{x}\\ifx\\a\\b T\\else F\\fi").out).toBe("T");
    expect(run("\\ifnum 3<2 T\\else F\\fi").out).toBe("F");
    expect(run("\\ifcase 2 zero\\or one\\or two\\else many\\fi").out).toBe("two");
    expect(run("\\ifcase 7 zero\\or one\\else many\\fi").out).toBe("many");
    expect(run("\\unless\\ifnum 1=2 Y\\fi").out).toBe("Y");
    expect(run("\\iffalse \\iftrue a\\else b\\fi c\\else d\\fi").out).toBe("d");
  });
  test("\\newif creates switches", () => {
    expect(run("\\newif\\ifdraft \\ifdraft A\\else B\\fi\\drafttrue\\ifdraft C\\fi").out).toBe("BC");
  });
  test("count registers and arithmetic", () => {
    expect(run("\\newcount\\n \\n=5 \\advance\\n by 3 \\multiply\\n 2 \\the\\n").out).toBe("16");
  });
  test("dimensions print like TeX", () => {
    expect(run("\\newdimen\\d \\d=1in \\the\\d").out).toBe("72.27pt");
    expect(printScaled(65536 * 3.5)).toBe("3.5");
  });
  test("LaTeX counters with resets and \\the formats", () => {
    const src = "\\newcounter{sec}\\newcounter{sub}[sec]\\renewcommand\\thesub{\\thesec.\\arabic{sub}}\\stepcounter{sec}\\stepcounter{sub}\\stepcounter{sub}\\thesub;"
      + "\\stepcounter{sec}\\stepcounter{sub}\\thesub;\\setcounter{sec}{4}\\Roman{sec}\\alph{sub}";
    expect(run(src).out).toBe("1.2;2.1;IVa");
  });
  test("\\makeatletter switches @ to a letter", () => {
    expect(run("\\makeatletter\\def\\@x{Q}\\@x\\makeatother").out).toBe("Q");
  });
  test("\\@ifnextchar and \\@ifstar", () => {
    expect(run("\\makeatletter\\def\\t{\\@ifnextchar[{O}{N}}\\t[x] \\t y").out).toBe("O[x] Ny");
    expect(run("\\makeatletter\\def\\s{\\@ifstar{S}{N}}\\s*a\\s b").out).toBe("SaNb");
  });
  test("\\uppercase and \\MakeUppercase", () => {
    expect(run("\\def\\a{b}\\uppercase{a\\a}\\MakeUppercase{a\\a}").out).toBe("AbAB");
  });
  test("\\string and \\detokenize", () => {
    expect(run("\\string\\foo|\\detokenize{\\x y}").out).toBe("\\foo|\\x y");
  });
  test("runaway recursion hits the depth budget", () => {
    expect(() => run("\\def\\a{x\\a}\\a", { maxDepth: 200 })).toThrow(BudgetError);
  });
  test("tail recursion hits the step budget", () => {
    let err: unknown;
    try { run("\\def\\a{\\a}\\a", { maxSteps: 10_000 }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BudgetError);
    expect((err as BudgetError).message).toContain("\\a");
  });
  test("exponential expansion hits the token budget", () => {
    expect(() => run("\\def\\a#1{#1#1}\\def\\b{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{xxxxxxxx}}}}}}}}}}}}}}}}}\\b", { maxTokens: 100_000 }))
      .toThrow(BudgetError);
  });
  test("expl3 block is skipped with one warning", () => {
    const { out, e } = run("a\\ExplSyntaxOn \\tl_set:Nn \\l_x_tl {y} \\ExplSyntaxOff b");
    expect(out).toBe("ab");
    expect(e.diag.list.map(d => d.code)).toEqual(["W015"]);
  });
  test("\\write18 is never executed and is reported", () => {
    const { e } = run("\\immediate\\write18{rm -rf /}");
    expect(e.diag.list.map(d => d.code)).toContain("W017");
  });
  test("diagnostics render with location, excerpt and caret", () => {
    const { e } = run("ok\n\\ifnum x=1 \\fi");
    const d = e.diag.list.find(x => x.code === "E009")!;
    expect(formatDiagnostic(d, e.sources)).toMatch(/error\[E009\].*\n\s*--> test\.tex:2:\d+\n/);
  });
});
