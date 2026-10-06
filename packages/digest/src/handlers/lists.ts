// Lists: itemize, enumerate, description; enumitem options, short labels, \setlist, \newlist.
// Word numbering formats are derived from the actual LaTeX label by expanding it with a sentinel
// counter value, so redefined \labelenumi / \theenumi and enumitem labels all map correctly.

import { Cat, csTok, isSpace, newCounter, refStepCounter, tokensToString, type CsToken, type Token } from "@texdocx/core";
import type { ListFormat } from "@texdocx/model";
import type { Digester } from "../digester.ts";
import { keyValTokens } from "./floats.ts";

const ROMAN = ["i", "ii", "iii", "iv"];
const SENTINEL = 7;

interface ListOpts { label?: Token[]; ref?: Token[]; start?: number; resume?: boolean; resumeStar?: boolean }

/** Per list series (environment name and level): last counter value and the options it used. */
const series = new WeakMap<Digester, Map<string, { count: number; opts: ListOpts }>>();

/** \arabic* → \@arabic\c@<counter>, so enumitem labels expand like ordinary counter output. */
function starLabel(toks: Token[], counter: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const n = toks[i + 1];
    if (t.kind === "cs" && ["arabic", "alph", "Alph", "roman", "Roman", "fnsymbol"].includes(t.name) && n && n.kind === "char" && n.ch === "*") {
      out.push(csTok("@" + t.name, t), csTok("c@" + counter, t));
      i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

/** enumerate-package short label "(a)" → enumitem label "(\alph*)". */
function shortLabel(text: string, toks: Token[]): Token[] | undefined {
  const map: Record<string, string> = { "1": "arabic", a: "alph", A: "Alph", i: "roman", I: "Roman" };
  const idx = toks.findIndex(t => t.kind === "char" && map[t.ch] !== undefined && t.cat !== Cat.BeginGroup);
  if (idx < 0) return text.trim() ? toks : undefined;
  const t = toks[idx] as { ch: string };
  return [...toks.slice(0, idx), csTok(map[t.ch]), { kind: "char", ch: "*", cat: Cat.Other, file: -1, pos: 0 }, ...toks.slice(idx + 1)];
}

const FLAG_KEYS = new Set(["noitemsep", "nosep", "nolistsep", "wide", "resume", "resume*", "before", "after", "font",
  "format", "align", "leftmargin", "rightmargin", "labelindent", "labelwidth", "labelsep", "itemindent", "listparindent",
  "itemsep", "parsep", "topsep", "partopsep", "series", "widest", "noitemsep", "beginpenalty", "midpenalty", "endpenalty",
  "style", "mode", "fullwidth", "first", "first*", "before*", "after*"]);

function parseOpts(d: Digester, toks: Token[]): ListOpts {
  const o: ListOpts = {};
  for (const [k, v] of keyValTokens(toks)) {
    if (k === "label" || k === "label*") o.label = v;
    else if (k === "ref" || k === "ref*") o.ref = v;
    else if (k === "start") o.start = parseInt(tokensToString(d.e.expandFully(v)), 10) || 1;
    else if (k === "resume" || k === "resume*") { o.resume = true; o.resumeStar = k === "resume*"; }
    else if (!v.length && !FLAG_KEYS.has(k)) {
      const raw = toks.filter(t => !isSpace(t));
      const label = shortLabel(k, raw);
      if (label) o.label = label;
    }
  }
  return o;
}

/** Expands a label with the counter at a sentinel value and reads off the Word format and level text. */
function deriveFormat(d: Digester, label: Token[], counter: string | undefined): { format?: ListFormat; template: string } {
  const key = counter ? "c@" + counter : undefined;
  const saved = key ? d.e.register("count", key) as number : 0;
  if (key) d.e.setRegister("count", key, SENTINEL, true);
  const text = d.captureText(label).trim();
  if (key) d.e.setRegister("count", key, saved, true);
  if (!counter) return { template: text || "•" };
  const marks: [string, ListFormat][] = [["vii", "lowerRoman"], ["VII", "upperRoman"], ["7", "decimal"], ["g", "lowerLetter"], ["G", "upperLetter"]];
  for (const [m, format] of marks) {
    const i = text.indexOf(m);
    if (i >= 0) return { format, template: text.slice(0, i) + "%1" + text.slice(i + m.length) };
  }
  return { format: "bullet", template: text || "•" };
}

export function installLists(d: Digester): void {
  const e = d.e;
  if (!series.has(d)) series.set(d, new Map());

  const begin = (style: "itemize" | "enumerate" | "description", name: string) => (d: Digester, args: { present: boolean; tokens: Token[] }[], t: CsToken) => {
    const L = d.beginList(style, t);
    const level = Math.min(L.depth, 4);
    const counter = style === "enumerate" ? (name === "enumerate" ? "enum" : name) + ROMAN[level - 1] : undefined;
    if (counter && name !== "enumerate" && !e.isDefined("c@" + counter)) newCounter(e, counter, undefined, t);
    if (counter) { L.counter = counter; e.setRegister("count", "c@" + counter, 0, true); }

    // Defaults from \setlist, then the environment's own options.
    const preset = [...(e.state.get<Token[]>(`setlist:${name}`) ?? []), ...(e.state.get<Token[]>(`setlist:${name}:${level}`) ?? [])];
    const own = args[0]?.present ? parseOpts(d, args[0].tokens) : {};
    const seriesKey = `${name}:${level}`;
    const prev = series.get(d)!.get(seriesKey);
    // resume* also repeats the options of the list being resumed.
    const opts: ListOpts = { ...parseOpts(d, preset), ...(own.resumeStar && prev ? prev.opts : {}), ...own };

    if (style === "description") return;
    let label = opts.label ? starLabel(opts.label, counter ?? "") : undefined;
    if (!label) label = [csTok((style === "enumerate" ? "labelenum" : "labelitem") + ROMAN[level - 1], t)];
    const f = deriveFormat(d, label, counter);
    L.block.format = style === "itemize" ? "bullet" : f.format;
    L.block.template = f.template;
    if (opts.label && counter) L.refLabel = opts.ref ? starLabel(opts.ref, counter) : label;

    if (opts.resume && counter) {
      const last = prev?.count ?? 0;
      e.setRegister("count", "c@" + counter, last, true);
      L.block.start = last + 1;
    } else if (opts.start !== undefined && counter) {
      e.setRegister("count", "c@" + counter, opts.start - 1, true);
      L.block.start = opts.start;
    }
    L.seriesKey = seriesKey;
    L.seriesOpts = { ...opts, resume: false, resumeStar: false, start: undefined };
  };

  const end = (d: Digester) => {
    const L = d.lists[d.lists.length - 1];
    if (L?.counter && L.seriesKey) series.get(d)!.set(L.seriesKey, { count: e.register("count", "c@" + L.counter) as number, opts: (L.seriesOpts ?? {}) as ListOpts });
    d.endList();
  };

  for (const style of ["itemize", "enumerate", "description"] as const) {
    d.env(style, { sig: "o", mode: "block", display: true, begin: begin(style, style), end });
  }
  for (const [name, style] of [["compactitem", "itemize"], ["compactenum", "enumerate"], ["compactdesc", "description"],
    ["inparaenum", "enumerate"], ["asparaenum", "enumerate"], ["itemize*", "itemize"], ["enumerate*", "enumerate"],
    ["description*", "description"], ["dinglist", "itemize"], ["checklist", "itemize"]] as const) {
    d.env(name, { sig: name === "dinglist" ? "m" : "o", mode: "block", display: true, begin: begin(style, style), end });
  }

  d.def("item", { sig: "o", run: (d, [label], t) => {
    if (!d.lists.length) { e.diag.error("E006", "\\item outside a list", t); d.par(); return; }
    d.closeParagraph();
    d.startItem(label.present ? label.tokens : undefined, t);
  } });

  d.def("setlist", { sig: "s o m", run: (d, [, which, opts]) => {
    const targets = which.present ? tokensToString(which.tokens).split(",").map(s => s.trim()).filter(Boolean) : ["enumerate", "itemize", "description"];
    const types = targets.filter(x => !/^\d$/.test(x));
    const levels = targets.filter(x => /^\d$/.test(x));
    for (const ty of types.length ? types : ["enumerate", "itemize", "description"]) {
      for (const key of levels.length ? levels.map(l => `setlist:${ty}:${l}`) : [`setlist:${ty}`]) {
        e.state.set(key, opts.tokens, true);
      }
    }
  } });
  d.def("setenumerate", { sig: "o m", run: (d, [lvl, opts]) => e.state.set(lvl.present ? `setlist:enumerate:${d.argString(lvl)}` : "setlist:enumerate", opts.tokens, true) });
  d.def("setitemize", { sig: "o m", run: (d, [lvl, opts]) => e.state.set(lvl.present ? `setlist:itemize:${d.argString(lvl)}` : "setlist:itemize", opts.tokens, true) });
  d.def("newlist", { sig: "m m m", run: (d, [name, type]) => {
    const n = d.argString(name), ty = d.argString(type);
    const style = ty === "enumerate" || ty === "enumerate*" ? "enumerate" : ty.startsWith("description") ? "description" : "itemize";
    d.env(n, { sig: "o", mode: "block", display: true, begin: begin(style, n), end });
  } });
  d.def("renewlist", { sig: "m m m", run: () => {} });
}

export { refStepCounter };
