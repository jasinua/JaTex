// tabular, tabularx, longtable: column specs, cells, rules, \multicolumn, \multirow.

import { Cat, isSpace, tokensToString, type CsToken, type Loc, type Token } from "@texdocx/core";
import type { Align, Block, Border, ColumnSpec, TableCell, TableRow } from "@texdocx/model";
import type { Container, Digester } from "../digester.ts";
import { lengthPt } from "./text.ts";

interface Col extends ColumnSpec { pre: Token[]; post: Token[] }

interface TableBuilder {
  block: Extract<Block, { kind: "table" }>;
  cols: Col[];
  rows: TableRow[];
  row: TableCell[];
  /** Top borders requested for the current row by \hline, \cline, booktabs rules (per grid column). */
  rowTop: (Border | undefined)[];
  cell: { cell: TableCell; container: Container; col: number; touched: boolean } | null;
  col: number;
  envDepth: number;
  multirows: { row: number; col: number; span: number }[];
  /** longtable sections: rows before \endfirsthead / \endhead / \endfoot / \endlastfoot. */
  sections: { kind: "firsthead" | "head" | "foot" | "lastfoot"; upTo: number }[];
  /** Horizontal rules per row: top from rules before the row, bottom from rules after the last row. */
  rules: Map<TableRow, { top?: (Border | undefined)[]; bottom?: (Border | undefined)[] }>;
  /** The current row held a longtable \caption: it is dropped instead of becoming a table row. */
  captionRow: boolean;
  /** Container holding the table block (where a longtable caption goes, before the table). */
  parent: Container;
  longtable: boolean;
}

const stacks = new WeakMap<Digester, TableBuilder[]>();
const stackOf = (d: Digester): TableBuilder[] => { let s = stacks.get(d); if (!s) stacks.set(d, s = []); return s; };
const current = (d: Digester): TableBuilder | undefined => { const s = stackOf(d); return s[s.length - 1]; };

/** True when `&` or `\\` at this point belongs to table T (not to a nested environment or list). */
function inCell(d: Digester, T: TableBuilder): boolean {
  return !!T.cell && d.envStack.length === T.envDepth && d.top === T.cell.container;
}

/** Parses a column specification into columns. */
export function parseColSpec(d: Digester, toks: Token[], t: Loc): Col[] {
  const cols: Col[] = [];
  let pendingLeft: Border | undefined;
  let pendingPre: Token[] = [];
  const queue = [...toks];
  const next = (): Token | undefined => queue.shift();
  const group = (): Token[] => {
    let u = next();
    while (u && isSpace(u)) u = next();
    if (!u) return [];
    if (!(u.kind === "char" && u.cat === Cat.BeginGroup)) return [u];
    const out: Token[] = [];
    let depth = 0;
    for (let v = next(); v; v = next()) {
      if (v.kind === "char" && v.cat === Cat.BeginGroup) depth++;
      if (v.kind === "char" && v.cat === Cat.EndGroup) { if (depth === 0) break; depth--; }
      out.push(v);
    }
    return out;
  };
  const push = (c: Partial<Col> & { align: Align }) => {
    cols.push({ pre: pendingPre, post: [], left: pendingLeft, ...c });
    pendingPre = [];
    pendingLeft = undefined;
  };
  const twips = (g: Token[]) => Math.round(lengthPt(d, g, t) * 20 * 72 / 72.27);
  let guard = 0;
  for (let u = next(); u; u = next()) {
    if (++guard > 2000) { d.e.diag.error("E003", "column specification expands too far", t); break; }
    if (isSpace(u)) continue;
    const c = u.kind === "char" ? u.ch : u.kind === "cs" ? "\\" + u.name : "";
    const custom = c.length === 1 ? d.e.state.get<Token[]>("coltype:" + c) : undefined;
    if (custom) { queue.unshift(...custom); continue; }
    switch (c) {
      case "l": case "L": push({ align: "left" }); break;
      case "c": case "C": case "S": push({ align: "center" }); break;
      case "r": case "R": push({ align: "right" }); break;
      case "J": push({ align: "justify" }); break;
      case "p": push({ align: "justify", valign: "top", width: twips(group()) }); break;
      case "m": push({ align: "justify", valign: "center", width: twips(group()) }); break;
      case "b": push({ align: "justify", valign: "bottom", width: twips(group()) }); break;
      case "X": push({ align: "justify", flex: true }); break;
      case "D": group(); group(); group(); push({ align: "center" }); break;
      case "|": {
        const prev = cols[cols.length - 1];
        const border: Border = queue[0] && queue[0].kind === "char" && queue[0].ch === "|" ? (next(), "double") : "single";
        if (prev && pendingPre.length === 0) prev.right = border; else pendingLeft = border;
        break;
      }
      case "@": case "!": group(); break;
      case ">": pendingPre = [...pendingPre, ...group()]; break;
      case "<": { const prev = cols[cols.length - 1]; const g = group(); if (prev) prev.post = [...prev.post, ...g]; break; }
      case "*": {
        const n = parseInt(tokensToString(group()).trim(), 10) || 0;
        const body = group();
        const rep: Token[] = [];
        for (let i = 0; i < Math.min(n, 100); i++) rep.push(...body);
        queue.unshift(...rep);
        break;
      }
      default:
        d.warnOnce("colspec:" + c, "W014", `column type '${c}' treated as 'l'`, t);
        push({ align: "left" });
    }
  }
  if (!cols.length) cols.push({ align: "left", pre: [], post: [] });
  return cols;
}

