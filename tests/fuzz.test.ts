// Fuzzing (plan: "1 hour of fuzzing finds no hang or crash"). The quick run below is part of
// every `pnpm test`; set FUZZ_RUNS to run longer, e.g. FUZZ_RUNS=200000 for the phase gate.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { digest } from "@texdocx/digest";
import { writeDocx } from "@texdocx/docx";
import { validateDocx } from "@texdocx/validator";

const RUNS = Number(process.env.FUZZ_RUNS ?? 300);
const dir = fileURLToPath(new URL("./fixtures/tex/", import.meta.url));
const fixtures = readdirSync(dir).filter(f => f.endsWith(".tex")).map(f => readFileSync(dir + f, "utf8"));

const PIECES = ["\\", "{", "}", "$", "$$", "&", "#", "#1", "^", "_", "%", "~", "\n", "\n\n", " ", "a", "1", "[", "]", "*",
  "\\def", "\\edef", "\\let", "\\newcommand", "\\renewcommand", "\\newenvironment", "\\begin{itemize}", "\\end{itemize}",
  "\\item", "\\begin{equation}", "\\end{equation}", "\\begin{align}", "\\\\", "\\end{align}", "\\section", "\\label{x}",
  "\\ref{x}", "\\footnote", "\\textbf", "\\emph", "\\verb|", "|", "\\csname", "\\endcsname", "\\expandafter", "\\noexpand",
  "\\if", "\\ifx", "\\else", "\\fi", "\\or", "\\ifcase", "\\ifnum", "<", "=", "\\relax", "\\begingroup", "\\endgroup",
  "\\global", "\\catcode", "`", "\\makeatletter", "\\@ifnextchar", "\\frac", "\\left(", "\\right)", "\\sqrt", "\\input{",
  "\\maketitle", "\\title{", "\\author{", "\\and", "\\begin{document}", "\\end{document}", "\\par", "\\'", "\\c", "--",
  "``", "''", "\\begin{verbatim}", "\\end{verbatim}", "\\url{", "\\href{", "\\newcounter{c}", "\\stepcounter{c}",
  "\\the", "\\count0", "=5", "\\advance", "\\NewDocumentCommand", "{s o m}", "\\mathbb", "\\text{", "\\begin{pmatrix}",
  "\\end{pmatrix}", "\\over", "\\char", "\\uppercase", "\\string", "\\detokenize", "\\ExplSyntaxOn", "\\ExplSyntaxOff",
  "\\begin{enumerate}", "\\end{enumerate}", "\\begin{center}", "\\end{center}", "\\noindent", "\\newif\\ifq", "\\qtrue", "\\ifq"];

function run(src: string): void {
  const r = digest({ name: "fuzz.tex", text: src, engine: { maxSteps: 50_000, maxDepth: 500, maxTokens: 200_000, timeoutMs: 2_000 } });
  const issues = validateDocx(writeDocx(r.doc));
  if (issues.length) throw new Error("invalid output: " + JSON.stringify(issues.slice(0, 3)));
}

describe("fuzz", () => {
  test("random token soup never crashes and always yields a valid .docx", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...PIECES), { maxLength: 60 }), parts => {
      run("\\documentclass{article}\\begin{document}" + parts.join("") + "\\end{document}");
    }), { numRuns: RUNS });
  });

  test("random preamble + body soup", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...PIECES), { maxLength: 40 }), fc.array(fc.constantFrom(...PIECES), { maxLength: 40 }), (a, b) => {
      run(a.join("") + "\\begin{document}" + b.join(""));
    }), { numRuns: RUNS });
  });

  test("mutated fixtures never crash", () => {
    fc.assert(fc.property(fc.constantFrom(...fixtures), fc.array(fc.tuple(fc.nat(), fc.nat(8), fc.constantFrom(...PIECES)), { maxLength: 6 }), (src, edits) => {
      let s = src;
      for (const [at, del, ins] of edits) {
        const i = at % (s.length + 1);
        s = s.slice(0, i) + ins + s.slice(i + del);
      }
      run(s);
    }), { numRuns: RUNS });
  });

  test("arbitrary unicode never crashes", () => {
    fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 200 }), s => {
      run("\\documentclass{article}\\begin{document}" + s + "\\end{document}");
    }), { numRuns: RUNS });
  });

  test("regressions found by the long fuzz run", () => {
    run("\\begin{align}\\label{x}\\end{itemize}\\begin{document}\\begin{align}\\label{x}");
    run("\\documentclass{article}\\begin{document}\\begin{enumerate}\\item a\\label{l}\\item b\\label{l}\\end{enumerate}\\section{s}\\label{l}\\end{document}");
    for (const body of ["\\and\\char", "\\\\noindent~\\char", "\u000e\t\u000e", "\\footnote\\href{"]) {
      expect(() => run("\\documentclass{article}\\begin{document}" + body + "\\end{document}")).not.toThrow();
    }
  });

  test("the engine survives budgets cleanly", () => {
    expect(() => run("\\def\\a{\\a\\a}\\a")).not.toThrow();
  });
});
