// Compiler-style diagnostics: severity, code, location, excerpt, hint.

import type { Loc } from "./tokens.ts";
import type { SourceMap } from "./source.ts";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  loc?: Loc;
  length?: number;
  hint?: string;
}

/** Catalog of codes, so docs and tests can refer to stable identifiers. */
export const CODES = {
  E001: "invalid character",
  E002: "runaway or malformed argument",
  E003: "resource budget exceeded",
  E004: "file access denied",
  E005: "file not found",
  E006: "unbalanced group or environment",
  E007: "undefined control sequence in expansion-only context",
  E008: "malformed definition",
  E009: "missing number or dimension",
  W001: "content before \\begin{document} ignored",
  W002: "content after \\end{document} ignored",
  W010: "unknown package",
  W011: "unknown environment",
  W012: "unsupported primitive",
  W013: "unknown command",
  W014: "unsupported feature approximated",
  W015: "expl3 code is not supported",
  W016: "file writing ignored",
  W017: "shell escape is never executed",
  W020: "undefined reference",
  W021: "multiply defined label",
} as const;

export class Diagnostics {
  readonly list: Diagnostic[] = [];
  strict = false;

  report(d: Diagnostic): void {
    if (this.strict && d.severity === "warning") d = { ...d, severity: "error" };
    // Identical diagnostics at the same location are reported once.
    if (this.list.some(x => x.code === d.code && x.message === d.message && x.loc?.file === d.loc?.file && x.loc?.pos === d.loc?.pos)) return;
    this.list.push(d);
  }
  error(code: string, message: string, loc?: Loc, hint?: string, length?: number): void {
    this.report({ severity: "error", code, message, loc, hint, length });
  }
  warn(code: string, message: string, loc?: Loc, hint?: string, length?: number): void {
    this.report({ severity: "warning", code, message, loc, hint, length });
  }
  get errorCount(): number { return this.list.filter(d => d.severity === "error").length; }
}

/** Renders a diagnostic like rustc: header, arrow with location, source line, caret, hint. */
export function formatDiagnostic(d: Diagnostic, sources: SourceMap): string {
  const head = `${d.severity}[${d.code}]: ${d.message}`;
  if (!d.loc || d.loc.file < 0) return d.hint ? `${head}\n   = hint: ${d.hint}` : head;
  const file = sources.get(d.loc.file);
  const { line, col } = sources.position(d.loc.file, d.loc.pos);
  const text = sources.lineText(d.loc.file, line);
  const gutter = " ".repeat(String(line).length);
  const caretLen = Math.max(1, Math.min(d.length ?? 1, [...text].length - col + 1));
  let out = `${head}\n${gutter}--> ${file?.name ?? "?"}:${line}:${col}\n${gutter} |\n${line} | ${text}\n${gutter} | ${" ".repeat(col - 1)}${"^".repeat(caretLen)}`;
  if (d.hint) out += `\n${gutter} = hint: ${d.hint}`;
  return out;
}

export function diagnosticToJson(d: Diagnostic, sources: SourceMap): object {
  const pos = d.loc && d.loc.file >= 0 ? sources.position(d.loc.file, d.loc.pos) : undefined;
  return {
    severity: d.severity, code: d.code, message: d.message, hint: d.hint,
    file: d.loc && d.loc.file >= 0 ? sources.get(d.loc.file)?.name : undefined,
    line: pos?.line, column: pos?.col,
  };
}