function startRow(T: TableBuilder): void {
  T.row = [];
  T.col = 0;
  T.rowTop = [];
}

function startCell(d: Digester, T: TableBuilder): void {
  const spec = T.cols[Math.min(T.col, T.cols.length - 1)];
  const cell: TableCell = { blocks: [], align: spec?.align, valign: spec?.valign };
  const container = d.pushContainer("cell", cell.blocks);
  d.e.beginGroup("internal");
  d.e.state.set("par:role", "compact");
  d.e.state.set("par:align", undefined);
  d.noIndentNext = true;
  d.afterHeading = false;
  T.cell = { cell, container, col: T.col, touched: false };
  if (spec?.pre.length && T.col < T.cols.length) d.e.pushBack(spec.pre);
}

function endCell(d: Digester, T: TableBuilder): void {
  if (!T.cell) return;
  const spec = T.cols[T.cell.col];
  if (spec?.post.length && !T.cell.cell.colSpan) d.digestTokens(spec.post);
  d.closeParagraph();
  d.e.endGroup("internal");
  d.popUntil(T.cell.container);
  T.row.push(T.cell.cell);
  T.col += T.cell.cell.colSpan ?? 1;
  T.cell = null;
}

function endRow(d: Digester, T: TableBuilder): void {
  endCell(d, T);
  const row: TableRow = { cells: T.row };
  if (T.rowTop.length) T.rules.set(row, { top: [...T.rowTop] });
  if (!T.captionRow) T.rows.push(row);
  T.captionRow = false;
  startRow(T);
}

/** The current cell has no content yet (rules and \multicolumn must come first). */
function cellEmpty(T: TableBuilder): boolean {
  if (!T.cell) return false;
  const p = T.cell.container.para;
  return !T.cell.touched && T.cell.cell.blocks.length === 0 && (!p || p.every(n => n.kind === "text" && !n.text.trim()));
}

function addRule(d: Digester, T: TableBuilder, border: Border, from: number, to: number, t: Loc): void {
  if (!cellEmpty(T) || T.col > 0) {
    d.e.diag.error("E006", "misplaced rule: \\hline and friends must start a row", t);
  }
  for (let c = from; c <= to; c++) T.rowTop[c] = T.rowTop[c] === "single" && border === "single" ? "double" : border;
}

