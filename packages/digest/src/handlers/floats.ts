// Floats, captions and graphics: figure/table environments, \caption, \includegraphics.

import { Cat, csTok, isSpace, refStepCounter, tokensToString, type CsToken, type Loc, type Token } from "@texdocx/core";
import type { Block, Caption, ImageRef } from "@texdocx/model";
import type { Container, Digester } from "../digester.ts";
import { imageInfo } from "../images.ts";
import { lengthPt } from "./text.ts";

const FLOATS: [string, "figure" | "table", string][] = [
  ["figure", "figure", "o"], ["figure*", "figure", "o"], ["table", "table", "o"], ["table*", "table", "o"],
  ["wrapfigure", "figure", "o o m o m"], ["wraptable", "table", "o o m o m"], ["SCfigure", "figure", "o o"],
  ["sidewaysfigure", "figure", "o"], ["sidewaystable", "table", "o"], ["figwindow", "figure", "o"],
];

/** Splits key=value options at top-level commas, keeping values as tokens. */
export function keyValTokens(toks: Token[]): Map<string, Token[]> {
  const out = new Map<string, Token[]>();
  let depth = 0;
  let cur: Token[] = [];
  const flush = () => {
    const i = cur.findIndex(t => t.kind === "char" && t.ch === "=" && t.cat !== Cat.BeginGroup);
    const key = tokensToString(i < 0 ? cur : cur.slice(0, i)).trim();
    let v = i < 0 ? [] : cur.slice(i + 1);
    while (v.length && isSpace(v[0])) v = v.slice(1);
    while (v.length && isSpace(v[v.length - 1])) v = v.slice(0, -1);
    if (v.length >= 2 && v[0].kind === "char" && v[0].cat === Cat.BeginGroup && v[v.length - 1].kind === "char" && (v[v.length - 1] as { cat: number }).cat === Cat.EndGroup) v = v.slice(1, -1);
    if (key) out.set(key, v);
    cur = [];
  };
  for (const t of toks) {
    if (t.kind === "char" && t.cat === Cat.BeginGroup) depth++;
    if (t.kind === "char" && t.cat === Cat.EndGroup) depth--;
    if (depth === 0 && t.kind === "char" && t.ch === ",") { flush(); continue; }
    cur.push(t);
  }
  flush();
  return out;
}

const EMU_PER_BP = 12700;

function textWidthEmu(d: Digester): number {
  const p = d.doc.page;
  return Math.round((p.width - p.margin.left - p.margin.right) / p.columns * 635);
}

function loadImage(d: Digester, name: string, opts: Map<string, Token[]>, t: Loc): ImageRef | string {
  const read = d.e.opts.readFile;
  if (!read) { d.e.diag.error("E004", `\\includegraphics{${name}}: file access is disabled`, t); return name; }
  const searchPaths = d.e.state.get<string[]>("graphicspath") ?? [];
  const req = { path: name, from: t, command: "includegraphics", binary: true, searchPaths,
    extensions: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".bmp", ".pdf", ".eps", ""] };
  let r = read(req);
  if ("error" in r) { d.e.diag.error(r.error === "denied" ? "E004" : "E005", r.message, t); return name; }
  if (/\.(pdf|e?ps)$/i.test(r.name)) {
    // PDF and EPS are not valid Word images: use a raster or SVG twin with the same name if present.
    const base = name.replace(/\.(pdf|e?ps)$/i, "");
    const twin = read({ ...req, path: base, extensions: [".png", ".svg", ".jpg", ".jpeg"] });
    if ("error" in twin || /\.(pdf|e?ps)$/i.test(twin.name)) {
      d.warnOnce("pdf:" + name, "W014", `${r.name}: PDF/EPS figures cannot be embedded in .docx; a placeholder was inserted`, t,
        `export the figure as PNG or SVG next to it (${base}.png)`);
      return name;
    }
    r = twin;
  }
  const data = r.data ?? new Uint8Array();
  const info = imageInfo(data);
  if (!info) { d.warnOnce("img:" + name, "W014", `${r.name}: unsupported or damaged image; a placeholder was inserted`, t); return name; }

  const bp = (toks: Token[] | undefined) => (toks && toks.length ? lengthPt(d, toks, t) * 72 / 72.27 : undefined);
  let w = info.widthBp, h = info.heightBp;
  const scale = opts.get("scale");
  if (scale) { const s = parseFloat(tokensToString(scale)) || 1; w *= s; h *= s; }
  const W = bp(opts.get("width")), H = bp(opts.get("height") ?? opts.get("totalheight"));
  const keep = opts.has("keepaspectratio") && tokensToString(opts.get("keepaspectratio")!).trim() !== "false";
  if (W && H && keep) { const k = Math.min(W / w, H / h); w *= k; h *= k; }
  else if (W && H) { w = W; h = H; }
  else if (W) { h = h * W / w; w = W; }
  else if (H) { w = w * H / h; h = H; }
  // An enclosing \resizebox / \scalebox.
  const boxW = bp(d.e.state.get<Token[]>("img:width")), boxH = bp(d.e.state.get<Token[]>("img:height"));
  if (boxW && boxH) { w = boxW; h = boxH; }
  else if (boxW) { h = h * boxW / w; w = boxW; }
  else if (boxH) { w = w * boxH / h; h = boxH; }
  const boxScale = d.e.state.get<number>("img:scale");
  if (boxScale) { w *= boxScale; h *= boxScale; }
  if (opts.has("angle")) d.warnOnce("angle", "W014", "image rotation (angle=) is not applied", t);
  if (opts.has("trim") || opts.has("viewport")) d.warnOnce("trim", "W014", "image trimming (trim=, viewport=) is not applied", t);

  let cx = Math.round(w * EMU_PER_BP), cy = Math.round(h * EMU_PER_BP);
  const max = textWidthEmu(d);
  if (cx > max) { cy = Math.round(cy * max / cx); cx = max; }
  const base = r.name.split("/").pop() ?? r.name;
  return { data, format: info.format, width: cx, height: cy, name: base,
    alt: opts.get("alt") ? tokensToString(opts.get("alt")!).trim() : undefined };
}

