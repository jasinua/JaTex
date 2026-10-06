import type { Document } from "@texdocx/model";
import { packageDocx } from "./package.ts";
import { buildParts, type WriteOptions } from "./writer.ts";

export { buildParts, Bookmarks, type WriteOptions } from "./writer.ts";
export { packageDocx } from "./package.ts";
export { omml } from "./omml.ts";
export { ORDER, xmlText, xmlAttr, stripIllegal } from "./xml.ts";
export { DEFAULT_FONTS, ROLE_STYLE, type Fonts } from "./styles.ts";

/** Model → .docx bytes. */
export function writeDocx(doc: Document, opts: WriteOptions = {}): Uint8Array {
  return packageDocx(buildParts(doc, opts));
}
