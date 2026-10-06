# texdocx — Implementation Checklist

Source of truth for progress. The plan is `LaTeX → DOCX Research & Implementation Plan.md`.

## Working rules (re-read before every step)

1. Exactly one item is `[~]` at a time. Finish or mark `[!]` before starting another.
2. An item is `[x]` only when: code exists, a test covers it, and `pnpm verify` is green.
3. After every item: run `pnpm verify`, tick the box, add one line to the Session log.
4. Do not start a phase until the previous gate is `[x]` or `[!]` with a written reason.
5. Any change from the plan goes in "Decisions & deviations" with a reason.
6. Dependency direction: `digest → core, math, model` · `resolve → model, bib` · `docx → model` only.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done and verified · `[!]` blocked (reason given)

## Environment

- [x] Node 25.2, pnpm 11.18, git available; npm registry reachable
- [!] Microsoft Word: not installed → real-Word checks need a Windows/Mac machine with Office
- [x] LibreOffice 26.8 installed (Homebrew); headless `soffice --convert-to pdf` works
- [!] .NET + Open XML SDK validator: not installed → in-house structural validator used meanwhile
- [!] Pandoc: not installed → differential math tests deferred (`brew install pandoc`)
- [x] Stand-ins on macOS: `textutil` (Cocoa .docx reader) + `qlmanage` (Quick Look page render)

## Phase 0 — Output spike

- [x] Monorepo skeleton: pnpm workspace, tsconfig, vitest, scripts (`test`, `typecheck`, `verify`)
- [x] `packages/docx`: XML escaping, schema-ordered builders (pPr, rPr, sectPr, settings, style)
- [x] `packages/docx`: deterministic OPC packager (fixed timestamps, sorted parts, content types first)
- [x] Minimal .docx written from a hand-built model (`tests/fixtures/sample-model.ts`, `tools/smoke`)
- [x] `tools/validator`: in-house structural validator (well-formed XML, content types, rels, element order, ids)
- [x] Smoke test: `textutil` reads the file; Quick Look renders page 1 (Quick Look cannot show OMML math)
- [!] GATE 0: in-house validator ✔, macOS readers ✔, LibreOffice opens + renders all 17 fixtures ✔; Word and Google Docs still unchecked (no Word on this machine)

## Phase 1 — Core text

- [x] `core`: catcodes, tokens, source map with file/line/col
- [x] `core`: lexer (reader states N/M/S, comments, `^^` notation, control words/symbols)
- [x] `core`: diagnostics (severity, code, location, excerpt, hint; text + JSON)
- [x] `core`: engine — save stack (local/global), input stack, macro expansion with budgets, kernel bootstrap in TeX
- [x] `model`: document model types (written in Phase 0; extended as phases need)
- [x] `digest`: mode stack, command/environment registry with xparse-style signatures
- [x] `digest`: paragraphs, `\par`, spacing rules (first-paragraph/continuation indent like LaTeX)
- [x] `digest`: sectioning (`\part`…`\subparagraph`, starred), class-aware levels, secnumdepth
- [x] `digest`: font commands and declarations (`\textbf`, `\bfseries`, `\emph` toggling, sizes, colours)
- [x] `digest`: special characters, ligatures (dashes, quotes), accents → NFC Unicode
- [x] `digest`: title block (`\title`, `\author`, `\and`, `\date`, `\maketitle`, `\thanks`), `abstract`
- [x] `digest`: alignment envs, `quote`/`quotation`/`verse`, `\\`, `\newpage`
- [x] `digest`: unknown command/env/package fallback with warnings (fixture 11)
- [x] `docx`: writer for headings (multilevel numbering), paragraphs, runs, styles, settings, metadata
- [x] Default template styles (Title, Author, Abstract, Heading 1–6, Body Text, First Paragraph, …)
- [x] `cli`: `texdocx in.tex -o out.docx`, diagnostics printing (text/JSON), exit codes
- [x] 10 text-only fixture papers + golden XML tests (11 fixtures, reviewed with `tools/smoke/src/dump.ts`)
- [x] GATE 1: 10 text-only fixtures convert; golden tests green

## Phase 2 — Macros and files

