// Structural .docx validator. Stand-in for the Open XML SDK validator until .NET is available in CI:
// it checks the rules that make Word report "unreadable content", not the full XSD.

import { ORDER } from "@texdocx/docx";
import { unzipSync, strFromU8 } from "fflate";
import { SaxesParser } from "saxes";

export interface Issue { part: string; message: string }

export interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }

export function parseXml(xml: string): XNode {
  const parser = new SaxesParser({ xmlns: false });
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  parser.on("opentag", t => {
    const n: XNode = { name: t.name, attrs: t.attributes as Record<string, string>, children: [], text: "" };
    stack[stack.length - 1].children.push(n);
    stack.push(n);
  });
  parser.on("closetag", () => { stack.pop(); });
  parser.on("text", t => { stack[stack.length - 1].text += t; });
  parser.write(xml).close();
  const doc = root.children[0];
  if (!doc) throw new Error("no root element");
  return doc;
}

function* walk(n: XNode): Generator<XNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

const ALLOWED_FIELDS = new Set(["REF", "PAGEREF", "SEQ", "TOC", "PAGE", "NUMPAGES", "STYLEREF", "XE", "INDEX"]);
const ORDERED: Record<string, readonly string[]> = {
  "w:pPr": ORDER.pPr, "w:rPr": ORDER.rPr, "w:sectPr": ORDER.sectPr, "w:style": ORDER.style,
  "w:lvl": ORDER.lvl, "w:abstractNum": ORDER.abstractNum, "w:settings": ORDER.settings, "m:mathPr": ORDER.mathPr,
};

function resolveTarget(sourcePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = sourcePart.includes("/") ? sourcePart.slice(0, sourcePart.lastIndexOf("/") + 1) : "";
  const segs = (base + target).split("/");
  const out: string[] = [];
  for (const s of segs) { if (s === "..") out.pop(); else if (s !== ".") out.push(s); }
  return out.join("/");
}

/** The part that a .rels file describes: word/_rels/document.xml.rels → word/document.xml. */
function relsSource(relsPath: string): string {
  if (relsPath === "_rels/.rels") return "";
  const m = /^(.*)_rels\/([^/]+)\.rels$/.exec(relsPath);
  return m ? m[1] + m[2] : "";
}

