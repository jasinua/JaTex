# texdocx

A LaTeX → Word (.docx) compiler. It rebuilds LaTeX's front end (tokenizer with category codes, macro
expansion, document structure, math) and lets Word do the layout. Equations become native, editable
Office Math (OMML); cross-references, equation numbers and the table of contents become Word fields
with correct cached values.

Design and roadmap: [LaTeX → DOCX Research & Implementation Plan.md](LaTeX%20→%20DOCX%20Research%20&%20Implementation%20Plan.md).
Progress: [CHECKLIST.md](CHECKLIST.md).

## Use

Requires Node.js ≥ 23.6 (TypeScript runs directly through Node's type stripping) and pnpm.

```sh
pnpm install
pnpm texdocx paper.tex                # writes paper.docx next to it
pnpm texdocx paper.tex -o out.docx --json --strict
```

Diagnostics look like a compiler's:

```text
warning[W013]: unknown command \mybox, rendered its arguments as text
 --> 11-unknown.tex:4:1
  |
4 | \mybox{red}{Important} text with an \undefinedthing{} command.
  | ^^^^^^
  = hint: define it with \newcommand or add a package handler
```

Documents can only read files inside their own folder (`--root` to change it). Nothing is ever
written, executed or fetched from the network on a document's behalf.

## Layout

| Package | Role |
| --- | --- |
| `packages/core` | Tokens, catcodes, lexer, expander (macros, conditionals, registers, counters), diagnostics |
| `packages/model` | Typed document model shared by front end and writers |
| `packages/math` | Stream math parser (LaTeX math → `MathNode`) |
| `packages/digest` | Commands and environments → document model |
| `packages/docx` | Model → OOXML: schema-ordered builders, OMML, numbering, fields, deterministic ZIP |
| `packages/cli` | `texdocx` command, sandboxed file access |
| `tools/validator` | Structural .docx validator (stand-in for the Open XML SDK validator) |
| `tools/smoke` | `dump.ts` prints a .docx as readable lines for reviewing goldens |

`docx` depends only on `model`; it never sees LaTeX.

## Develop

```sh
pnpm verify                            # typecheck + all tests
pnpm test -u                           # update golden snapshots, then review the diff
FUZZ_RUNS=500000 npx vitest run tests/fuzz.test.ts --testTimeout=0
node tools/smoke/src/dump.ts out.docx  # inspect a generated file
```

Tests: unit (`tests/unit`), golden XML per fixture (`tests/fixtures/tex` → `tests/golden`),
security (`tests/security.test.ts`) and fuzzing (`tests/fuzz.test.ts`).
