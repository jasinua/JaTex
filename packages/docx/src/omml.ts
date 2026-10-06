// MathNode → Office Math Markup Language (namespace prefix m:).

import type { MathNode } from "@texdocx/model";
import { xmlAttr, xmlText } from "./xml.ts";

const MATH_FONT_RPR = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';

function run(n: Extract<MathNode, { k: "atom" }>): string {
  // m:rPr children in schema order: lit, (nor | scr, sty), brk, aln.
  let pr = "";
  if (n.normal) pr += "<m:nor/>";
  else if (n.style) pr += `<m:sty m:val="${n.style}"/>`;
  if (n.aln) pr += "<m:aln/>";
  const mrPr = pr ? `<m:rPr>${pr}</m:rPr>` : "";
  return `<m:r>${mrPr}${n.normal ? "" : MATH_FONT_RPR}<m:t xml:space="preserve">${xmlText(n.text)}</m:t></m:r>`;
}

const arg = (tag: string, n: MathNode | undefined): string => `<m:${tag}>${n ? omml(n) : ""}</m:${tag}>`;
const prop = (tag: string, v: string | number): string => `<m:${tag} m:val="${xmlAttr(String(v))}"/>`;

export function omml(n: MathNode): string {
  switch (n.k) {
    case "row": return n.items.map(omml).join("");
    case "atom": return run(n);
    case "frac":
      return `<m:f>${n.bar === false ? `<m:fPr>${prop("type", "noBar")}</m:fPr>` : ""}${arg("num", n.num)}${arg("den", n.den)}</m:f>`;
    case "sup": return `<m:sSup>${arg("e", n.base)}${arg("sup", n.sup)}</m:sSup>`;
    case "sub": return `<m:sSub>${arg("e", n.base)}${arg("sub", n.sub)}</m:sSub>`;
    case "subsup": return `<m:sSubSup>${arg("e", n.base)}${arg("sub", n.sub)}${arg("sup", n.sup)}</m:sSubSup>`;
    case "pre": return `<m:sPre>${arg("sub", n.sub)}${arg("sup", n.sup)}${arg("e", n.base)}</m:sPre>`;
    case "sqrt":
      return n.index
        ? `<m:rad>${arg("deg", n.index)}${arg("e", n.body)}</m:rad>`
        : `<m:rad><m:radPr>${prop("degHide", 1)}</m:radPr><m:deg/>${arg("e", n.body)}</m:rad>`;
    case "nary":
      return `<m:nary><m:naryPr>${prop("chr", n.op)}${prop("limLoc", n.limits ? "undOvr" : "subSup")}`
        + (n.sub ? "" : prop("subHide", 1)) + (n.sup ? "" : prop("supHide", 1))
        + `</m:naryPr>${arg("sub", n.sub)}${arg("sup", n.sup)}${arg("e", n.body)}</m:nary>`;
    case "delim":
      return `<m:d><m:dPr>${prop("begChr", n.open)}${prop("endChr", n.close)}</m:dPr>`
        + (n.body.length ? n.body.map(b => arg("e", b)).join("") : "<m:e/>") + "</m:d>";
    case "func": return `<m:func>${arg("fName", n.name)}${arg("e", n.body)}</m:func>`;
    case "limLow": return `<m:limLow>${arg("e", n.base)}${arg("lim", n.lim)}</m:limLow>`;
    case "limUpp": return `<m:limUpp>${arg("e", n.base)}${arg("lim", n.lim)}</m:limUpp>`;
    case "acc": return `<m:acc><m:accPr>${prop("chr", n.chr)}</m:accPr>${arg("e", n.body)}</m:acc>`;
    case "bar": return `<m:bar><m:barPr>${prop("pos", n.pos)}</m:barPr>${arg("e", n.body)}</m:bar>`;
    case "groupChr":
      return `<m:groupChr><m:groupChrPr>${prop("chr", n.chr)}${prop("pos", n.pos)}${prop("vertJc", n.pos === "top" ? "bot" : "top")}</m:groupChrPr>${arg("e", n.body)}</m:groupChr>`;
    case "box": return `<m:borderBox>${arg("e", n.body)}</m:borderBox>`;
    case "phantom":
      return `<m:phant><m:phantPr>${prop("show", 0)}${n.width === false ? prop("zeroWid", 1) : ""}`
        + `${n.height === false ? prop("zeroAsc", 1) + prop("zeroDesc", 1) : ""}</m:phantPr>${arg("e", n.body)}</m:phant>`;
    case "matrix": {
      const cols = Math.max(1, ...n.rows.map(r => r.length));
      const jc = (a: string | undefined) => (a === "l" ? "left" : a === "r" ? "right" : "center");
      const mcs = n.align
        ? `<m:mPr><m:mcs>${Array.from({ length: cols }, (_, i) => `<m:mc><m:mcPr>${prop("count", 1)}${prop("mcJc", jc(n.align![i]))}</m:mcPr></m:mc>`).join("")}</m:mcs></m:mPr>`
        : `<m:mPr><m:mcs><m:mc><m:mcPr>${prop("count", cols)}${prop("mcJc", "center")}</m:mcPr></m:mc></m:mcs></m:mPr>`;
      // Word requires every row to have the same number of cells.
      const rows = n.rows.map(r => `<m:mr>${Array.from({ length: cols }, (_, i) => arg("e", r[i])).join("")}</m:mr>`).join("");
      return `<m:m>${mcs}${rows}</m:m>`;
    }
    case "eqArr": return `<m:eqArr>${n.rows.map(r => `<m:e>${lead(r)}${omml(r)}</m:e>`).join("")}</m:eqArr>`;
  }
}

/** First leaf of a formula, to detect a leading relation such as the "= …" row of an align. */
function first(n: MathNode): MathNode | undefined {
  return n.k === "row" ? (n.items[0] ? first(n.items[0]) : undefined) : n;
}

/**
 * A formula that starts with a relation or binary operator (an align row "&= …") gets an empty,
 * zero-width left operand. Word does not need it, but LibreOffice's OMML import treats a bare
 * leading "=" as a syntax error and prints "¿".
 */
function lead(n: MathNode): string {
  const f = first(n);
  return f && f.k === "atom" && (f.cls === "rel" || f.cls === "bin") ? run({ k: "atom", text: "\u200B" }) : "";
}

export const inlineMath = (n: MathNode): string => `<m:oMath>${lead(n)}${omml(n)}</m:oMath>`;
export const displayMath = (n: MathNode): string => `<m:oMathPara><m:oMath>${lead(n)}${omml(n)}</m:oMath></m:oMathPara>`;
