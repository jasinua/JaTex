// Security fixtures: untrusted documents must not read outside the project, write files,
// run commands, reach the network, or exhaust resources.

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { compile } from "@texdocx/cli";

function project(files: Record<string, string>): { root: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), "texdocx-sec-"));
  const root = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.tex"), "TOPSECRET");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return { root, outside };
}

const doc = (body: string) => `\\documentclass{article}\\begin{document}${body}\\end{document}`;
const bodyText = (docx: Uint8Array) => strFromU8(unzipSync(docx)["word/document.xml"]);

describe("sandbox", () => {
  test("files inside the project are read", () => {
    const { root } = project({ "chapters/intro.tex": "Included text." });
    const r = compile({ name: "main.tex", text: doc("\\input{chapters/intro}"), root });
    expect(bodyText(r.docx)).toContain("Included text.");
    expect(r.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  });

  test("absolute paths are denied", () => {
    const { root, outside } = project({});
    const r = compile({ name: "main.tex", text: doc(`\\input{${join(outside, "secret.tex")}}`), root });
    expect(bodyText(r.docx)).not.toContain("TOPSECRET");
    expect(r.diagnostics.map(d => d.code)).toContain("E004");
  });

  test("../ escapes are denied", () => {
    const { root } = project({});
    const r = compile({ name: "main.tex", text: doc("\\input{../outside/secret}"), root });
    expect(bodyText(r.docx)).not.toContain("TOPSECRET");
    expect(r.diagnostics.map(d => d.code)).toContain("E004");
  });

  test("denial does not reveal whether files outside the project exist", () => {
    const { root } = project({});
    const a = compile({ name: "main.tex", text: doc("\\input{../outside/secret}"), root });
    const b = compile({ name: "main.tex", text: doc("\\input{../outside/nonexistent}"), root });
    const msg = (r: typeof a) => r.diagnostics.find(d => d.code === "E004")?.message.replace(/\{.*\}/, "{}");
    expect(msg(a)).toBe(msg(b));
  });

  test("symlinks pointing outside the project are denied", () => {
    const { root, outside } = project({});
    symlinkSync(join(outside, "secret.tex"), join(root, "link.tex"));
    const r = compile({ name: "main.tex", text: doc("\\input{link}"), root });
    expect(bodyText(r.docx)).not.toContain("TOPSECRET");
    expect(r.diagnostics.map(d => d.code)).toContain("E004");
  });

  test("remote resources and non-TeX files are denied", () => {
    const { root } = project({ "notes.key": "KEYDATA" });
    const r = compile({ name: "main.tex", text: doc("\\input{https://example.org/x.tex}\\input{notes.key}"), root });
    expect(bodyText(r.docx)).not.toContain("KEYDATA");
    expect(r.diagnostics.filter(d => d.code === "E004")).toHaveLength(2);
  });

  test("without a root, no file can be read", () => {
    const r = compile({ name: "main.tex", text: doc("\\input{anything}") });
    expect(r.diagnostics.map(d => d.code)).toContain("E004");
  });

  test("shell escape and file writes are never performed", () => {
    const r = compile({ name: "main.tex", text: doc("\\immediate\\write18{touch /tmp/pwned}\\newwrite\\f\\immediate\\openout\\f=evil.txt\\write\\f{x}ok") });
    const codes = r.diagnostics.map(d => d.code);
    expect(codes).toContain("W017");
    expect(codes).toContain("W016");
    expect(bodyText(r.docx)).toContain("ok");
  });

  test("macro bombs stop at the budget with a named error", () => {
    const started = Date.now();
    const r = compile({ name: "main.tex", text: doc("\\def\\a{\\a\\a}\\a") });
    expect(Date.now() - started).toBeLessThan(10_000);
    const err = r.diagnostics.find(d => d.code === "E003");
    expect(err?.message).toMatch(/\\a/);
  });

  test("dangerous fields cannot be injected through text", () => {
    const r = compile({ name: "main.tex", text: doc("INCLUDETEXT \"c:/x\" { DDE } <w:instrText>bad</w:instrText>") });
    const xml = bodyText(r.docx);
    expect(xml).not.toMatch(/<w:instrText[^>]*>[^<]*INCLUDETEXT/);
    expect(xml).toContain("&lt;w:instrText&gt;");
  });
});
