// Page styles: \pagestyle, \thispagestyle, fancyhdr, \pagenumbering, \frontmatter/\mainmatter.
// Rendered as Word headers/footers with PAGE, NUMPAGES and STYLEREF fields.

import { csTok, tokensToString, type Token } from "@texdocx/core";
import type { HeaderFooterSlots, Inline, PageNumbering, PageStyle } from "@texdocx/model";
import type { Digester } from "../digester.ts";

type Slot = "headL" | "headC" | "headR" | "footL" | "footC" | "footR";

const NUMBERING: Record<string, PageNumbering["format"]> = {
  arabic: "decimal", roman: "lowerRoman", Roman: "upperRoman", alph: "lowerLetter", Alph: "upperLetter",
};

const page = (): Inline => ({ kind: "field", field: "page" });

/** Built-in LaTeX page styles. */
function builtin(name: string): PageStyle | undefined {
  switch (name) {
    case "empty": return {};
    case "plain": return { footer: { center: [page()] } };
    case "headings": case "myheadings":
      return { header: { left: [{ kind: "field", field: "section" }], right: [page()] } };
    default: return undefined;
  }
}

export function installPageStyles(d: Digester): void {
  const e = d.e;
  const slots = new Map<Slot, Token[]>();
  let fancyTouched = false;
  let first: string | undefined;

  const setSlots = (which: string, kind: "head" | "foot" | "both", toks: Token[]) => {
    fancyTouched = true;
    const spec = which.toUpperCase().replace(/[EO]/g, "");
    const want = (s: string) => !spec || spec.includes(s);
    for (const pos of ["L", "C", "R"]) {
      if (!want(pos)) continue;
      const hf = kind === "both" ? (spec.includes("H") ? ["head"] : spec.includes("F") ? ["foot"] : ["head", "foot"]) : [kind];
      for (const k of hf) slots.set(`${k}${pos}` as Slot, toks);
    }
  };

  d.def("pagestyle", { sig: "m", run: (d, [a]) => e.state.set("pagestyle", d.argString(a), true) });
  d.def("thispagestyle", { sig: "m", run: (d, [a]) => {
    // Only the first page can carry its own style in this mapping (title pages).
    const hasBreak = d.doc.blocks.some(b => b.kind === "pageBreak" || b.kind === "sectionBreak");
    if (!hasBreak) first = d.argString(a);
  } });
  d.def("fancyhead", { sig: "o m", run: (d, [w, a]) => setSlots(w.present ? d.argString(w) : "", "head", a.tokens) });
  d.def("fancyfoot", { sig: "o m", run: (d, [w, a]) => setSlots(w.present ? d.argString(w) : "", "foot", a.tokens) });
  d.def("fancyhf", { sig: "o m", run: (d, [w, a]) => setSlots(w.present ? d.argString(w) : "", "both", a.tokens) });
  for (const [cmd, slot] of [["lhead", "headL"], ["chead", "headC"], ["rhead", "headR"], ["lfoot", "footL"], ["cfoot", "footC"], ["rfoot", "footR"]] as const) {
    d.def(cmd, { sig: "o m", run: (_d, [, a]) => { fancyTouched = true; slots.set(slot, a.tokens); } });
  }

  const numbering = (d: Digester, style: string) => {
    const format = NUMBERING[style];
    if (!format) return;
    const n: PageNumbering = { format, start: 1 };
    if (!d.inDocument || !d.doc.blocks.some(b => b.kind !== "paragraph" || b.role !== "title")) { d.doc.pageNumbering = n; return; }
    d.closeParagraph();
    // \clearpage\pagenumbering{…}: the section break replaces the page break (no blank page).
    const blocks = d.top.blocks;
    if (blocks[blocks.length - 1]?.kind === "pageBreak") blocks.pop();
    d.addBlock({ kind: "sectionBreak", numbering: n });
  };
  d.def("pagenumbering", { sig: "m", run: (d, [a]) => numbering(d, d.argString(a)) });
  d.def("frontmatter", { run: d => { e.state.set("@mainmatter", false, true); numbering(d, "roman"); } });
  d.def("mainmatter", { run: d => { e.state.set("@mainmatter", true, true); numbering(d, "arabic"); } });
  d.def("backmatter", { run: () => { e.state.set("@mainmatter", false, true); } });

  // Field commands used while capturing header/footer content.
  d.def("\u0000field:page", { mode: "inline", run: d => d.inline(page()) });
  d.def("\u0000field:numpages", { mode: "inline", run: d => d.inline({ kind: "field", field: "numpages" }) });
  d.def("\u0000field:section", { mode: "inline", run: d => d.inline({ kind: "field", field: "section" }) });
  d.def("\u0000field:subsection", { mode: "inline", run: d => d.inline({ kind: "field", field: "subsection" }) });

  /** Header content: \thepage, \leftmark, \rightmark and \pageref{LastPage} become Word fields. */
  const capture = (toks: Token[] | undefined): Inline[] | undefined => {
    if (!toks) return undefined;
    e.beginGroup("internal");
    const cmd = (name: string) => ({ type: "command" as const, name });
    e.define("thepage", cmd("\u0000field:page"));
    e.define("leftmark", cmd("\u0000field:section"));
    e.define("rightmark", cmd("\u0000field:subsection"));
    e.define("lastpage", cmd("\u0000field:numpages"));
    // \pageref{LastPage} (lastpage package) is the page count.
    const toksFixed: Token[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.kind === "cs" && t.name === "pageref") {
        let depth = 0, j = i + 1, arg = "";
        for (; j < toks.length; j++) {
          const u = toks[j];
          if (u.kind === "char" && u.ch === "{") { if (depth++ === 0) continue; }
          if (u.kind === "char" && u.ch === "}") { if (--depth === 0) break; }
          if (depth > 0) arg += tokensToString([u]);
          else if (!(u.kind === "char" && u.ch === " ")) break;
        }
        if (arg.trim() === "LastPage") { toksFixed.push(csTok("\u0000field:numpages")); i = j; continue; }
      }
      toksFixed.push(t);
    }
    const out = d.captureInline(toksFixed);
    e.endGroup("internal");
    return out.length ? out : undefined;
  };

  const resolve = (name: string): PageStyle => {
    if (name === "fancy" || name === "fancyplain") {
      if (!fancyTouched) {
        // fancyhdr's defaults for one-sided documents.
        slots.set("headL", [csTok("slshape"), csTok("leftmark")]);
        slots.set("headR", [csTok("slshape"), csTok("rightmark")]);
        slots.set("footC", [csTok("thepage")]);
      }
      const slotsOf = (k: "head" | "foot"): HeaderFooterSlots | undefined => {
        const s: HeaderFooterSlots = { left: capture(slots.get(`${k}L`)), center: capture(slots.get(`${k}C`)), right: capture(slots.get(`${k}R`)) };
        return s.left || s.center || s.right ? s : undefined;
      };
      return { header: slotsOf("head"), footer: slotsOf("foot") };
    }
    return builtin(name) ?? builtin("plain")!;
  };

  d.finishers.push(() => {
    const name = e.state.get<string>("pagestyle") ?? (d.doc.docClass.sectionLevel === 2 && d.doc.docClass.name !== "report" ? "headings" : "plain");
    d.doc.pageStyle = resolve(name);
    if (first && first !== name) d.doc.firstPageStyle = resolve(first);
    else if (!first && d.e.state.get("@maketitle") && name !== "plain" && name !== "empty") d.doc.firstPageStyle = resolve("plain");
  });
}
