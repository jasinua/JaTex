import type { Inline, Marks } from "./types.ts";

/** Marks are equal when every property matches; `false` (explicitly off) differs from unset. */
export function sameMarks(a: Marks, b: Marks): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Marks>) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** Appends text, merging with the previous text node when the marks are identical. */
export function pushText(out: Inline[], text: string, marks: Marks): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === "text" && sameMarks(last.marks, marks)) last.text += text;
  else out.push({ kind: "text", text, marks: { ...marks } });
}

/** Plain text of inline content, for metadata (core.xml) and bookmark names. */
export function plainText(content: Inline[]): string {
  let s = "";
  for (const n of content) {
    if (n.kind === "text") s += n.text;
    else if (n.kind === "link") s += plainText(n.content);
    else if (n.kind === "lineBreak" || n.kind === "tab") s += " ";
  }
  return s;
}

/** Removes leading and trailing whitespace across text nodes, dropping nodes that become empty. */
export function trimInlines(content: Inline[]): Inline[] {
  const out = content.map(n => (n.kind === "text" ? { ...n } : n));
  while (out.length) {
    const first = out[0];
    if (first.kind === "text") {
      first.text = first.text.replace(/^[ \t\n]+/, "");
      if (!first.text) { out.shift(); continue; }
    } else if (first.kind === "lineBreak") { out.shift(); continue; }
    break;
  }
  while (out.length) {
    const last = out[out.length - 1];
    if (last.kind === "text") {
      last.text = last.text.replace(/[ \t\n]+$/, "");
      if (!last.text) { out.pop(); continue; }
    } else if (last.kind === "lineBreak") { out.pop(); continue; }
    break;
  }
  return out;
}