- [x] `\newcommand`, `\renewcommand`, `\providecommand` (optional first arg)
- [x] `\newenvironment`, `\renewenvironment` (end code runs before the name check, like LaTeX)
- [x] `\NewDocumentCommand`, `\NewDocumentEnvironment` incl. `b` body argument (fixture 12)
- [x] `\def` (delimited params), `\gdef`, `\edef`, `\xdef`, `\let`, `\futurelet`-free `\@ifnextchar`, `\@ifstar`
- [x] `\expandafter`, `\noexpand`, `\csname`, `\string`, `\the`, `\number`, `\relax`
- [x] Conditionals: `\if`, `\ifx`, `\ifnum`, `\ifcase`, `\iftrue`/`\iffalse`, `\newif`, `\unless`
- [x] Groups: `{}`, `\begingroup`/`\endgroup`, `\global`, `\bgroup`/`\egroup`
- [x] Sandboxed `\input`/`\include`/`\subfile` (root confinement, symlinks, no existence oracle, size caps)
- [x] `\makeatletter`/`\makeatother`, `\catcode` subset, `\ExplSyntaxOn` diagnostic (block skipped, W015)
- [x] Verbatim: `\verb`, `verbatim`, `lstlisting`, `minted`, `comment` (fixtures 07, 08, 12)
- [x] Budgets: expansion steps, depth, token count, wall clock → error naming the macro stack
- [x] Fuzz tests (fast-check): token soup, preamble soup, mutated fixtures, unicode; quick run in every `pnpm test`
- [x] GATE 2: macro-heavy fixture ✔; 68-minute fuzz run (500k cases/property) — its only finding (duplicate bookmarks) fixed + regression

## Phase 3 — Structure

- [x] Lists: itemize, enumerate, description; enumitem `label`/`ref`/`start`/`resume(*)`, short labels, `\setlist`, `\newlist`; formats derived from the real label via sentinel expansion (fixture 15)
- [x] Tables: tabular(*), tabularx, longtable (head/foot), `\multicolumn`, `\multirow`, booktabs, `\hline`, `\cline`, `|` borders, `>{}`/`<{}`, `*{n}{}`, `\newcolumntype` (fixture 13)
- [x] Footnotes (`\footnote`, `\footnotemark`, `\footnotetext`), separators, own .rels part
- [x] Links: `\href`, `\url`, `\hyperref`, `\hyperlink`/`\hypertarget`
- [x] Images: PNG/JPEG/GIF/BMP/SVG size+DPI parsing, graphicx sizing, `\graphicspath`, media dedupe; SVG uses a blank PNG fallback (no rasterizer yet); PDF/EPS → raster twin or placeholder + W014
- [x] Figures and captions (SEQ fields, kept together, caption above/below, subfigures (a)/(b) with 2a refs, list of figures/tables)
- [x] Code blocks with highlighting (shiki, sync JS engine, 28 languages, listings/minted names)
- [x] Headers/footers: plain/empty/headings, fancyhdr slots (`\thepage`→PAGE, `\leftmark`→STYLEREF, LastPage→NUMPAGES), `\thispagestyle` title page, `\pagenumbering` + `\frontmatter`/`\mainmatter` section breaks (fixture 16); `geometry` ✔
- [x] GATE 3: fixtures 13–17 (tables, figures, enumitem, page styles, full paper) convert with 0 errors, validate, images sized like graphicx

## Phase 4 — Math

- [ ] Math parser → MathNode tree
- [ ] OMML writer covering the mapping table
- [ ] Symbol table (unicode-math names → code points)
- [ ] amsmath environments (equation, align, gather, multline, split, cases, matrices)
- [ ] Equation numbering A (tab stops) and B (table); `\tag`, `\notag`
- [ ] GATE 4: ≥95% of a 500-equation set renders correctly

## Phase 5 — Cross-references

- [ ] Counters with resets and `\the` formats
- [ ] `\label`/`\ref`/`\eqref`/`\pageref`/`\autoref`/`\cref` → bookmarks + REF fields with cached text
- [ ] SEQ captions; heading numbering; TOC/LOF/LOT fields; appendix; theorems
- [ ] GATE 5: updating all fields in Word changes nothing

## Phase 6 — Bibliography

- [ ] .bib parser (strings, `#`, accents, names) → CSL-JSON
- [ ] CSL processing (licence review: citeproc-js is CPAL/AGPL)
- [ ] natbib + biblatex commands; `thebibliography`
- [ ] GATE 6: matches reference renderings for 5 CSL styles

## Phase 7 — Templates and hardening

- [ ] reference.docx import (safe ZIP + XML), name-based style mapping
- [ ] Class presets, `--strict`, docs, packaging
- [ ] GATE 7: ≥90% of 100-paper corpus converts without errors

