// Prints a .docx body as readable lines: [Style numId/ilvl] text, with run formatting marked.
// Usage: node tools/smoke/src/dump.ts file.docx
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { parseXml, type XNode } from "@texdocx/validator";

const file = process.argv[2];
const parts = unzipSync(new Uint8Array(readFileSync(file)));
const body = parseXml(strFromU8(parts["word/document.xml"])).children.find(c => c.name === "w:body")!;

const kids = (n: XNode, name: string) => n.children.filter(c => c.name === name);
const attr = (n: XNode | undefined, name: string) => n?.attrs[name];

function mathText(n: XNode): string {
  if (n.name === "m:t") return n.text;
  const inner = n.children.map(mathText).join("");
  switch (n.name) {
    case "m:f": return `(${mathText(n.children.find(c => c.name === "m:num")!)})/(${mathText(n.children.find(c => c.name === "m:den")!)})`;
    case "m:sSup": return `${mathText(n.children[0])}^{${mathText(n.children[1])}}`;
    case "m:sSub": return `${mathText(n.children[0])}_{${mathText(n.children[1])}}`;
    case "m:sSubSup": return `${mathText(n.children[0])}_{${mathText(n.children[1])}}^{${mathText(n.children[2])}}`;
    case "m:rad": return `√(${mathText(n.children.find(c => c.name === "m:e")!)})`;
    case "m:nary": {
      const chr = attr(n.children[0].children.find(c => c.name === "m:chr"), "m:val") ?? "∫";
      return `${chr}_{${mathText(n.children[1])}}^{${mathText(n.children[2])}}[${mathText(n.children[3])}]`;
    }
    case "m:d": {
      const pr = n.children.find(c => c.name === "m:dPr");
      const beg = attr(pr?.children.find(c => c.name === "m:begChr"), "m:val") ?? "(";
      const end = attr(pr?.children.find(c => c.name === "m:endChr"), "m:val") ?? ")";
      return beg + kids(n, "m:e").map(mathText).join("|") + end;
    }
    case "m:func": return `${mathText(n.children[0])} ${mathText(n.children[1])}`;
    case "m:acc": return `acc(${mathText(n.children[1])})`;
    case "m:m": return "[" + kids(n, "m:mr").map(r => kids(r, "m:e").map(mathText).join(", ")).join("; ") + "]";
    case "m:eqArr": return "{" + kids(n, "m:e").map(mathText).join(" \\\\ ") + "}";
    case "m:rPr": case "w:rPr": case "m:dPr": case "m:naryPr": case "m:radPr": case "m:fPr": case "m:accPr": return "";
    default: return inner;
  }
}