export function validateDocx(bytes: Uint8Array): Issue[] {
  const issues: Issue[] = [];
  const add = (part: string, message: string) => issues.push({ part, message });

  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch (e) { return [{ part: "(zip)", message: `not a ZIP: ${(e as Error).message}` }]; }
  const names = Object.keys(files);
  if (names[0] !== "[Content_Types].xml") add("(zip)", `first entry is ${names[0]}, expected [Content_Types].xml`);

  const lower = new Set<string>();
  for (const n of names) {
    if (lower.has(n.toLowerCase())) add(n, "part name differs from another only by case");
    lower.add(n.toLowerCase());
    if (n.startsWith("/") || n.split("/").includes("..")) add(n, "illegal part name");
  }

  // Parse every XML part strictly.
  const xml = new Map<string, XNode>();
  for (const n of names) {
    if (!/\.(xml|rels)$/.test(n)) continue;
    try { xml.set(n, parseXml(strFromU8(files[n]))); }
    catch (e) { add(n, `not well-formed: ${(e as Error).message}`); }
  }

  // Content types.
  const types = xml.get("[Content_Types].xml");
  if (types) {
    const defaults = new Map<string, string>();
    const overrides = new Map<string, string>();
    for (const c of types.children) {
      if (c.name === "Default") defaults.set(c.attrs.Extension.toLowerCase(), c.attrs.ContentType);
      if (c.name === "Override") {
        const p = c.attrs.PartName;
        if (p.endsWith("/")) add("[Content_Types].xml", `Override for a folder: ${p}`);
        if (!names.some(n => "/" + n.toLowerCase() === p.toLowerCase())) add("[Content_Types].xml", `Override for missing part ${p}`);
        overrides.set(p.toLowerCase(), c.attrs.ContentType);
      }
    }
    for (const n of names) {
      if (n === "[Content_Types].xml" || n.endsWith("/")) continue;
      const ext = n.includes(".") ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "";
      if (!overrides.has("/" + n.toLowerCase()) && !defaults.has(ext)) add(n, "part has no content type");
    }
  }

  // Relationships.
  const relIds = new Map<string, Map<string, { type: string; target: string; external: boolean }>>();
  for (const [n, root] of xml) {
    if (!n.endsWith(".rels")) continue;
    const src = relsSource(n);
    const ids = new Map<string, { type: string; target: string; external: boolean }>();
    for (const r of root.children) {
      if (ids.has(r.attrs.Id)) add(n, `duplicate relationship id ${r.attrs.Id}`);
      const external = r.attrs.TargetMode === "External";
      ids.set(r.attrs.Id, { type: r.attrs.Type, target: r.attrs.Target, external });
      if (external) {
        if (!r.attrs.Type.endsWith("/hyperlink")) add(n, `external relationship of type ${r.attrs.Type}`);
      } else if (!(resolveTarget(src, r.attrs.Target) in files)) {
        add(n, `relationship ${r.attrs.Id} targets missing part ${r.attrs.Target}`);
      }
    }
    relIds.set(src, ids);
  }
  const pkgRels = relIds.get("");
  const mainRel = pkgRels && [...pkgRels.values()].find(r => r.type.endsWith("/officeDocument"));
  if (!mainRel) { add("_rels/.rels", "no officeDocument relationship"); return issues; }
  const mainPart = resolveTarget("", mainRel.target);

  // Schema child order in every part.
  for (const [n, root] of xml) {
    for (const node of walk(root)) {
      const order = ORDERED[node.name];
      if (!order) continue;
      let last = -1;
      for (const c of node.children) {
        const i = order.indexOf(c.name);
        if (i < 0) { add(n, `<${c.name}> is not a known child of <${node.name}>`); continue; }
        if (i < last) add(n, `<${c.name}> out of order inside <${node.name}>`);
        last = Math.max(last, i);
      }
    }
  }

  // Cross-part references from the main document and footnotes.
  const styles = xml.get("word/styles.xml");
  const styleIds = new Set<string>();
  if (styles) for (const s of styles.children) if (s.name === "w:style") styleIds.add(s.attrs["w:styleId"]);

  const numbering = xml.get("word/numbering.xml");
  const numIds = new Set<string>(["0"]);
  if (numbering) {
    let seenNum = false;
    for (const c of numbering.children) {
      if (c.name === "w:num") { seenNum = true; numIds.add(c.attrs["w:numId"]); }
      if (c.name === "w:abstractNum" && seenNum) add("word/numbering.xml", "w:abstractNum after w:num");
    }
  }

  const footnoteIds = new Set<string>();
  const footnotes = xml.get("word/footnotes.xml");
  if (footnotes) for (const f of footnotes.children) footnoteIds.add(f.attrs["w:id"]);

  const docPrIds = new Set<string>();
  const bookmarks = new Map<string, string>();     // id → name
  const bookmarkNames = new Set<string>();
  const storyParts = [mainPart, "word/footnotes.xml", ...names.filter(n => /^word\/(header|footer)\d+\.xml$/.test(n))];
  for (const part of storyParts) {
    const root = xml.get(part);
    if (!root) continue;
    const rels = relIds.get(part) ?? new Map();
    let fieldDepth = 0;
    for (const node of walk(root)) {
      const a = node.attrs;
      if (a["r:id"] && !rels.has(a["r:id"])) add(part, `r:id ${a["r:id"]} has no relationship`);
      if (a["r:embed"] && !rels.has(a["r:embed"])) add(part, `r:embed ${a["r:embed"]} has no relationship`);
      switch (node.name) {
        case "w:pStyle": case "w:rStyle":
          if (!styleIds.has(a["w:val"])) add(part, `${node.name} references missing style ${a["w:val"]}`);
          break;
        case "w:numId":
          if (!numIds.has(a["w:val"])) add(part, `numId ${a["w:val"]} missing from numbering.xml`);
          break;
        case "w:footnoteReference":
          if (!footnoteIds.has(a["w:id"])) add(part, `footnote ${a["w:id"]} missing`);
          break;
        case "wp:docPr":
          if (docPrIds.has(a.id)) add(part, `duplicate wp:docPr id ${a.id}`);
          docPrIds.add(a.id);
          break;
        case "w:bookmarkStart": {
          const name = a["w:name"];
          if (name.length > 40 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) add(part, `invalid bookmark name ${name}`);
          if (bookmarkNames.has(name.toLowerCase())) add(part, `duplicate bookmark name ${name}`);
          bookmarkNames.add(name.toLowerCase());
          bookmarks.set(a["w:id"], name);
          break;
        }
        case "w:bookmarkEnd":
          if (!bookmarks.has(a["w:id"])) add(part, `bookmarkEnd ${a["w:id"]} without start`);
          break;
        case "w:fldChar":
          if (a["w:fldCharType"] === "begin") fieldDepth++;
          if (a["w:fldCharType"] === "end") fieldDepth--;
          if (fieldDepth < 0) add(part, "field end without begin");
          break;
        case "w:instrText": {
          const name = node.text.trim().split(/\s+/)[0];
          if (!ALLOWED_FIELDS.has(name)) add(part, `field ${name} is not allowed`);
          break;
        }
        case "w:tc":
          if (!node.children.some(c => c.name === "w:p")) add(part, "table cell without a paragraph");
          break;
        case "w:t": case "m:t": case "w:instrText":
          if (/^\s|\s$/.test(node.text) && a["xml:space"] !== "preserve") add(part, `<${node.name}> with edge whitespace lacks xml:space="preserve"`);
          break;
      }
    }
    if (fieldDepth !== 0) add(part, "unbalanced field characters");
  }
  const body = xml.get(mainPart)?.children.find(c => c.name === "w:body");
  if (body && body.children[body.children.length - 1]?.name !== "w:sectPr") add(mainPart, "w:sectPr is not the last child of w:body");

  return issues;
}
