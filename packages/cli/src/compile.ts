// The whole pipeline in one call: LaTeX source → .docx bytes plus diagnostics.

import type { Diagnostic, SourceMap } from "@texdocx/core";
import { digest, type DigestOptions } from "@texdocx/digest";
import { writeDocx } from "@texdocx/docx";
import type { Document } from "@texdocx/model";
import { createFileReader } from "./sandbox.ts";

export interface CompileOptions {
  name: string;
  text: string;
  /** Folder the document may read from; omit to disable file access entirely. */
  root?: string;
  strict?: boolean;
  digest?: DigestOptions;
}

export interface CompileResult {
  docx: Uint8Array;
  doc: Document;
  diagnostics: Diagnostic[];
  sources: SourceMap;
}

export function compile(o: CompileOptions): CompileResult {
  const readFile = o.root ? createFileReader({ root: o.root }) : undefined;
  const r = digest({ name: o.name, text: o.text, readFile, strict: o.strict, digest: o.digest });
  return { docx: writeDocx(r.doc), doc: r.doc, diagnostics: r.diagnostics, sources: r.sources };
}