function runs(p: XNode): string {
  let out = "";
  let inField = 0, fieldInstr = "";
  for (const c of p.children) {
    if (c.name === "w:pPr") continue;
    if (c.name === "w:hyperlink") { out += `<link ${attr(c, "w:anchor") ?? attr(c, "r:id")}>${runs(c)}</link>`; continue; }
    if (c.name === "m:oMath" || c.name === "m:oMathPara") { out += `$${mathText(c)}$`; continue; }
    if (c.name === "w:bookmarkStart") { out += `⟦${attr(c, "w:name")}:`; continue; }
    if (c.name === "w:bookmarkEnd") { out += "⟧"; continue; }
    if (c.name !== "w:r") continue;
    const pr = c.children.find(x => x.name === "w:rPr");
    const flags = (pr?.children ?? []).map(x => {
      const v = attr(x, "w:val");
      if (x.name === "w:b") return v === "0" ? "-b" : "b";
      if (x.name === "w:i") return v === "0" ? "-i" : "i";
      if (x.name === "w:rStyle") return v === "VerbatimChar" ? "tt" : v ?? "";
      if (x.name === "w:smallCaps") return "sc";
      if (x.name === "w:u") return "u";
      if (x.name === "w:sz") return "sz" + v;
      if (x.name === "w:color") return "#" + v;
      if (x.name === "w:vertAlign") return v === "superscript" ? "sup" : "sub";
      if (x.name === "w:rFonts") return attr(x, "w:ascii") ?? "";
      return "";
    }).filter(f => f && f !== "bCs" && f !== "iCs");
    for (const x of c.children) {
      if (x.name === "w:fldChar") {
        const t = attr(x, "w:fldCharType");
        if (t === "begin") { inField++; fieldInstr = ""; }
        if (t === "separate") out += `{${fieldInstr.trim()}:`;
        if (t === "end") { out += "}"; inField--; }
      }
      if (x.name === "w:instrText") fieldInstr += x.text;
      if (x.name === "w:t") out += flags.length ? `[${[...new Set(flags)].join(",")}:${x.text}]` : x.text;
      if (x.name === "w:tab") out += "⇥";
      if (x.name === "w:br") out += attr(x, "w:type") === "page" ? "⏎PAGE" : "↵";
      if (x.name === "w:footnoteReference") out += `^fn${attr(x, "w:id")}`;
      if (x.name === "w:drawing") {
        const ext = x.children[0]?.children.find(c => c.name === "wp:extent");
        const cm = (v: string | undefined) => (Number(v) / 360000).toFixed(1);
        out += `🖼(${cm(attr(ext, "cx"))}×${cm(attr(ext, "cy"))}cm)`;
      }
      if (x.name === "w:footnoteRef") out += "^";
    }
  }
  void inField;
  return out;
}

function borders(tc: XNode): string {
  const b = tc.children.find(c => c.name === "w:tcPr")?.children.find(c => c.name === "w:tcBorders");
  if (!b) return "";
  return b.children.map(x => x.name.slice(2, 3).toUpperCase() + (attr(x, "w:val") === "double" ? "2" : attr(x, "w:sz") === "8" ? "!" : "")).join("");
}

function table(tbl: XNode, indent: string): void {
  console.log(`${indent}<table grid=[${tbl.children.find(c => c.name === "w:tblGrid")?.children.map(g => attr(g, "w:w")).join(",")}]>`);
  for (const tr of kids(tbl, "w:tr")) {
    const hdr = tr.children.find(c => c.name === "w:trPr")?.children.some(c => c.name === "w:tblHeader") ? "H" : " ";
    const cells = kids(tr, "w:tc").map(tc => {
      const pr = tc.children.find(c => c.name === "w:tcPr");
      const span = attr(pr?.children.find(c => c.name === "w:gridSpan"), "w:val");
      const vm = pr?.children.find(c => c.name === "w:vMerge");
      const tag = (span ? `⇔${span}` : "") + (vm ? (attr(vm, "w:val") === "restart" ? "⇕" : "↑") : "") + (borders(tc) ? `{${borders(tc)}}` : "");
      return tag + kids(tc, "w:p").map(runs).join(" ¶ ");
    });
    console.log(`${indent}  ${hdr}| ${cells.join(" | ")} |`);
  }
}

for (const p of body.children) {
  if (p.name === "w:tbl") { table(p, ""); continue; }
  if (p.name !== "w:p") { if (p.name !== "w:sectPr") console.log(`<${p.name}>`); continue; }
  const pPr = p.children.find(c => c.name === "w:pPr");
  const style = attr(pPr?.children.find(c => c.name === "w:pStyle"), "w:val") ?? "Normal";
  const numPr = pPr?.children.find(c => c.name === "w:numPr");
  const num = numPr ? ` #${attr(numPr.children.find(c => c.name === "w:numId"), "w:val")}/${attr(numPr.children.find(c => c.name === "w:ilvl"), "w:val")}` : "";
  const jc = attr(pPr?.children.find(c => c.name === "w:jc"), "w:val");
  console.log(`[${style}${num}${jc ? " " + jc : ""}] ${runs(p)}`);
}
