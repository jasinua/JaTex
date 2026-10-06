import { emptyDocument, type Document } from "@texdocx/model";

const span = { file: "t.tex", start: 0, end: 0 };

export function sampleDocument(): Document {
  const doc = emptyDocument();
  doc.meta.title = [{ kind: "text", text: "Spike & <Test>", marks: {} }];
  doc.meta.authors = [[{ kind: "text", text: "A. Author", marks: {} }]];
  doc.blocks = [
    { kind: "paragraph", role: "title", content: [{ kind: "text", text: "Spike & <Test>", marks: {} }], span },
    { kind: "paragraph", role: "author", content: [{ kind: "text", text: "A. Author", marks: {} }], span },
    { kind: "heading", level: 1, numbered: true, content: [{ kind: "text", text: "Introduction", marks: {} }], label: "sec:intro", span },
    { kind: "paragraph", role: "firstParagraph", span, content: [
      { kind: "text", text: "Plain, ", marks: {} },
      { kind: "text", text: "bold italic", marks: { bold: true, italic: true } },
      { kind: "text", text: " and ", marks: {} },
      { kind: "text", text: "code", marks: { family: "mono" } },
      { kind: "text", text: " with a footnote", marks: {} },
      { kind: "footnote", body: [{ kind: "paragraph", role: "body", span, content: [{ kind: "text", text: "The note.", marks: {} }] }] },
      { kind: "text", text: ". Bad \u0001char removed. Inline ", marks: {} },
      { kind: "math", tree: { k: "sup", base: { k: "atom", text: "x" }, sup: { k: "atom", text: "2" } } },
      { kind: "text", text: ". See Section ", marks: {} },
      { kind: "ref", label: "sec:intro", form: "number", text: "1", target: "sec:intro", targetKind: "heading" },
      { kind: "text", text: " and ", marks: {} },
      { kind: "link", href: "https://example.org/?a=1&b=2", content: [{ kind: "text", text: "a link", marks: {} }] },
      { kind: "text", text: ".", marks: {} },
    ] },
    { kind: "paragraph", role: "body", content: [{ kind: "text", text: "Second paragraph is indented.", marks: {} }], span },
    { kind: "heading", level: 2, numbered: false, content: [{ kind: "text", text: "Unnumbered", marks: {} }], span },
    { kind: "list", style: "enumerate", span, items: [
      { blocks: [{ kind: "paragraph", role: "body", content: [{ kind: "text", text: "First", marks: {} }], span }] },
      { blocks: [
        { kind: "paragraph", role: "body", content: [{ kind: "text", text: "Second", marks: {} }], span },
        { kind: "list", style: "itemize", span, items: [
          { blocks: [{ kind: "paragraph", role: "body", content: [{ kind: "text", text: "Nested bullet", marks: {} }], span }] },
        ] },
      ] },
    ] },
    { kind: "math", tree: { k: "frac", num: { k: "atom", text: "a" }, den: { k: "atom", text: "b" } }, span },
    { kind: "code", text: "for x in xs:\n    print(x)\n", span },
    { kind: "pageBreak" },
    { kind: "paragraph", role: "body", align: "center", content: [{ kind: "text", text: "Centered.", marks: {} }], span },
  ];
  return doc;
}
