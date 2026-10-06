import { BudgetError, createEngine, type Diagnostic, type EngineOptions, type FileRequest, type FileResult, type SourceMap } from "@texdocx/core";
import { installMath } from "@texdocx/math";
import type { Document } from "@texdocx/model";
import { Digester, type DigestOptions } from "./digester.ts";
import { installStructure } from "./handlers/structure.ts";
import { installFloats } from "./handlers/floats.ts";
import { installLists } from "./handlers/lists.ts";
import { installPageStyles } from "./handlers/pagestyle.ts";
import { installTables } from "./handlers/tables.ts";
import { installText } from "./handlers/text.ts";

export { Digester, type CommandHandler, type EnvHandler, type DigestOptions } from "./digester.ts";
export { KNOWN_PACKAGES } from "./handlers/structure.ts";

export interface CompileInput {
  name: string;
  text: string;
  /** Sandboxed reader for \input, \include, images; omitted = no file access. */
  readFile?: (req: FileRequest) => FileResult;
  strict?: boolean;
  engine?: EngineOptions;
  digest?: DigestOptions;
}

export interface DigestResult {
  doc: Document;
  diagnostics: Diagnostic[];
  sources: SourceMap;
  /** False when a fatal error (budget exhaustion) stopped digestion early. */
  complete: boolean;
}

export function createDigester(input: Omit<CompileInput, "name" | "text">): Digester {
  const e = createEngine({ ...input.engine, readFile: input.readFile });
  e.diag.strict = !!input.strict;
  installMath(e);
  const d = new Digester(e, input.digest);
  installText(d);
  installStructure(d);
  installTables(d);
  installFloats(d);
  installLists(d);
  installPageStyles(d);
  return d;
}

/** LaTeX source → document model and diagnostics. */
export function digest(input: CompileInput): DigestResult {
  const d = createDigester(input);
  d.e.pushFile(input.name, input.text);
  let complete = true;
  try {
    d.run();
  } catch (err) {
    if (!(err instanceof BudgetError)) throw err;
    complete = false;
    d.e.diag.error("E003", err.message, undefined,
      err.macroStack.length ? `expansion stack: ${err.macroStack.join(" ← ")}` : undefined);
    d.closeParagraph();
  }
  return { doc: d.doc, diagnostics: d.e.diag.list, sources: d.e.sources, complete };
}