## Decisions & deviations

- Subfigures are stacked vertically (plan: borderless table side by side) — revisit in Phase 7.
- SVG images carry a blank PNG fallback (no rasterizer bundled); Word 2016+ shows the SVG.
- PDF/EPS figures: a PNG/SVG/JPG twin with the same name is used, else placeholder + W014
  (no external converters run: security rule).
- Phase 3 started while Gate 2's long fuzz run (500k cases/property) was still running in the
  background; any failures it reports are fixed before Gate 3.
- Repo root is this folder (`JaTex/`), npm scope `@texdocx/*`.
- `MathNode` lives in `model` and the OMML serializer in `docx` (plan put both in `math`), so `docx`
  still depends only on `model`. `math` will hold the LaTeX math parser only.
- Writer already supports lists, footnotes, links, REF fields, bookmarks, TOC field, code blocks
  (cheap to add with the builders); the LaTeX side of each still follows the phase order.
- Heading numbering: one multilevel list (`%1`, `%1.%2`, …, tab suffix) linked to Heading 1–3.
- Lists, footnotes, links, labels/refs, inline + display math and a TOC field landed in Phase 1
  because real text papers need them; later phases harden them (tables/figures still Phase 3).
- Cross-references: headings → `REF bm \w \h` (Word paragraph number = LaTeX number); equation
  numbers → `REF bm \h` on a bookmarked SEQ field; list items → hyperlink with cached text, because
  Word's list context ("1.(a)") differs from LaTeX's `\p@enumii` ("1a") and would change on F9.
- `\autoref` names follow hyperref (lowercase "section") and honour `\<counter>autorefname`.
- Fonts follow LaTeX ≥ 2020: italic and small caps combine; `\upshape` resets both.
- Security tests (`tests/security.test.ts`) run on every `pnpm test`: absolute paths, `../`,
  symlinks, URLs, disallowed types, existence oracle, `\write18`, `\openout`, macro bombs.
- Source runs directly via Node's TypeScript type stripping, so code uses erasable syntax only
  (`as const` objects instead of `const enum`, no parameter properties). Checked by `tsc --noEmit`.
- No .NET/LibreOffice on this machine: Phase 0 uses an in-house validator plus macOS `textutil`/Quick Look.

## Session log

- 2026-10-06: Read plan; created checklist; environment checked.
- 2026-10-06: Phase 0 done: model, docx writer, packager, validator, 13 tests green; spike renders in Quick Look.
- 2026-10-06: Core engine done (lexer, state, expansion, primitives, LaTeX definitions, counters); 45 tests green.
  Most Phase 2 expander items landed early because the engine needed them; ticked where tested.
- 2026-10-06: Phase 1 GATE passed: digester, math parser (basic), CLI + sandbox, 11 golden fixtures,
  security suite; 66 tests green. Reviewed every golden by eye via the dump tool.
- 2026-10-06: Fuzzing found 2 real bugs, both fixed: (1) commands reading raw tokens could swallow
  the end-of-argument sentinel → fences now read as end-of-input for every reader; (2) hyperlinks in
  footnotes used document.xml.rels → per-part relationship scopes. 72 tests green.
- 2026-10-06: Long fuzz (60k) found <w:t> edge-whitespace bug (preserve decided before stripping illegal
  chars) → fixed + regression test. 500k run started. Phase 3: tables, floats, captions, images done
  (fixtures 13, 14 reviewed with dump + Quick Look); 77 tests green.
- 2026-10-06: Phase 3 GATE passed: enumitem, headers/footers, section breaks, shiki highlighting,
  realistic paper fixture 17; 80 tests green. Next: Phase 4 (math hardening, equation layout).
- 2026-10-06: User guide written in LaTeX (docs/guide, 6 sections) by a 12-agent draft+review workflow and
  compiled by texdocx → out/guide/texdocx-guide.{docx,pdf} (13 pages, PDF via LibreOffice). Review found
  6 compiler bugs, all fixed with tests (sandbox dotfiles/extension-less files, \text spaces, stale \label
  target, nested-matrix row meta, \verb font, \scalebox/\resizebox). LibreOffice render showed "¿" for
  formulas starting with "=" → zero-width lead operand. 86 tests green.
- 2026-10-06: Long fuzz (68 min) found duplicate bookmark names on repeated labels → one bookmark per label.
  Docs follow-up: regenerate docs/supported-commands.md (stale: floats/tables envs missing).
