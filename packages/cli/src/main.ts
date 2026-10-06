#!/usr/bin/env node
// texdocx: LaTeX → .docx
// Usage: texdocx input.tex [-o output.docx] [--json] [--strict] [--root DIR] [--quiet]

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { diagnosticToJson, formatDiagnostic } from "@texdocx/core";
import { compile } from "./compile.ts";

const USAGE = `usage: texdocx <input.tex> [options]

  -o, --output FILE   output path (default: input name with .docx)
      --root DIR      folder documents may read from (default: the input's folder)
      --strict        treat warnings as errors
      --json          print diagnostics as JSON lines
  -q, --quiet         print errors only
  -h, --help          show this help`;

function main(argv: string[]): number {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        root: { type: "string" },
        strict: { type: "boolean" },
        json: { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    console.error((err as Error).message + "\n\n" + USAGE);
    return 2;
  }
  const { values, positionals } = args;
  if (values.help || positionals.length !== 1) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }

  const input = resolve(positionals[0]);
  let text: string;
  try { text = readFileSync(input, "utf8"); }
  catch (err) { console.error(`texdocx: cannot read ${positionals[0]}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`); return 2; }

  const root = resolve(values.root ?? dirname(input));
  const output = resolve(values.output ?? input.replace(/\.(tex|ltx)$/i, "") + ".docx");
  const result = compile({ name: relative(root, input) || basename(input), text, root, strict: values.strict });

  const shown = values.quiet ? result.diagnostics.filter(d => d.severity === "error") : result.diagnostics;
  for (const d of shown) {
    if (values.json) console.error(JSON.stringify(diagnosticToJson(d, result.sources)));
    else console.error(formatDiagnostic(d, result.sources) + "\n");
  }

  writeFileSync(output, result.docx);
  const errors = result.diagnostics.filter(d => d.severity === "error").length;
  const warnings = result.diagnostics.filter(d => d.severity === "warning").length;
  if (!values.json) {
    console.error(`${errors ? "✗" : "✓"} wrote ${relative(process.cwd(), output) || output} (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"})`);
  }
  return errors ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