function finishTable(d: Digester, T: TableBuilder): void {
  endRow(d, T);
  const rows = T.rows;
  const ncols = Math.max(T.cols.length, ...rows.map(r => r.cells.reduce((n, c) => n + (c.colSpan ?? 1), 0)));
  // The row after the last \\ is usually empty: drop it, turning its rules into bottom borders.
  const last = rows[rows.length - 1];
  if (last && last.cells.length <= 1 && last.cells.every(c => c.blocks.length === 0)) {
    rows.pop();
    const prev = rows[rows.length - 1];
    const top = T.rules.get(last)?.top;
    if (prev && top) T.rules.set(prev, { ...T.rules.get(prev), bottom: top });
  }
  // longtable: repeated head rows, drop continuation heads and page-break footers.
  if (T.sections.length) {
    const first = T.sections.find(s => s.kind === "firsthead");
    const head = T.sections.find(s => s.kind === "head");
    const foot = T.sections.find(s => s.kind === "foot");
    const lastfoot = T.sections.find(s => s.kind === "lastfoot");
    const headEnd = first ? first.upTo : head ? head.upTo : 0;
    for (let i = 0; i < headEnd && i < rows.length; i++) rows[i].header = true;
    const marks = T.sections.map(s => s.upTo).sort((a, b) => a - b);
    const sectionOf = (i: number) => T.sections.find(s => s.upTo === marks.find(m => i < m));
    const keep: typeof rows = [];
    const tail: typeof rows = [];
    rows.forEach((r, i) => {
      const s = sectionOf(i);
      if (!s || s.kind === "firsthead" || (s.kind === "head" && !first)) keep.push(r);
      else if (s.kind === "lastfoot") tail.push(r);
      else if (s.kind === "foot" && !lastfoot && foot) tail.push(r);
    });
    rows.length = 0;
    rows.push(...keep, ...tail);
  }
  // \multirow: mark the cells it covers as merged continuations.
  const gridCells = (r: TableRow) => {
    const map = new Map<number, TableCell>();
    let col = 0;
    for (const c of r.cells) { map.set(col, c); col += c.colSpan ?? 1; }
    return map;
  };
  for (const m of T.multirows) {
    const span = Math.abs(m.span);
    const top = m.span > 0 ? m.row : m.row + m.span + 1;
    if (top < 0) continue;
    const origin = gridCells(rows[m.row] ?? { cells: [] }).get(m.col);
    const anchor = gridCells(rows[top] ?? { cells: [] }).get(m.col);
    if (!origin || !anchor) continue;
    if (origin !== anchor) { anchor.blocks = origin.blocks; origin.blocks = []; }
    anchor.rowSpan = span;
    for (let r = top + 1; r < top + span && r < rows.length; r++) {
      const c = gridCells(rows[r]).get(m.col);
      if (c) { c.merged = true; c.blocks = []; }
    }
  }
  // Borders: column rules from the spec, row rules from \hline & co.
  rows.forEach(r => {
    let col = 0;
    const { top, bottom } = T.rules.get(r) ?? {};
    r.cells.forEach((c, ci) => {
      const span = c.colSpan ?? 1;
      const b = { ...(c.borders ?? {}) };
      const first = T.cols[col], lastCol = T.cols[col + span - 1];
      if (ci === 0 && first?.left && !b.left) b.left = first.left;
      if (lastCol?.right && !b.right) b.right = lastCol.right;
      if (top) for (let k = col; k < col + span; k++) if (top[k]) { b.top = top[k]; break; }
      if (bottom) for (let k = col; k < col + span; k++) if (bottom[k]) { b.bottom = bottom[k]; break; }
      if (Object.keys(b).length) c.borders = b;
      col += span;
    });
  });
  T.block.columns = Array.from({ length: ncols }, (_, i) => {
    const c = T.cols[i] ?? { align: "left" as Align };
    return { align: c.align, valign: c.valign, width: c.width, flex: c.flex };
  });
  T.block.rows = rows;
}

function beginTable(d: Digester, specToks: Token[], t: CsToken, width?: Token[], longtable = false): void {
  const cols = parseColSpec(d, specToks, t);
  const block: Extract<Block, { kind: "table" }> = { kind: "table", columns: [], rows: [], span: d.span(t) };
  // Like LaTeX: tabular follows \centering / center; longtable is centered by default.
  block.align = d.e.state.get<Align>("par:align") ?? (longtable ? "center" : undefined);
  if (width) block.width = Math.round(lengthPt(d, width, t) * 20 * 72 / 72.27);
  d.addBlock(block);
  if (longtable) d.e.state.set("float:type", "table");
  const T: TableBuilder = { block, cols, rows: [], row: [], rowTop: [], cell: null, col: 0, envDepth: d.envStack.length,
    multirows: [], sections: [], rules: new Map(), captionRow: false, parent: d.top, longtable };
  stackOf(d).push(T);
  startRow(T);
  startCell(d, T);
}

function endTable(d: Digester): void {
  const T = stackOf(d).pop();
  if (!T) return;
  finishTable(d, T);
}

