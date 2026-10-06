// Golden tests: every fixture compiles, validates, has no errors, and matches its stored XML.
// Update snapshots deliberately with `pnpm test -u`, then review the diff.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { compile } from "@texdocx/cli";
import { formatDiagnostic } from "@texdocx/core";
import { validateDocx } from "@texdocx/validator";

const dir = fileURLToPath(new URL("./fixtures/tex/", import.meta.url));
const TODAY = new Date(2026, 9, 6);

/** One paragraph/table per line so diffs stay readable. */
export function prettyXml(xml: string): string {
  return xml.replace(/(<w:p>|<w:p |<w:tbl>|<w:sectPr|<\/w:body>|<w:footnote )/g, "\n$1");
}

describe("determinism", () => {
  test("compiling the same input twice gives byte-identical .docx files", () => {
    for (const file of readdirSync(dir).filter(f => f.endsWith(".tex"))) {
      const text = readFileSync(dir + file, "utf8");
      const a = compile({ name: file, text, root: dir, digest: { today: TODAY } }).docx;
      const b = compile({ name: file, text, root: dir, digest: { today: TODAY } }).docx;
      expect(Buffer.from(a).equals(Buffer.from(b)), file).toBe(true);
    }
  });
});

describe("golden fixtures", () => {
  for (const file of readdirSync(dir).filter(f => f.endsWith(".tex")).sort()) {
    const base = file.replace(/\.tex$/, "");
    test(base, async () => {
      const r = compile({ name: file, text: readFileSync(dir + file, "utf8"), root: dir, digest: { today: TODAY } });
      expect(validateDocx(r.docx)).toEqual([]);
      const errors = r.diagnostics.filter(d => d.severity === "error").map(d => formatDiagnostic(d, r.sources));
      expect(errors).toEqual([]);
      const parts = unzipSync(r.docx);
      await expect(prettyXml(strFromU8(parts["word/document.xml"]))).toMatchFileSnapshot(`./golden/${base}.document.xml`);
      if (parts["word/footnotes.xml"]) {
        await expect(prettyXml(strFromU8(parts["word/footnotes.xml"]))).toMatchFileSnapshot(`./golden/${base}.footnotes.xml`);
      }
      const hf = Object.keys(parts).filter(n => /^word\/(header|footer)\d+\.xml$/.test(n)).sort();
      if (hf.some(n => n.includes("header")) || hf.length > 1) {
        await expect(hf.map(n => `<!-- ${n} -->\n` + prettyXml(strFromU8(parts[n]))).join("\n")).toMatchFileSnapshot(`./golden/${base}.headers.xml`);
      }
      const warnings = r.diagnostics.map(d => `${d.code} ${d.message}`).join("\n");
      await expect(warnings + "\n").toMatchFileSnapshot(`./golden/${base}.diagnostics.txt`);
    });
  }
});
