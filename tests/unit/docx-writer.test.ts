import { describe, expect, test } from "vitest";
import { strToU8, zipSync, unzipSync, strFromU8 } from "fflate";
import { buildParts, packageDocx, writeDocx } from "@texdocx/docx";
import { emptyDocument } from "@texdocx/model";
import { sampleDocument } from "../fixtures/sample-model.ts";
import { validateDocx } from "@texdocx/validator";

const span = { file: "t.tex", start: 0, end: 0 };

describe("docx writer (phase 0)", () => {
  test("sample document validates with zero issues", () => {
    expect(validateDocx(writeDocx(sampleDocument()))).toEqual([]);
  });

  test("output is byte-identical across runs", () => {
    expect(writeDocx(sampleDocument())).toEqual(writeDocx(sampleDocument()));
  });

  test("[Content_Types].xml is the first ZIP entry", () => {
    const names = Object.keys(unzipSync(writeDocx(sampleDocument())));
    expect(names[0]).toBe("[Content_Types].xml");
  });

  test("illegal XML characters are stripped and markup escaped", () => {
    const doc = buildParts(sampleDocument()).get("word/document.xml") as string;
    expect(doc).not.toContain("\u0001");
    expect(doc).toContain("Spike &amp; &lt;Test&gt;");
  });

  test("lone inline equation gets a zero-width space", () => {
    const d = emptyDocument();
    d.blocks = [{ kind: "paragraph", role: "body", span, content: [{ kind: "math", tree: { k: "atom", text: "x" } }] }];
    expect(buildParts(d).get("word/document.xml") as string).toContain("​");
  });

  test("footnotes part has separators first", () => {
    const fn = buildParts(sampleDocument()).get("word/footnotes.xml") as string;
    expect(fn.indexOf('w:type="separator"')).toBeLessThan(fn.indexOf('w:id="1"'));
  });
});

describe("validator catches broken packages", () => {
  const parts = () => buildParts(sampleDocument());

  test("out-of-order run properties", () => {
    const p = parts();
    p.set("word/document.xml", (p.get("word/document.xml") as string).replace("<w:rPr><w:b/><w:bCs/><w:i/>", "<w:rPr><w:i/><w:b/><w:bCs/>"));
    expect(validateDocx(packageDocx(p)).map(i => i.message)).toContain("<w:b> out of order inside <w:rPr>");
  });

  test("part without content type", () => {
    const p = parts();
    p.set("word/media/image1.png", new Uint8Array([1, 2, 3]));
    expect(validateDocx(packageDocx(p)).some(i => i.message === "part has no content type")).toBe(true);
  });

  test("malformed XML", () => {
    const p = parts();
    p.set("word/styles.xml", "<w:styles><oops></w:styles>");
    expect(validateDocx(packageDocx(p)).some(i => i.message.startsWith("not well-formed"))).toBe(true);
  });

  test("content types not first", () => {
    const files: Record<string, Uint8Array> = {};
    for (const [k, v] of parts()) if (k !== "[Content_Types].xml") files[k] = typeof v === "string" ? strToU8(v) : v;
    files["[Content_Types].xml"] = strToU8(parts().get("[Content_Types].xml") as string);
    expect(validateDocx(zipSync(files)).some(i => i.message.includes("expected [Content_Types].xml"))).toBe(true);
  });

  test("disallowed field", () => {
    const p = parts();
    p.set("word/document.xml", (p.get("word/document.xml") as string).replace(" REF lbl_sec_intro \\w \\h ", " INCLUDETEXT \"x\" "));
    expect(validateDocx(packageDocx(p)).some(i => i.message === "field INCLUDETEXT is not allowed")).toBe(true);
  });

  test("missing style reference", () => {
    const p = parts();
    p.set("word/document.xml", (p.get("word/document.xml") as string).replace('w:val="BodyText"', 'w:val="Nope"'));
    expect(validateDocx(packageDocx(p)).some(i => i.message.includes("missing style Nope"))).toBe(true);
  });

  test("unzip helper sanity", () => {
    expect(strFromU8(unzipSync(writeDocx(sampleDocument()))["word/_rels/document.xml.rels"])).toContain("TargetMode=\"External\"");
  });
});