export function installTables(d: Digester): void {
  d.onAlignTab = (t: Loc) => {
    const T = current(d);
    if (!T || !inCell(d, T)) return false;
    endCell(d, T);
    if (T.col >= T.cols.length) d.e.diag.error("E006", "extra alignment tab: more cells than columns", t);
    startCell(d, T);
    return true;
  };
  d.placeCaption = (b: Block) => {
    const T = current(d);
    if (!T || !T.longtable || !inCell(d, T)) return false;
    const i = T.parent.blocks.indexOf(T.block);
    T.parent.blocks.splice(i < 0 ? T.parent.blocks.length : i, 0, b);
    T.captionRow = true;
    return true;
  };
  d.onRowEnd = () => {
    const T = current(d);
    if (!T || !inCell(d, T)) return false;
    endRow(d, T);
    startCell(d, T);
    return true;
  };

  for (const name of ["tabular", "tabular*", "tabularx", "tabulary", "longtable", "longtable*", "xltabular", "tabu", "supertabular", "array", "NiceTabular", "tblr"]) {
    const sig = name === "tabular*" || name === "tabularx" || name === "tabulary" || name === "xltabular" ? "o m o m"
      : name === "longtable" || name === "longtable*" ? "o m" : name === "tabu" ? "o m" : "o m";
    d.env(name, { sig, mode: "block", display: true,
      begin: (d, args, t) => {
        const width = args.length === 4 ? args[1].tokens : undefined;
        beginTable(d, args[args.length - 1].tokens, t, width, name.startsWith("longtable") || name === "xltabular" || name === "supertabular");
      },
      end: d => endTable(d),
    });
  }

  const rule = (border: Border) => (d: Digester, _a: unknown, t: CsToken) => {
    const T = current(d);
    if (!T) return;
    addRule(d, T, border, 0, Math.max(T.cols.length - 1, 0), t);
  };
  d.def("hline", { run: rule("single") });
  d.def("toprule", { sig: "o", run: rule("thick") });
  d.def("bottomrule", { sig: "o", run: rule("thick") });
  d.def("midrule", { sig: "o", run: rule("thin") });
  d.def("specialrule", { sig: "m m m", run: rule("thick") });
  d.def("hdashline", { run: rule("single") });
  d.def("Xhline", { sig: "m", run: rule("thick") });
  const partial = (border: Border) => (d: Digester, args: { tokens: Token[] }[], t: CsToken) => {
    const T = current(d);
    if (!T) return;
    const m = /(\d+)\s*-\s*(\d+)/.exec(tokensToString(args[args.length - 1].tokens));
    if (m) addRule(d, T, border, Number(m[1]) - 1, Number(m[2]) - 1, t);
  };
  d.def("cline", { sig: "m", run: partial("single") });
  d.def("cmidrule", { sig: "o d() m", run: partial("thin") });
  d.def("cdashline", { sig: "m", run: partial("single") });
  for (const name of ["addlinespace", "morecmidrules", "arraybackslash", "noalign", "rowcolor", "cellcolor", "rowcolors", "arrayrulecolor"]) {
    const sig = name === "addlinespace" ? "o" : name === "rowcolor" || name === "cellcolor" ? "o m" : name === "rowcolors" ? "o m m m" : name === "arrayrulecolor" ? "o m" : name === "noalign" ? "m" : "";
    d.def(name, { sig, run: () => {} });
  }
  d.def("tabularnewline", { run: d => { if (!d.onRowEnd?.({ file: -1, pos: 0 })) d.inline({ kind: "lineBreak" }); } });

  d.def("multicolumn", { sig: "m m m", run: (d, [n, spec, body], t) => {
    const T = current(d);
    const span = parseInt(d.argString(n), 10) || 1;
    if (!T || !T.cell) { d.digestTokens(body.tokens); return; }
    if (!cellEmpty(T)) d.e.diag.error("E006", "\\multicolumn must start a cell", t);
    const [col] = parseColSpec(d, spec.tokens, t);
    const cell = T.cell.cell;
    cell.colSpan = span;
    cell.align = col.align;
    cell.borders = { ...(cell.borders ?? {}), ...(col.left ? { left: col.left } : {}), ...(col.right ? { right: col.right } : {}) };
    T.cell.touched = true;
    d.withMarks(m => m, () => { if (col.pre.length) d.digestTokens(col.pre); d.digestTokens(body.tokens); if (col.post.length) d.digestTokens(col.post); });
  } });
  d.def("multirow", { sig: "o m o m o m", run: (d, [, n, , , , body]) => {
    const T = current(d);
    const span = parseInt(d.argString(n), 10) || 1;
    if (T && T.cell && Math.abs(span) > 1) T.multirows.push({ row: T.rows.length, col: T.cell.col, span });
    if (T?.cell) T.cell.touched = true;
    d.digestTokens(body.tokens);
  } });
  for (const kind of ["firsthead", "head", "foot", "lastfoot"] as const) {
    d.def("end" + kind, { run: () => {
      const T = current(d);
      if (!T) return;
      // Rules between the section's last row and \endhead belong under that row.
      const prev = T.rows[T.rows.length - 1];
      if (prev && T.rowTop.length && cellEmpty(T) && T.col === 0) {
        T.rules.set(prev, { ...T.rules.get(prev), bottom: [...T.rowTop] });
        T.rowTop = [];
      }
      T.sections.push({ kind, upTo: T.rows.length });
    } });
  }
  d.def("newcolumntype", { sig: "m o m", run: (d, [name, , body]) => {
    const key = tokensToString(name.tokens).trim();
    if (key.length === 1) d.e.state.set("coltype:" + key, body.tokens, true);
  } });
}