/** Inside a box of the given width, \linewidth (and \textwidth for minipage) is that width. */
export function setLineWidth(d: Digester, width: Token[], t: Loc, alsoText = false): void {
  const sp = Math.round(lengthPt(d, width, t) * 65536);
  if (sp <= 0) return;
  d.e.setRegister("skip", "linewidth", sp);
  d.e.setRegister("skip", "columnwidth", sp);
  if (alsoText) d.e.setRegister("skip", "textwidth", sp);
}

export function installFloats(d: Digester): void {
  const e = d.e;
  const containers: Container[] = [];

  for (const [env, kind, sig] of FLOATS) {
    d.env(env, { sig, mode: "block", display: true,
      begin: (d, _a, t) => {
        const block: Block = { kind: "float", float: kind, content: [], span: d.span(t) };
        d.addBlock(block);
        containers.push(d.pushContainer("float", block.content));
        e.state.set("float:type", kind);
        e.state.set("float:captioned", false);
        e.setRegister("count", "c@sub" + kind, 0, true);
        e.state.set("par:role", "compact");
        e.state.set("par:align", undefined);
        d.labelTarget = null;
      },
      end: d => {
        d.closeParagraph();
        const c = containers.pop();
        if (c) d.popUntil(c);
      },
    });
  }

  const caption = (d: Digester, type: string, starred: boolean, body: Token[], t: CsToken) => {
    d.closeParagraph();
    const sub = !!e.state.get("subfloat");
    const counter = sub ? "sub" + type : type;
    const cap: Caption = { label: "", content: [] };
    if (!starred) {
      refStepCounter(e, counter, t);
      if (sub) {
        cap.number = `(${d.argString([csTok("the" + counter, t)])})`;
        // subcaption numbers subfigures by their parent float, whose \caption usually comes later.
        if (!e.state.get("float:captioned")) {
          const key = "c@" + type, v = e.register("count", key) as number;
          e.setRegister("count", key, v + 1, true);
          e.state.set("@currentlabel", d.theCounter(counter));
          e.setRegister("count", key, v, true);
        }
      } else {
        e.state.set("float:captioned", true);
        cap.label = d.argString([csTok(type === "table" ? "tablename" : type === "figure" ? "figurename" : type + "name", t)]) || type;
        cap.number = d.theCounter(counter);
        cap.seq = type;
      }
      d.labelTarget = sub ? null : { kind: "number", claim: key => (cap.anchor ??= key) };
    }
    cap.content = d.captureInline(body);
    const block: Block = { kind: "caption", caption: cap, span: d.span(t) };
    if (!d.placeCaption?.(block)) d.addBlock(block);
    d.noIndentNext = true;
  };
  d.def("caption", { sig: "s o m", run: (d, [star, , body], t) => {
    const type = e.state.get<string>("float:type");
    if (!type) d.e.diag.warn("W014", "\\caption outside a figure or table", t);
    caption(d, type ?? "figure", star.present, body.tokens, t);
  } });
  d.def("captionof", { sig: "s m o m", run: (d, [star, type, , body], t) => caption(d, d.argString(type), star.present, body.tokens, t) });
  d.def("subcaption", { sig: "s o m", run: (d, [star, , body], t) => {
    e.state.set("subfloat", true);
    caption(d, e.state.get<string>("float:type") ?? "figure", star.present, body.tokens, t);
  } });

  for (const env of ["subfigure", "subtable"]) {
    d.env(env, { sig: "o o o m", mode: "block", display: true, begin: (d, args, t) => {
      e.state.set("subfloat", true);
      e.state.set("float:type", env === "subtable" ? "table" : "figure");
      setLineWidth(d, args[3].tokens, t);
    } });
  }
  d.def("subfloat", { sig: "o o m", mode: "block", run: (d, [lof, cap, body], t) => {
    e.beginGroup("internal");
    e.state.set("subfloat", true);
    d.digestTokens(body.tokens);
    d.closeParagraph();
    const text = cap.present ? cap.tokens : lof.present ? lof.tokens : undefined;
    if (text) caption(d, e.state.get<string>("float:type") ?? "figure", false, text, t);
    e.endGroup("internal");
  } });

  d.def("listoffigures", { mode: "block", run: d => d.addBlock({ kind: "toc", depth: 1, figures: "figure", title: d.captureInline([csTok("listfigurename")]) }) });
  d.def("listoftables", { mode: "block", run: d => d.addBlock({ kind: "toc", depth: 1, figures: "table", title: d.captureInline([csTok("listtablename")]) }) });

  d.def("graphicspath", { sig: "m", run: (d, [a]) => {
    const dirs = [...tokensToString(a.tokens).matchAll(/\{([^{}]*)\}/g)].map(m => m[1]).filter(Boolean);
    e.state.set("graphicspath", dirs, true);
  } });
  d.def("includegraphics", { sig: "s o o m", mode: "inline", run: (d, [, o1, o2, file], t) => {
    const opts = o1.present && !o2.present ? keyValTokens(o1.tokens) : new Map<string, Token[]>();
    const name = tokensToString(d.e.expandFully(file.tokens)).trim().replace(/^"(.*)"$/, "$1");
    const img = loadImage(d, name, opts, t);
    if (typeof img === "string") d.withMarks(m => ({ ...m, italic: true }), () => d.literal(`[figure: ${img}]`));
    else d.inline({ kind: "image", image: img });
  } });
  d.def("DeclareGraphicsRule", { sig: "m m m m", run: () => {} });
  // Box scaling applies to the pictures inside; text keeps its size (Word has no scaled text boxes).
  d.def("scalebox", { sig: "m o m", mode: "inline", run: (d, [f, , body], t) => {
    const k = parseFloat(d.argString(f)) || 1;
    e.beginGroup("internal");
    e.state.set("img:scale", (e.state.get<number>("img:scale") ?? 1) * k);
    d.digestTokens(body.tokens);
    e.endGroup("internal");
    void t;
  } });
  d.def("resizebox", { sig: "s m m m", mode: "inline", run: (d, [, w, h, body]) => {
    e.beginGroup("internal");
    const ws = d.argString(w), hs = d.argString(h);
    if (ws !== "!") e.state.set("img:width", w.tokens);
    if (hs !== "!") e.state.set("img:height", h.tokens);
    d.digestTokens(body.tokens);
    e.endGroup("internal");
  } });
  for (const name of ["rotatebox", "reflectbox", "adjustbox"]) {
    const sig = name === "rotatebox" ? "o m m" : name === "adjustbox" ? "m m" : "m";
    d.def(name, { sig, mode: "inline", run: (d, args, t) => {
      d.warnOnce(name, "W014", `\\${name} is not applied; its content is kept`, t);
      d.withMarks(m => m, () => d.digestTokens(args[args.length - 1].tokens));
    } });
  }
}
