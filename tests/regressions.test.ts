// Bugs confirmed by the user-guide review workflow (2026-10-06), one test each.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { compile } from "@texdocx/cli";

const doc = (pre: string, body: string) => `\\documentclass{article}${pre}\\begin{document}${body}\\end{document}`;
const xml = (docx: Uint8Array) => strFromU8(unzipSync(docx)["word/document.xml"]);
const mathText = (x: string) => [...x.matchAll(/<m:t[^>]*>([^<]*)<\/m:t>/g)].map(m => m[1]).join("");

describe("review regressions", () => {
  test("dotfiles and extension-less files are never read", () => {
    const root = mkdtempSync(join(tmpdir(), "texdocx-reg-"));
    writeFileSync(join(root, ".env"), "DOTVALUE");
    writeFileSync(join(root, "idtest"), "NOEXTVALUE");
    mkdirSync(join(root, "sub"));
    const r = compile({ name: "m.tex", text: doc("", "\\input{.env}\\input{idtest}\\input{sub/../.env}\\includegraphics{.env}"), root });
    const body = xml(r.docx);
    expect(body).not.toContain("DOTVALUE");
    expect(body).not.toContain("NOEXTVALUE");
    expect(r.diagnostics.filter(d => d.code === "E004").length).toBeGreaterThanOrEqual(3);
  });

  test("\\text in math keeps its surrounding spaces", () => {
    const r = compile({ name: "m.tex", text: doc("\\usepackage{amsmath}", "$a \\text{ if } b$") });
    expect(mathText(xml(r.docx))).toBe("a if b");
  });

  test("\\label after a plain \\refstepcounter does not bind to the previous heading", () => {
    const r = compile({ name: "m.tex", text: doc("\\newcounter{cp}", "\\section{Sec}\\refstepcounter{cp}Item\\label{a}\\par See \\ref{a}.") });
    const body = xml(r.docx);
    expect(body).not.toContain("REF lbl_a \\w");
    expect(body).not.toContain("bookmarkStart");
    expect(body.replace(/<[^>]+>/g, "")).toContain("See 1.");
  });

  test("a matrix inside a display row keeps the row's \\label and \\notag", () => {
    const src = doc("\\usepackage{amsmath}", "\\begin{equation}\\label{eq:a} y=\\begin{cases}1&a\\\\0&b\\end{cases}\\end{equation}"
      + "\\begin{align} a&=\\begin{pmatrix}1\\end{pmatrix}\\notag\\\\ b&=c\\end{align} See \\eqref{eq:a}.");
    const r = compile({ name: "m.tex", text: src });
    expect(r.diagnostics.map(d => d.code)).not.toContain("W020");
    const body = xml(r.docx);
    expect(body).toContain('w:name="lbl_eq_a"');
    expect([...body.matchAll(/SEQ Equation/g)]).toHaveLength(2);
  });

  test("\\verb is upright medium typewriter inside italic and bold", () => {
    const body = xml(compile({ name: "m.tex", text: doc("", "{\\itshape\\bfseries A \\verb|x| B}") }).docx);
    expect(body).toMatch(/<w:rPr><w:rStyle w:val="VerbatimChar"\/><w:b w:val="0"\/><w:bCs w:val="0"\/><w:i w:val="0"\/><w:iCs w:val="0"\/><\/w:rPr><w:t>x<\/w:t>/);
  });

  test("\\scalebox and \\resizebox size the pictures inside them", () => {
    const root = join(process.cwd(), "tests/fixtures/tex");
    const body = xml(compile({ name: "m.tex", root, text: doc("\\usepackage{graphicx}",
      "\\scalebox{0.5}{\\includegraphics{figs/plot}} \\resizebox{2in}{!}{\\includegraphics{figs/plot}}") }).docx);
    const cx = [...body.matchAll(/<wp:extent cx="(\d+)"/g)].map(m => Number(m[1]));
    expect(Math.abs(cx[0] - 2 * 914400)).toBeLessThan(914400 * 0.01);   // 4in natural → 2in
    expect(Math.abs(cx[1] - 2 * 914400)).toBeLessThan(2 * 914400 * 0.01);
  });
});
