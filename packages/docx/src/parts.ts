// Package-level parts: content types, relationships, settings, document properties.

import { CT, NS, ORDER, REL, XML_DECL, el, ordered, val, xmlText as escapeText } from "./xml.ts";

export interface Rel { id: string; type: string; target: string; external?: boolean }

export function relsXml(rels: Rel[]): string {
  return XML_DECL + el("Relationships", { xmlns: NS.rels },
    ...rels.map(r => el("Relationship", {
      Id: r.id, Type: r.type, Target: r.target, TargetMode: r.external ? "External" : undefined,
    })));
}

export function packageRelsXml(): string {
  return relsXml([
    { id: "rId1", type: REL.officeDocument, target: "word/document.xml" },
    { id: "rId2", type: REL.core, target: "docProps/core.xml" },
    { id: "rId3", type: REL.app, target: "docProps/app.xml" },
  ]);
}

/** Content types: Default by extension for rels/xml/media, Override per part. Never a folder. */
export function contentTypesXml(overrides: Record<string, string>, mediaExtensions: Record<string, string>): string {
  const defaults: Record<string, string> = { rels: CT.rels, xml: CT.xml, ...mediaExtensions };
  return XML_DECL + el("Types", { xmlns: NS.ct },
    ...Object.keys(defaults).sort().map(ext => el("Default", { Extension: ext, ContentType: defaults[ext] })),
    ...Object.keys(overrides).sort().map(p => el("Override", { PartName: p, ContentType: overrides[p] })));
}

export interface SettingsOptions {
  updateFields: boolean;
  footnotes: boolean;
  evenAndOddHeaders: boolean;
  autoHyphenation: boolean;
  lang: string;
  mathFont: string;
}

export function settingsXml(o: SettingsOptions): string {
  const mathPr = ordered("m:mathPr", ORDER.mathPr, {
    "m:mathFont": el("m:mathFont", { "m:val": o.mathFont }),
    "m:brkBin": el("m:brkBin", { "m:val": "before" }),
    "m:brkBinSub": el("m:brkBinSub", { "m:val": "--" }),
    "m:smallFrac": el("m:smallFrac", { "m:val": "0" }),
    "m:dispDef": "<m:dispDef/>",
    "m:lMargin": el("m:lMargin", { "m:val": "0" }),
    "m:rMargin": el("m:rMargin", { "m:val": "0" }),
    "m:defJc": el("m:defJc", { "m:val": "centerGroup" }),
    "m:wrapIndent": el("m:wrapIndent", { "m:val": "1440" }),
    "m:intLim": el("m:intLim", { "m:val": "subSup" }),
    "m:naryLim": el("m:naryLim", { "m:val": "undOvr" }),
  });
  return XML_DECL + ordered("w:settings", ORDER.settings, {
    "w:defaultTabStop": val("w:defaultTabStop", 720),
    "w:autoHyphenation": o.autoHyphenation ? "<w:autoHyphenation/>" : undefined,
    "w:evenAndOddHeaders": o.evenAndOddHeaders ? "<w:evenAndOddHeaders/>" : undefined,
    "w:characterSpacingControl": val("w:characterSpacingControl", "doNotCompress"),
    "w:updateFields": o.updateFields ? val("w:updateFields", "true") : undefined,
    "w:footnotePr": o.footnotes
      ? el("w:footnotePr", undefined, el("w:footnote", { "w:id": -1 }), el("w:footnote", { "w:id": 0 }))
      : undefined,
    "w:compat": el("w:compat", undefined, el("w:compatSetting", {
      "w:name": "compatibilityMode", "w:uri": "http://schemas.microsoft.com/office/word", "w:val": 15,
    })),
    "m:mathPr": mathPr,
    "w:themeFontLang": val("w:themeFontLang", o.lang),
    "w:decimalSymbol": val("w:decimalSymbol", "."),
    "w:listSeparator": val("w:listSeparator", ","),
  }, { "xmlns:w": NS.w, "xmlns:m": NS.m });
}

export interface CoreProps { title?: string; creator?: string; language?: string; created?: Date }

export function coreXml(p: CoreProps): string {
  return XML_DECL + el("cp:coreProperties", {
    "xmlns:cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "xmlns:dc": "http://purl.org/dc/elements/1.1/",
    "xmlns:dcterms": "http://purl.org/dc/terms/",
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
  },
  p.title && el("dc:title", undefined, escapeText(p.title)),
  p.creator && el("dc:creator", undefined, escapeText(p.creator)),
  p.language && el("dc:language", undefined, escapeText(p.language)),
  p.created && el("dcterms:created", { "xsi:type": "dcterms:W3CDTF" }, p.created.toISOString().replace(/\.\d+Z$/, "Z")));
}

export function appXml(): string {
  return XML_DECL + el("Properties", {
    xmlns: "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    "xmlns:vt": "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
  }, el("Application", undefined, "texdocx"));
}
