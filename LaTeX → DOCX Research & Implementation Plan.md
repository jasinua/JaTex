# LaTeX → DOCX: Research & Implementation Plan

Oct 6, 2026 · @Jasin Avdiu

## Executive summary

Build LaTeX's front end and let Word do the layout. A .docx file is a reflowable format that Word typesets itself when it opens the file, so TeX's typesetting engine (line breaking, page building, font metrics) has no job in your compiler. What you must rebuild is everything that reads LaTeX: tokenizing, macro expansion, document structure, math and bibliography.

| LaTeX subsystem | In your compiler | Reason |
| --- | --- | --- |
| Tokenizer with category codes | Rebuild | Real .tex files depend on it (`\makeatletter`, verbatim, `\ExplSyntaxOn`) |
| Macro expansion (`\newcommand`, `\def`, environments) | Rebuild, with hard limits | User macros appear in almost every real paper |
| Structure: classes, sectioning, counters, labels | Rebuild as semantic handlers | Maps onto Word styles, numbering and fields |
| Math syntax | Rebuild, emit OMML | Word renders OMML natively and keeps it editable |
| Bibliography (BibTeX, biblatex) | Rebuild via CSL styles | Word cannot read .bib files |
| Boxes and glue, Knuth–Plass, page builder, floats | Skip | Word breaks lines and pages itself |
| Fonts (TFM, NFSS) and DVI/PDF drivers | Skip | Word uses installed fonts |

**Scope.** Full TeX compatibility requires being TeX, so target a documented subset: the LaTeX kernel, the standard classes, about 20 high-use packages, user-defined macros, and a plugin API for everything else. Unknown commands produce a warning plus readable fallback text, never a crash.

**Stack.** TypeScript on Node.js (the same code runs in a browser), with an in-house OOXML writer and an in-house LaTeX-math-to-OMML converter. Rust is the alternative if a single native binary matters more than development speed.

**Effort (estimate).** A journal-article MVP (sections, lists, tables, figures, numbered equations, cross-references, citations) is about 5 months (21 weeks) for one experienced developer; a hardened v1 is about 6 months (24 weeks).

**Where projects like this fail:** math fidelity, cross-reference numbering, complex tables, invalid OOXML (Word's "unreadable content" error), and the long tail of packages. Each has a mitigation in the roadmap and risk register below.

Assumption: ".docs" in the request means Microsoft Word .docx (Office Open XML).

## How LaTeX works: layers, engines, distributions

LaTeX is a stack of macro layers running on TeX, a programmable typesetting engine. Every LaTeX feature is, in the end, macros that expand into about 300 TeX primitives. The engine is frozen except for bug fixes; its version number converges on π, one digit per fix.

The stack, from what you type down to the machine:

| Layer | Files | What it does |
| --- | --- | --- |
| Your document | `.tex`, `.bib`, images | Content, markup, your own `\newcommand` macros |
| Packages | `.sty` | Add features: `amsmath`, `graphicx`, `hyperref`, `geometry`, `biblatex` |
| Document class | `.cls`, `.clo` | Page layout and sectioning: `article`, `report`, `book`, `beamer`, `memoir`, KOMA-Script |
| LaTeX kernel (format) | `latex.ltx` precompiled to `latex.fmt` | `\documentclass`, sectioning machinery, counters, cross-references, font selection (NFSS), hooks, the expl3 programming layer |
| Engine | binary (`pdftex`, `xetex`, `luatex`) | Tokenizing, expansion, typesetting, PDF/DVI output |

### Key dates (newest first)

| Date | Event |
| --- | --- |
| Jun 2026 | LaTeX kernel 2026-06-01 released; kernels ship twice a year, June and November ([LaTeX Project news](https://latex-project.org/news)) |
| Mar 2026 | Accessible math in tagged PDF (PDF 2.0, PDF/UA-2) announced ([news](https://latex-project.org/news)) |
| 2020 | expl3 (the "LaTeX3" programming layer) merged into the kernel; multi-year Tagged PDF project starts ([news](https://latex-project.org/news)) |
| 2016 | LuaTeX 1.0; LaTeX kernel starts requiring ε-TeX extensions ([news](https://latex-project.org/news)) |
| 2004 | XeTeX brings Unicode input and system OpenType fonts |
| 1994 | LaTeX2e, still the current major version |
| 1984–85 | LaTeX by Leslie Lamport, a macro package on top of TeX |
| 1978–82 | TeX by Donald Knuth; rewritten as TeX82 in WEB, his literate-programming system |

### Engines

| Engine | What it adds | Input and fonts | Output |
| --- | --- | --- | --- |
| TeX | The original 1982 program | 8-bit, TFM metric fonts | DVI |
| ε-TeX | `\protected`, `\detokenize`, `\unexpanded`, 32,768 registers, bidi text | Same as TeX | DVI |
| pdfTeX | Direct PDF, micro-typography (margin protrusion, font expansion); runs `pdflatex` | 8-bit, Type 1 fonts | PDF or DVI |
| XeTeX | Unicode, system OpenType fonts, HarfBuzz shaping; runs `xelatex` | UTF-8, OpenType | XDV, then PDF |
| LuaTeX | Embedded Lua with callbacks into TeX's internal node lists; runs `lualatex` | UTF-8, OpenType | PDF or DVI |
| LuaMetaTeX | Lean LuaTeX successor | UTF-8, OpenType | PDF (ConTeXt only) |

### Distributions and tools

TeX Live (yearly, all platforms), MiKTeX (Windows-first, installs packages on demand) and MacTeX (TeX Live for macOS) bundle engines, formats and several thousand packages from CTAN, the package archive. `latexmk` reruns the engine, BibTeX/Biber and makeindex until cross-references stop changing. Overleaf runs TeX Live in the browser.

For your project: you keep the meaning of the top three layers (document, packages, class) and replace the bottom two. Your compiler becomes a new "engine" whose output is semantic OOXML instead of positioned glyphs.

## How TeX reads input: the pipeline and category codes

TeX turns characters into pages through a pipeline Knuth describes as a digestive tract: eyes, mouth, gullet, stomach, then the page builder. The stages run interleaved, one token at a time, so a command executed in the stomach can change how the mouth reads the very next character. That feedback loop is why LaTeX has no fixed grammar.

&#91;embedded content: TeX's pipeline · 5 stages and the feedback loop\]

The tag on each stage says whether your compiler rebuilds it or replaces it.

### Tokens

A token is either a character paired with its category code, or a control sequence. A control word is the escape character plus letters (`\section`); a control symbol is the escape character plus one non-letter (`\%`, `\\`). An active character such as `~` behaves like a control sequence with a one-character name.

### The 16 category codes

| Code | Meaning | Default characters |
| --- | --- | --- |
| 0 | Escape | `\` |
| 1 | Begin group | `{` |
| 2 | End group | `}` |
| 3 | Math shift | `$` |
| 4 | Alignment tab | `&` |
| 5 | End of line | carriage return |
| 6 | Macro parameter | `#` |
| 7 | Superscript | `^` |
| 8 | Subscript | `_` |
| 9 | Ignored | null |
| 10 | Space | space, tab |
| 11 | Letter | A–Z, a–z (and `@` inside packages) |
| 12 | Other | digits, punctuation, everything else |
| 13 | Active | `~` |
| 14 | Comment | `%` |
| 15 | Invalid | delete |

### Reader states

The mouth is a three-state machine, and these rules explain most of LaTeX's whitespace behaviour.

| State | Entered | A space character | End of line |
| --- | --- | --- | --- |
| N (new line) | Start of every line | Skipped | Emits `\par`, so a blank line ends a paragraph |
| M (mid-line) | After most characters | Emits one space token, moves to S | Emits a space |
| S (skipping blanks) | After a space or a control word | Skipped | Dropped |

### Why a static parser fails

```latex
\makeatletter
\def\@title{Draft}   % '@' is a letter here, so \@title is ONE control sequence
\makeatother
\verb|\textbf{x}|    % \verb switches catcodes first, so this prints literally
```

A tool that tokenizes the whole file up front gets both lines wrong. For your compiler: tokenize lazily with a mutable catcode table owned by the expander. Support `\makeatletter`, `\verb`, verbatim-like environments (`verbatim`, `lstlisting`, `minted`, `comment`) and `\ExplSyntaxOn` in v1; arbitrary `\catcode` assignments can come later.

## Macro expansion, grouping and registers

TeX's programming model is token substitution: a macro is a named token list with up to nine parameters, and expansion replaces the macro plus its arguments with the body until an unexpandable token reaches the stomach. The language is Turing-complete, so expansion can loop forever.

```latex
\def\pair#1#2{(#1, #2)}                % undelimited parameters
\def\range#1--#2.{from #1 to #2}       % delimited: #1 ends at "--", #2 at "."
\newcommand{\vect}[2][n]{#2_1,\dots,#2_{#1}} % LaTeX: optional first argument, default n
\NewDocumentCommand{\norm}{s m}{\IfBooleanTF{#1}{\lVert #2\rVert}{\|#2\|}} % xparse signature
```

Argument rules: an undelimited parameter takes one token or one braced group (braces stripped, leading spaces skipped). A delimited parameter takes everything up to its delimiter, with braces kept balanced.

### Expansion-control primitives

| Primitive | Effect |
| --- | --- |
| `\expandafter` | Expand the token after the next one first |
| `\noexpand` | Suppress expansion of the next token once |
| `\edef`, `\xdef` | Define with the body fully expanded at definition time |
| `\csname … \endcsname` | Build a control-sequence name from text, such as `\csname thesection\endcsname` |
| `\the` | Turn a register's value into tokens |
| `\if`, `\ifx`, `\ifnum`, `\ifdim`, `\ifcase` … `\fi` | Conditionals, resolved in the gullet |
| `\let` | Copy a meaning without expanding it |
| `\protected` (ε-TeX) | Keep a macro unexpanded inside `\edef` |

### Grouping and scope

`{ }`, `\begingroup … \endgroup` and every `\begin{env} … \end{env}` open a group. Assignments are local to the group unless prefixed with `\global`, which is why `{\bfseries bold}` stops at the brace. LaTeX counters are the exception: `\setcounter` and `\stepcounter` are always global.

### Registers and units

Registers hold typed values: `\count` (integers), `\dimen` (lengths), `\skip` (glue), `\muskip` (math glue), `\toks` (token lists), `\box`. LaTeX wraps them as `\newcounter`, `\newlength` and `\newsavebox`. All lengths are integers in scaled points (1 sp = 1/65,536 pt), so results are identical on every machine.

| Unit | Size | Note for your compiler |
| --- | --- | --- |
| pt | 1/72.27 in | TeX's point, slightly smaller than Word's |
| bp | 1/72 in | Equals Word's point |
| in, cm, mm | physical | 1 in = 1,440 twips exactly |
| pc | 12 pt |  |
| dd, cc | Didot point, cicero (12 dd) |  |
| em, ex | font-relative | Resolve against the current font size |
| mu | 1/18 em | Math spacing only |

Example: `\hspace{10pt}` is 9.963 Word points, which is 199 twips after rounding.

### What your expander needs in v1

Implement `\newcommand`, `\renewcommand`, `\providecommand`, `\newenvironment`, `\NewDocumentCommand` and `\NewDocumentEnvironment` (xparse specs `m o O{} s t d D r R v b`). Add `\def`, `\gdef`, `\edef`, `\let`, `\expandafter`, `\noexpand`, `\csname`, the common conditionals, `\newif`, `\@ifnextchar`, `\@ifstar`, `\DeclareMathOperator` and `\newtheorem`. Implement `\@ifnextchar` and `\@ifstar` natively instead of through `\futurelet`. Defer full expl3, `\afterassignment`, `\aftergroup` and `\uppercase` tricks, and cap every expansion with a step and depth budget.

## The typesetting engine: boxes, glue, line and page breaking

TeX's back end builds every page from boxes, glue and penalties, breaks each paragraph optimally as a whole, and fills pages greedily. Word replaces all of this when it opens your .docx, so this section covers what you are not building and the hints you pass instead.

### Boxes, glue and penalties

Every character is a box with width, height and depth taken from its font's metrics. Boxes stack into horizontal boxes (lines) and vertical boxes (pages). Glue is flexible space with a natural size, a stretch and a shrink; infinite orders `fil`, `fill`, `filll` beat any finite glue, which is how `\hfill` works. Penalties mark break points: −10,000 forces a break and +10,000 forbids one.

Badness measures how far a line's glue must stretch, where r is the ratio of stretch needed to stretch available:

```latex
b = \min\left(10000,\ 100\, r^{3}\right)
```

### Line breaking: the Knuth–Plass algorithm

Knuth and Plass (1981) treat a paragraph as one optimization problem. Every break with badness under `\tolerance` is feasible, and dynamic programming picks the set of breaks with the lowest total demerits. With line penalty l (default 10) and break penalty p ≥ 0, each line costs:

```latex
d = (l + b)^{2} + p^{2}
```

Extra demerits punish consecutive hyphenated lines, a hyphen on the second-to-last line, and neighbouring lines of very different tightness. TeX tries up to three passes: without hyphenation, with hyphenation, then with `\emergencystretch`.

### Hyphenation: Liang's patterns

Frank Liang's 1983 algorithm stores language-specific patterns with digits between letters; odd digits allow a hyphen, even digits forbid it, and the highest digit wins. Patterns live in a packed trie, and the hyph-utf8 collection covers dozens of languages. Word ships its own hyphenation, so you only declare the language.

### Page building and floats

The page builder adds lines to the current page until it exceeds `\vsize`, breaks at the cheapest point seen, and hands the page to the output routine. Inserts carry footnotes and floats. `figure` and `table` environments float to positions chosen by LaTeX's placement options `[htbp!]` and limits such as `\topfraction`; Word has no equivalent, because its floating pictures do not carry captions along.

### What Word does instead

| TeX mechanism | Word equivalent | What your compiler emits |
| --- | --- | --- |
| Knuth–Plass line breaking | Word's own line layout | Justification `w:jc="both"` when the class justifies |
| Liang hyphenation | Word hyphenation | `w:autoHyphenation` in settings, `w:lang` on text |
| Widow and club penalties | Widow/orphan control | `w:widowControl` |
| Heading and caption penalties | Keep with next | `w:keepNext` on headings and captions |
| `\samepage`, unbreakable boxes | Keep lines together | `w:keepLines` |
| `\newpage`, `\clearpage` | Page break | `<w:br w:type="page"/>` |
| `\chapter` starting a page | Page break before | `w:pageBreakBefore` on the Heading 1 style |
| Floats `[htbp]` | Inline objects | Figure at its source position, caption kept with it |
| `\vspace`, `\hspace` | Paragraph spacing, tabs | `w:spacing` before/after; fixed widths approximated |
| Micro-typography (`microtype`) | None | Nothing; accept the loss |

The result will not look like the PDF, and that is acceptable: people who need .docx (journals, co-authors, reviewers) restyle it anyway.

## Math, fonts and output formats

TeX's math engine classifies every symbol into one of eight atom types, spaces atoms from a fixed table, and sizes them by style. Word's equation engine follows the same model, driven by OMML structure and the font's OpenType MATH table, so your converter preserves structure and lets Word compute positions.

### Math atoms, spacing and styles

| Atom type | Examples | Role |
| --- | --- | --- |
| Ord | `x`, `1`, `\alpha` | Ordinary symbol |
| Op | `\sum`, `\int`, `\lim` | Large operator; takes limits |
| Bin | `+`, `-`, `\times` | Binary operator |
| Rel | `=`, `<`, `\leq` | Relation |
| Open | `(`, `[`, `\{` | Opening delimiter |
| Close | `)`, `]`, `\}` | Closing delimiter |
| Punct | `,`, `;` | Punctuation |
| Inner | `\left( … \right)` | Delimited subformula |

Spacing between atom pairs is thin (3 mu), medium (4 mu, flexible) or thick (5 mu, flexible), and mostly vanishes in scripts. Four styles (display, text, script, scriptscript), each with a cramped variant, decide sizes: a display fraction sets its numerator in text style, a text fraction in script style. TeX math fonts expose the layout constants as font parameters; Microsoft's OpenType MATH table, introduced with Cambria Math, encodes the same idea and is used by Word, XeLaTeX and LuaLaTeX.

For your converter: atom classes matter only where OMML needs them, mainly function names (`\sin`, `\operatorname`) and the limit placement of large operators.

### Fonts

TeX itself needs only font metrics (TFM files: widths, heights, depths, italic corrections, ligature and kerning programs); glyph shapes are added by the output driver. Knuth's Metafont produced Computer Modern, and Latin Modern is its OpenType descendant. LaTeX's New Font Selection Scheme (NFSS) picks fonts by encoding, family, series, shape and size; `fontspec` and `unicode-math` load system OpenType fonts under XeLaTeX and LuaLaTeX.

NFSS maps cleanly onto Word run properties:

| LaTeX | NFSS axis | Word run property |
| --- | --- | --- |
| `\textbf`, `\bfseries` | series b/bx | `w:b` |
| `\textit`, `\emph`, `\textsl` | shape it/sl | `w:i` |
| `\textsc` | shape sc | `w:smallCaps` |
| `\texttt`, `\textsf` | family tt/sf | `w:rFonts` set to a mono or sans family |
| `\small`, `\large`, `\Huge` … | size | `w:sz` in half-points |

At the 10 pt `article` default, sizes run 5, 7, 8, 9, 10, 12, 14.4, 17.28, 20.74 and 24.88 pt from `\tiny` to `\Huge`. Word sizes go in half-point steps, so round 14.4 to 14.5 (`w:sz="29"`). Latin Modern is rarely installed on recipients' machines, so map families to configured fonts (for example Cambria plus Cambria Math) rather than embedding fonts.

### Output formats

DVI is a device-independent list of glyphs at positions, rules, and `\special` strings that drivers interpret for colour, images and links. pdfTeX and LuaTeX write PDF directly; XeTeX writes XDV, which `xdvipdfmx` converts. Both formats are positioned glyphs with structure lost, whereas .docx is structure with positions left to Word: that inversion is the core of your design.

## The LaTeX2e layer: structure, counters, cross-references, citations

LaTeX adds document semantics to TeX: a class fixes the structure, packages add features, counters number things, and references resolve across several runs through auxiliary files. This is the layer you reproduce, except that your compiler holds the whole document in memory and resolves everything in one pass.

### Anatomy of a document

```latex
\documentclass[11pt,a4paper]{article}   % class + options
\usepackage{amsmath,graphicx}
\usepackage[margin=2.5cm]{geometry}
\newcommand{\R}{\mathbb{R}}             % user macro
\title{Results}\author{A. Author}
\begin{document}
\maketitle
\section{Introduction}\label{sec:intro}
See Figure~\ref{fig:plot} and \cite{knuth1984}.
\begin{figure}[t]
  \centering\includegraphics[width=.8\textwidth]{plot}
  \caption{Measured values.}\label{fig:plot}
\end{figure}
\bibliographystyle{plain}\bibliography{refs}
\end{document}
```

Standard classes are `article` (no chapters), `report` and `book` (chapters) and `letter`; popular alternatives are `beamer`, `memoir` and KOMA-Script. Class options set base size (10/11/12 pt), paper, `twocolumn`, `twoside` and `draft`. Sectioning runs `\part`, `\chapter`, `\section`, `\subsection`, `\subsubsection`, `\paragraph`, `\subparagraph`; `article` numbers down to subsubsection, and `\paragraph` is a run-in heading.

### Counters

`\newcounter{c}[parent]` creates a counter reset whenever `parent` steps. `\refstepcounter` increments it and records the value that the next `\label` will capture. Each counter prints through `\thec`, built from `\arabic`, `\roman`, `\Roman`, `\alph`, `\Alph` or `\fnsymbol`, for example `\thesubsection` = `\thesection.\arabic{subsection}`. Standard counters: `part`, `chapter`, `section` … `subparagraph`, `page`, `equation`, `figure`, `table`, `footnote`, `enumi`–`enumiv`.

### Cross-references need several runs

1. `\label{key}` writes `\newlabel{key}{{2.1}{7}}` to the .aux file when its page ships out, so the page number is known.
2. The next run reads the .aux at `\begin{document}`; now `\ref` prints 2.1 and `\pageref` prints 7.
3. If any label changed, LaTeX asks for a rerun; `latexmk` loops until stable.

| File | Written by | Read by |
| --- | --- | --- |
| `.aux` | LaTeX: labels, citation keys, bibliography commands | Next LaTeX run, BibTeX/Biber |
| `.toc`, `.lof`, `.lot` | LaTeX | Next run (table of contents, lists of figures and tables) |
| `.bbl` | BibTeX or Biber | Next run |
| `.bcf` | biblatex | Biber |
| `.idx` → `.ind` | LaTeX → makeindex or xindy | Next run |
| `.log` | Engine | You |

### Bibliographies

Classic BibTeX reads the citation keys from .aux, the entries from .bib and a style written in its stack language (.bst), then writes a `thebibliography` environment to .bbl. biblatex with Biber moves styles into LaTeX macros, sorts Unicode properly, adds entry types such as `@online` and `@dataset`, and provides `\textcite`, `\parencite`, `\autocite`. natbib adds author–year `\citet` and `\citep`. The .bib format has traps your parser must handle: `@string` macros, `#` concatenation, TeX accents in fields (`{\"o}`) and BibTeX's three name forms ("First von Last", "von Last, First", "von Last, Jr, First").

For your compiler: parse .bib into CSL-JSON and format with a Citation Style Language processor, mapping `plain`, `alpha`, `ieeetr`, `apalike` and similar to their nearest CSL styles.

### Modern LaTeX

Since 2020 the kernel includes the expl3 programming layer, `\NewDocumentCommand` and a general hook system ([LaTeX Project news](https://latex-project.org/news)). expl3 code reads like `\tl_set:Nn \l_my_tl {x}`: module, function, then an argument signature; `\ExplSyntaxOn` makes `_` and `:` letters and ignores spaces. `\DocumentMetadata{…}` before `\documentclass` switches on tagged, accessible PDF. Treat expl3 inside documents as out of scope for v1, but recognise `\ExplSyntaxOn … \ExplSyntaxOff` blocks so they fail with a clear diagnostic.

## Existing converters, and why LaTeX conversion is hard

No existing tool turns arbitrary LaTeX into good .docx. Even LaTeXML, which emulates TeX itself and powers arXiv's HTML papers, converts only about 75% of new submissions without errors ([Ginev et al., 2026](https://arxiv.org/pdf/2605.16562)). A new tool wins by handling the common subset excellently, not by covering everything.

### Why it is hard

| Problem | Example | Consequence for a converter |
| --- | --- | --- |
| No static grammar | catcode changes, `\verb`, `\makeatletter` | Must tokenize while executing |
| Turing-complete macros | `\def` recursion, `\csname` tricks, expl3 | Needs a bounded interpreter, not a parser |
| Presentational markup | `\vspace`, `\raisebox`, `minipage`, `\parbox` | No semantic equivalent in Word |
| Package long tail | Thousands of CTAN packages, new ones every year | Coverage erodes; arXiv's error-free rate slipped to 75% as authors adopted new packages ([source](https://arxiv.org/pdf/2605.16562)) |
| Graphics languages | TikZ, PGFPlots, `picture`, xy-pic | Needs a real TeX run rendered to an image |

### How existing tools cope

| Tool | Approach | Output | Strength | Gap for .docx |
| --- | --- | --- | --- | --- |
| [Pandoc](https://github.com/jgm/pandoc/releases) 3.11 (Aug 2026, GPL) | Own LaTeX parser with simple macro expansion → Pandoc AST → writers; math via its texmath library, citations via CSL | .docx and 40+ formats; runs in the browser via WASM since 3.9 | Mature, widely used, `reference.docx` styling | Lowest-common-denominator AST; numbered cross-references usually need the pandoc-crossref filter; unknown packages dropped |
| [LaTeXML](https://arxiv.org/pdf/2605.16562) (NIST, Perl) | Re-implements TeX's mouth, gullet and stomach with per-package bindings; now loads unbound packages raw | XML → HTML + MathML | Most faithful macro handling; arXiv-scale; 97% of papers yield some HTML | No .docx writer; a Rust port needed about 150,000 lines to pass its core tests |
| [tex4ht / make4ht](https://www.kodymirus.cz/make4ht/make4ht-doc.html) | Runs real LaTeX with hook macros, then post-processes a special DVI | HTML5, XHTML, ODT, TEI, DocBook, JATS | Best package compatibility, because real TeX executes | Needs a TeX installation; no direct .docx (ODT → LibreOffice → .docx) |
| Typst tooling | Typst has no built-in .docx export; the community tool typlite goes through Typst's experimental HTML export | .docx with formulas as images ([forum, Oct 2025](https://forum.typst.app/t/exporting-to-docx-combining-pdf2docx-and-pandoc/6644)) | Real compiler semantics | Equations are not editable; users say only Pandoc handles math well |

The Typst thread is a useful demand signal: researchers write in one system but still must submit and review in Word, and editable equations are the part every workaround gets wrong.

### Lessons for your design

1. Copy Pandoc's shape (own front end → document model → writer), but give it LaTeXML's discipline at the front: a real tokenizer and macro expander.
2. Copy none of TeX's back end; Word is the typesetter.
3. Measure coverage from day one with arXiv's two signals: which packages fail most often across a corpus, and which failures users report.
4. Borrow tex4ht's escape hatch as an option: when a TeX installation exists, render unsupported fragments such as TikZ to SVG in a sandboxed run.

Your edge over Pandoc, if you deliver it: token-level macro expansion, native Word fields for captions, cross-references and the table of contents, correct equation numbering, class-aware templates, compiler-grade diagnostics, and a sandbox by default. Re-check each claim against the current Pandoc release before marketing it.

## How .docx works: standard, package, minimal file

A .docx file is a ZIP archive of XML "parts" linked by relationship files, and three parts are enough for Word to open it. The format is Office Open XML, standardized as ECMA-376 and mirrored as ISO/IEC 29500.

### The standard

| ECMA-376 part (5th edition) | Covers | Date |
| --- | --- | --- |
| Part 1: Fundamentals and Markup Language Reference | WordprocessingML, DrawingML, Office Math (OMML), shared types | Dec 2016 |
| Part 2: Open Packaging Conventions (OPC) | ZIP container, parts, relationships, content types | Dec 2021 |
| Part 3: Markup Compatibility and Extensibility | `mc:Ignorable`, how newer extensions coexist | Dec 2015 |
| Part 4: Transitional Migration Features | Legacy features kept for old documents | Dec 2016 |

Source: [Ecma International, ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376/). The standard defines two conformance classes, Strict and Transitional; Word writes Transitional by default, so target Transitional. Microsoft documents Word-specific behaviour in its Open Specifications, notably \[MS-DOCX\] (Word extensions) and \[MS-OI29500\] (how Office implements the standard).

### Package layout

```text
paper.docx  (ZIP)
├── [Content_Types].xml            content type of every part
├── _rels/.rels                    package links → main document, properties
├── docProps/core.xml              title, author, dates (Dublin Core)
├── docProps/app.xml               application properties
└── word/
    ├── document.xml               body: paragraphs, tables, sections
    ├── styles.xml                 paragraph, character, table styles
    ├── numbering.xml              list and heading numbering
    ├── footnotes.xml              footnote bodies (endnotes.xml likewise)
    ├── settings.xml               compatibility mode, field updates, notes setup
    ├── header1.xml, footer1.xml   headers and footers
    ├── media/image1.png           embedded images
    └── _rels/document.xml.rels    rId → target for everything above
```

Parts reference each other through `r:id` attributes that resolve in the referring part's .rels file. An external hyperlink is just a relationship with `TargetMode="External"`.

### The minimal valid file

`[Content_Types].xml`:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
```

`_rels/.rels`:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="word/document.xml"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>
</Relationships>
```

`word/document.xml`:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello, Word.</w:t></w:r></w:p>
  </w:body>
</w:document>
```

### Packaging rules that break files

| Rule | Why |
| --- | --- |
| Write `[Content_Types].xml` as the first ZIP entry | Convention that strict consumers rely on |
| Give every part a content type (`Default` by extension or `Override` by name) | A part without one makes Word report corruption |
| Never add an `Override` for a folder such as `/word/media/` | Violates OPC; Pandoc fixed exactly this bug in 3.9 ([release notes](https://github.com/jgm/pandoc/releases)) |
| Keep part names unique ignoring case | OPC compares names case-insensitively |
| Use DEFLATE or STORE, no encryption | Maximum compatibility |
| Write UTF-8 and strip characters illegal in XML 1.0 (most control characters) | One stray control character makes the file unreadable |

## WordprocessingML: the document model you write into

Word's model is flat: the body is a sequence of paragraphs and tables, a paragraph holds runs of uniformly formatted text, and headings, lists, captions and cross-references are all paragraphs carrying a style, numbering or a field. Your writer's job is to flatten LaTeX's nested groups into that shape.

### Paragraphs and runs

```xml
<w:p>
  <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
  <w:r><w:t>Introduction</w:t></w:r>
</w:p>
<w:p>
  <w:r><w:t xml:space="preserve">Plain, </w:t></w:r>
  <w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>bold italic</w:t></w:r>
  <w:r><w:t xml:space="preserve"> and </w:t></w:r>
  <w:r><w:rPr><w:rStyle w:val="VerbatimChar"/></w:rPr><w:t>code</w:t></w:r>
</w:p>
```

Runs never nest, so `\textbf{a \emph{b} c}` becomes three runs with merged properties. `w:t` needs `xml:space="preserve"` whenever it starts or ends with a space; a tab is `<w:tab/>`, a line break `<w:br/>`, a page break `<w:br w:type="page"/>`.

### Element order is enforced

The schemas use ordered sequences, and out-of-order children are the most common cause of Word's "unreadable content" error. Emit through typed builders that always follow schema order:

| Container | Order of the children you will use |
| --- | --- |
| `w:pPr` | pStyle, keepNext, keepLines, pageBreakBefore, widowControl, numPr, pBdr, shd, tabs, spacing, ind, jc, outlineLvl, rPr, sectPr |
| `w:rPr` | rStyle, rFonts, b, i, caps, smallCaps, strike, vanish, color, sz, szCs, highlight, u, vertAlign, lang |

### Styles

`styles.xml` holds `w:docDefaults` plus `w:style` entries (paragraph, character, table, numbering) with `basedOn`, `next` and `link`. Precedence from weakest to strongest: document defaults, table style, numbering, paragraph style, character style, direct formatting. Map LaTeX semantics to styles rather than direct formatting so users and journal templates can restyle. Built-in style names are stable English (`heading 1`, `caption`, `footnote text`) while style IDs can be localized in templates, so match a user's template by `w:name`, not `w:styleId`.

### Numbering: lists and heading numbers

`numbering.xml` holds `w:abstractNum` definitions (up to 9 levels, each with start value, format such as `decimal` or `lowerRoman`, text such as `%1.` or `%1.%2`, and indents) and `w:num` instances that point at them. A paragraph joins a list through `w:numPr` (level + num ID). Three traps:

- Every `w:abstractNum` must come before every `w:num`.
- Reusing a num ID continues numbering, so each new `enumerate` needs its own `w:num` with a `startOverride`.
- Heading numbers (1, 1.1, 1.1.1) come from one multilevel definition linked to the Heading 1–3 styles.

### Sections and page setup

`w:sectPr` carries page size (`w:pgSz`; A4 = 11906 × 16838 twips, Letter = 12240 × 15840), margins, columns, header and footer references, page-number format and a distinct first page. The final `sectPr` is the last child of `w:body`; each earlier section ends with a paragraph whose `pPr` holds that section's `sectPr`. `geometry`, `\twocolumn` and `\pagenumbering{roman}` all land here.

### Fields: Word's dynamic content

A complex field is `begin` → instruction → `separate` → cached result → `end`. Word displays the cached result until fields are updated.

```xml
<w:r><w:fldChar w:fldCharType="begin"/></w:r>
<w:r><w:instrText xml:space="preserve"> REF lbl_fig_plot \h </w:instrText></w:r>
<w:r><w:fldChar w:fldCharType="separate"/></w:r>
<w:r><w:t>2</w:t></w:r>
<w:r><w:fldChar w:fldCharType="end"/></w:r>
```

| LaTeX | Field instruction |
| --- | --- |
| `\ref{fig:plot}` | `REF lbl_fig_plot \h` (target is a bookmark) |
| `\pageref{…}` | `PAGEREF lbl_… \h` |
| Caption number | `SEQ Figure \* ARABIC` (one sequence per float type) |
| `\tableofcontents` | `TOC \o "1-3" \h \z \u` |
| `\listoffigures` | `TOC \h \z \c "Figure"` |
| `\thepage` in a footer | `PAGE` |
| Total pages | `NUMPAGES` |

Always write the correct cached result, because your compiler knows every number; the file then reads correctly in viewers that never update fields. Page numbers are the one thing you cannot precompute, so set `w:updateFields` in settings.xml when the document has a table of contents or `\pageref`; Word then offers to update on open.

Bookmarks (`w:bookmarkStart` / `w:bookmarkEnd`) are field targets. Word accepts names of at most 40 characters, starting with a letter, using only letters, digits and underscores, so `fig:results-2024` needs a sanitized, collision-checked name such as `lbl_fig_results_2024`.

### Footnotes, tables, images, links

| Feature | Structure | Trap |
| --- | --- | --- |
| Footnote | `w:footnoteReference w:id="1"` in text; body in footnotes.xml | Word expects separator and continuation-separator entries first (it writes them with IDs -1 and 0) |
| Table | `w:tbl` → `w:tblPr`, `w:tblGrid`, `w:tr` → `w:tc` | Every cell must contain at least one paragraph; `\multicolumn` = `w:gridSpan`, `\multirow` = `w:vMerge` |
| Image | `w:drawing` → `wp:inline` → `pic:pic` → `a:blip r:embed="rId5"` | `wp:docPr` IDs must be unique; sizes in EMU; PDF and EPS figures are not valid images and must be converted |
| SVG image | PNG blip plus an `svgBlip` extension | Older Word versions show only the PNG fallback |
| Hyperlink | `w:hyperlink r:id` (external) or `w:anchor` (bookmark) | External targets need `TargetMode="External"` |

### Units

| Unit | Size | Used for |
| --- | --- | --- |
| Twip (dxa) | 1/20 pt = 1/1,440 in | Page size, margins, indents, spacing, tab stops, table widths |
| Half-point | 0.5 pt | Font size (`w:sz`) |
| Eighth-point | 0.125 pt | Border widths |
| EMU | 1/914,400 in (12,700 per pt) | Drawing sizes |
| Fiftieth of a percent | 5,000 = 100% | Table widths with `w:type="pct"` |
| 240ths of a line | 240 = single spacing | `w:spacing w:line` with `lineRule="auto"` |

### settings.xml essentials

Set `compatibilityMode` to 15 inside `w:compat`, or Word opens the file in Compatibility Mode. Add `w:updateFields` when needed, `w:footnotePr`, `w:defaultTabStop`, `w:autoHyphenation`, and `w:evenAndOddHeaders` for `twoside` documents.

## Math in Word: OMML and equation numbering

Emit every equation as OMML (Office Math Markup Language), Word's native math format: it stays editable, renders through Word's math engine in Cambria Math, and survives editing by co-authors. Images and Word's own LaTeX input mode are not viable targets.

### Why not the alternatives

| Alternative | Why it fails |
| --- | --- |
| Equations as images | Not editable, scale badly; this is the main complaint about Typst's typlite route |
| Word's LaTeX input mode | It is an interactive editing feature with its own dialect: no `\begin … \end`, so matrices are typed as `\matrix{a & b \\ c & d}`, and some keywords are unsupported ([Microsoft Support](https://support.microsoft.com/en-us/word/linear-format-equations-using-unicodemath-and-latex-in-word)) |
| MathML in the file | .docx stores OMML; Office's MathML-to-OMML stylesheet ships with Office, and its redistribution terms are unclear, so do not depend on it |

### OMML structure

OMML lives in the namespace `http://schemas.openxmlformats.org/officeDocument/2006/math` (prefix `m`). Display math is `<m:oMathPara><m:oMath>…</m:oMath></m:oMathPara>` in its own paragraph; inline math is an `<m:oMath>` among the runs of a paragraph. `\frac{a}{b} + x^2` becomes:

```xml
<m:oMath>
  <m:f>
    <m:num><m:r><m:t>a</m:t></m:r></m:num>
    <m:den><m:r><m:t>b</m:t></m:r></m:den>
  </m:f>
  <m:r><m:t>+</m:t></m:r>
  <m:sSup>
    <m:e><m:r><m:t>x</m:t></m:r></m:e>
    <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
  </m:sSup>
</m:oMath>
```

### LaTeX math → OMML

| LaTeX | OMML |
| --- | --- |
| `\frac`, `\dfrac`, `\tfrac`; `\binom` | `m:f`; `\binom` = no-bar `m:f` inside an `m:d` |
| `x^a`, `x_b`, `x_b^a` | `m:sSup`, `m:sSub`, `m:sSubSup` |
| `{}_a^b X` (prescripts) | `m:sPre` |
| `\sqrt[n]{x}` | `m:rad` (hide the degree when there is no index) |
| `\sum`, `\int`, `\prod` with limits | `m:nary` with `m:chr` and limit location `undOvr` or `subSup` |
| \`\\left( … \\middle | … \\right)\` |
| `matrix`, `pmatrix`, `bmatrix`, `cases` | `m:m`, wrapped in `m:d` for the delimiters |
| `align`, `gather`, `aligned`, `split` | `m:eqArr`, one element per row |
| `\hat`, `\tilde`, `\vec`, `\dot` | `m:acc` with the accent character |
| `\overline`, `\underline` | `m:bar` (top or bottom) |
| `\overbrace`, `\underbrace` | `m:groupChr`, plus `m:limUpp`/`m:limLow` for the label |
| `\lim_{x\to 0}`, `\underset`, `\overset` | `m:limLow`, `m:limUpp` |
| `\sin x`, `\operatorname{tr} A` | `m:func` with `m:fName` |
| `\text{…}` | `m:r` with normal-text run properties |
| `\mathbf`, `\mathrm`, `\mathcal`, `\mathbb`, `\mathfrak` | Run style (`p`, `b`, `i`, `bi`) and script (`script`, `fraktur`, `double-struck`) |
| `\boxed`, `\phantom` | `m:borderBox`, `m:phant` |
| `\alpha`, `\leq`, `\infty` … | Unicode characters in `m:t`; use the unicode-math package's command-to-code-point table |

### Equation numbering

Word has no per-equation number attached to the math itself, so you build one. Every option puts a bookmark around the number so `\eqref` becomes a REF field.

| Approach | How | Strength | Weakness |
| --- | --- | --- | --- |
| A. Tab-stop paragraph (default) | Center tab at mid-width, right tab at the margin: tab, equation, tab, "(", SEQ field, ")" | Light, cross-reference friendly | The equation is technically inline, so force display-style limits; long equations collide with the number |
| B. Borderless three-column table | Empty cell, centered equation, right-aligned number | Robust layout in Word and LibreOffice | A table in the text flow; noisier for screen readers |
| C. Word's own equation numbering | Mirror what Word writes when a user numbers an equation in its editor | Most native | Inspect a Word-made sample before relying on it; support in other viewers unverified |

Use A, fall back to B for equations wider than about 70% of the text width, and make the choice configurable.

### Traps

- A paragraph containing only one inline equation is shown by Word as display math; Pandoc adds a zero-width space to stop this ([3.10 release notes](https://github.com/jgm/pandoc/releases)).
- LaTeX lets display math sit mid-paragraph. In Word the equation needs its own paragraph, so split the paragraph and give the continuation a style without first-line indent.
- `\tag`, `\notag` and `\nonumber` decide numbering per row in `align`; a `\label` binds to its own row.
- Learn OMML by example: build equations in Word, save, unzip, read `document.xml`, and keep those files as golden tests.

### Converter options

Write your own LaTeX-math-AST-to-OMML converter for full control. Use Pandoc's output, produced by its texmath library, as a test oracle for differential testing. A MathML intermediate (for example via Temml) only pays off if you also want HTML output later.

## Mapping LaTeX to .docx

Most LaTeX structure has a native Word equivalent; the lossy cases are floats, manual spacing, boxes and graphics code, which the compiler approximates and reports as warnings. This table is the v1 scope contract.

| LaTeX | .docx representation | Fidelity |
| --- | --- | --- |
| `\documentclass` + options | Template (reference.docx): styles, page size, base font size | Native |
| `\title`, `\author`, `\date`, `\maketitle` | Title and Author paragraphs; `dc:title`, `dc:creator` in core.xml | Native |
| `abstract` | Abstract paragraph style | Native |
| `\section` … `\subsubsection` | Heading 1–3 with multilevel numbering | Native |
| `\section*` | Heading style with numbering switched off | Native |
| `\chapter` (report, book) | Heading 1 with page break before; sections move to Heading 2 | Native |
| `\paragraph` (run-in heading) | Bold run-in character style, or Heading 4 | Approximate |
| `\appendix` | Restart heading numbering as A, B, C | Native |
| `\textbf`, `\textit`, `\emph`, `\texttt`, `\textsc`, `\underline` | Run properties or character styles; nested `\emph` toggles back to upright | Native |
| `\footnote`, `\footnotemark` / `\footnotetext` | Footnote part plus reference run | Native |
| `itemize`, `enumerate`, `enumitem` labels | Numbering definitions (`numFmt`, `lvlText`) | Native |
| `description` | Hanging indent with bold term | Approximate |
| `tabular`, `tabularx`, `longtable` | `w:tbl`; \` | `and`\\hline`→ borders;`l c r`→ cell alignment;`p{3cm}\` → fixed width; repeated header rows |
| `\multicolumn`, `\multirow`, `booktabs` | `w:gridSpan`, `w:vMerge`, top/mid/bottom borders | Native |
| `figure` + `\includegraphics` + `\caption` | Inline picture paragraph + Caption paragraph with SEQ field, kept together | Approximate (no floating) |
| `subcaption` | Borderless table of images with sub-captions | Approximate |
| `\label`, `\ref`, `\pageref`, `\eqref`, `\autoref`, `\cref` | Bookmark + REF/PAGEREF fields with cached text; `\cref` adds the name ("Figure 3") | Native |
| `\tableofcontents`, `\listoffigures`, `\listoftables` | TOC fields | Native |
| `equation`, `align`, `gather`, `multline` | OMML + numbering layout (math section) | Native or approximate |
| `\cite`, `\citep`, `\citet`, `\parencite`, `\textcite` | CSL-formatted text, hyperlinked to the bibliography entry | Native |
| `thebibliography`, `\printbibliography` | Bibliography-style paragraphs with bookmarks | Native |
| `\href`, `\url` | `w:hyperlink` with external relationship | Native |
| `verbatim`, `lstlisting`, `minted` | Code paragraph style (mono font, proofing off), coloured runs from a highlighter | Native |
| `quote`, `quotation`, `verse` | Quote styles | Native |
| `\newpage`, `\clearpage`; `\\` | Page break; `w:br` | Native |
| `~`, `--`, `---`, ``` `` '' ```, `\ldots` | No-break space, en dash, em dash, curly quotes, ellipsis | Native |
| `\'e`, `\"o`, `\c{c}`, `\v{s}` | Precomposed Unicode (NFC) | Native |
| `\centering`, `center`, `flushleft`, `flushright` | Paragraph alignment | Native |
| `\hspace`, `\vspace`, `\vfill`, `\smallskip` | Spacing before/after; fixed-width spaces | Approximate |
| `minipage`, `\parbox`, `\makebox`, `\raisebox` | Table cell, text box, or flattened content | Lossy |
| `geometry` | `w:pgSz`, `w:pgMar` | Native |
| `fancyhdr`, `\pagestyle` | Header and footer parts with PAGE fields | Approximate |
| `\twocolumn`, `multicols` | Section with `w:cols` | Native |
| `xcolor` (`\textcolor`, `\colorbox`) | `w:color`, `w:shd` | Native |
| `babel`, `polyglossia` | `w:lang` on runs and defaults; right-to-left via `w:bidi` / `w:rtl` | Native |
| `\newtheorem` environments | Bold label + SEQ number + body style | Native |
| `\index` | XE fields + an INDEX field that Word builds | Native |
| `\todo`, `\marginpar` | Word comments (comments.xml) | Approximate |
| `siunitx` (`\qty`, `\num`) | Formatted text with thin spaces | Approximate |
| TikZ, PGFPlots, `picture` | SVG + PNG pre-rendered by a sandboxed TeX run, else placeholder + warning | Lossy |
| `\input`, `\include`, `\subfile` | Inlined at compile time (inside the sandbox root) | Native |

### Who computes what

| Item | Computed by | Note |
| --- | --- | --- |
| Line breaks, page breaks, hyphenation | Word | You pass hints only |
| Page numbers (PAGE, PAGEREF, TOC page column) | Word | The one thing you cannot precompute; set `w:updateFields` |
| Heading and list numbers | Word, from numbering.xml | Also compute them yourself for cached REF text |
| Caption, equation and theorem numbers | You (cached) and Word (SEQ on update) | Same counters and reset rules on both sides |
| Cross-reference text | You (cached) and Word (REF on update) |  |
| Citations and bibliography | You (CSL) | Word never recomputes them |
| Math layout | Word | You provide structure only |

Chapter-style numbers such as "Figure 2.3" need two fields: `STYLEREF 1 \s` for the chapter number and `SEQ Figure \s 1` to restart at each Heading 1. Test that updating all fields in Word reproduces your cached numbers; if they differ, the document visibly changes the first time a user presses F9.

## Architecture and key design decisions

The compiler is a six-stage pipeline (load, tokenize, expand, digest, resolve, write) in which only the first three resemble TeX. A typed document model in the middle keeps LaTeX's quirks away from OOXML's.

&#91;embedded content: compiler pipeline · 6 stages, 4 inputs\]

Stages 1–3 rebuild TeX's reader; stages 4–6 swap its typesetter for a document model and an OOXML writer, and Word does the final layout.

### Decision 1: compatibility strategy

| Option | What it means | Verdict |
| --- | --- | --- |
| Full TeX emulation (LaTeXML route) | Re-implement the TeX engine plus per-package bindings | Too large: LaTeXML's Rust port needed about 150,000 lines |
| Run real TeX and post-process (tex4ht route) | Needs a TeX installation; structure recovered from DVI hooks | Keep only as an optional fallback for graphics |
| Pragmatic subset with a real expander (recommended) | Lexer + bounded expander + semantic handlers + plugin API | Best value per line of code |
| New LaTeX-like language (Typst route) | Clean grammar, no catcodes | Abandons existing .tex files, which defeats the goal |

### Decision 2: the stages

| Stage | Input → output | Responsibilities |
| --- | --- | --- |
| 1. Loader | Project folder → source map | Resolve `\input`/`\include` inside the sandbox root; track file, line, column |
| 2. Lexer | Characters → tokens | Catcode-driven, lazy, one token at a time |
| 3. Expander | Tokens → expanded tokens | User macros, conditionals, scoped groups, step and depth budgets |
| 4. Digester | Tokens → document model | Command and environment handlers; mode stack (block, paragraph, math); builds lists, tables, math trees |
| 5. Resolver | Model → resolved model | Counters, numbering, labels, citations via CSL, bibliography, TOC entries; undefined-reference checks |
| 6. Writer | Model → .docx | Template styles, numbering.xml, fields, footnotes, media, schema-ordered XML, ZIP, validation |

The digester replaces TeX's stomach: instead of boxes it builds semantic nodes. TeX's modes become builder states: vertical mode is "between blocks", horizontal mode is "inside a paragraph", math mode is "building a math tree".

### Decision 3: a typed document model

Every node carries its source span, and the model is immutable after resolution. The model enables multi-pass resolution, JSON snapshot tests, and extra writers (HTML, ODT, Markdown) later at low cost. Its type definitions are in the code skeletons below.

### Decision 4: the extension system

A "package" is a module that registers command handlers with xparse-style signatures (`"s o m"`), environment handlers, counters, style roles and option handling. Simple packages can instead be shims written in LaTeX itself (a file of `\newcommand`s that reduce package commands to supported ones), so contributors need no TypeScript. An unknown `\usepackage` gives a warning; an unknown command gives a warning plus its arguments as text, or an error in `--strict` mode.

### Decision 5: templates and style roles

Follow Pandoc's reference.docx idea: the user supplies a .docx, and the writer takes its styles, numbering, theme, settings, headers and page setup. A role map (YAML) binds model roles to style names, for example `heading1 → "heading 1"`, `caption → "caption"`, `code → "Source Code"`, matched by `w:name` and created from defaults when missing. Ship presets per class: `article`, `report`, `book`.

### Decision 6: numbering and cross-references

The resolver applies LaTeX's own rules (counter resets, `\the` formats, appendix lettering), then emits each number twice: as cached text and as a field. Bookmark names are sanitized, unique and at most 40 characters. An undefined reference prints `??` and a warning, as LaTeX does.

### Decision 7: the bibliography pipeline

.bib parser (strings, concatenation, TeX accents, name parsing) → CSL-JSON → CSL processor with the chosen style → formatted runs for citations, plus bibliography paragraphs with bookmarks and links back from each citation. `thebibliography` environments pass through directly.

### Decision 8: diagnostics

Messages look like a compiler's: severity, code, location, excerpt and hint, with a JSON mode for editors and a future language server.

```text
warning[W013]: unknown command \mybox, rendered its argument as text
  --> chapters/intro.tex:42:7
   |
42 | \mybox{red}{Important}
   |       ^^^^^^^^^^^^^^^^
   = hint: define it with \newcommand or add a package handler
```

### Decision 9: deterministic output

Use stable IDs, sorted relationships and fixed ZIP timestamps, so identical input gives a byte-identical .docx. That makes golden tests diffable and builds reproducible.

## Security and sandboxing

Treat every .tex file as untrusted code. TeX documents can read files, write files and, in real engines, run commands, so the compiler must be safe by construction: no shell, no network, file access confined to the project folder, and hard resource limits.

The TeX engines show why "restricted mode" is not enough. [CVE-2023-32700](https://nvd.nist.gov/vuln/detail/cve-2023-32700) let a document compiled by LuaTeX before 1.17.0 run shell commands even with shell escape restricted (also TeX Live before 2023 r66984, MiKTeX before 23.5); Red Hat and NVD rate it High, CVSS 3.1 base 7.8 ([Red Hat advisory](https://access.redhat.com/security/cve/CVE-2023-32700)). [CVE-2023-32668](https://nvd.nist.gov/vuln/detail/cve-2023-32668) let the same versions make arbitrary network requests with default settings. Converters are exposed too: Pandoc 3.11 fixed a template-fetching bug that could read a local file instead of a remote one ([release notes](https://github.com/jgm/pandoc/releases)). Your design should lack these capabilities entirely rather than restrict them.

| Risk | Severity | Impact | Recommended action |
| --- | --- | --- | --- |
| Command execution (`\write18`, shell-escape packages such as `minted`, `pythontex`) | Critical | Full compromise of the machine or server | Implement no shell execution at all; highlight code natively. If the optional TeX graphics fallback is enabled, use a patched engine (LuaTeX ≥ 1.17.0) with shell escape off, inside a container with no network and read-only inputs. Warn when a document requests shell escape. |
| Arbitrary file read (`\input{/etc/…}`, `../`, `\includegraphics`, `\lstinputlisting`, symlinks) | High | Secret files embedded in the output .docx | Resolve every path against the project root; reject absolute paths and anything that escapes the root after resolving symlinks; allowlist extensions per command; cap file count and size; log every file read. |
| Arbitrary file write (`\openout`, `\write`) | High | Overwritten user files | Never write files from document code; treat these commands as no-ops with a warning; auxiliary state lives in memory. |
| Network access (remote images, `\input` of URLs, package fetching) | High for hosted use | Server-side request forgery, data exfiltration | No network I/O in the compiler; reject remote resources with a warning; packages come only from bundled files. |
| Resource exhaustion (recursive macros, exponential expansion, deep nesting, huge images) | Medium; High for hosted use | Hangs, out-of-memory, denial of service | Budgets for expansion steps, recursion depth, token count, wall-clock time, memory and output size; cancellation; a dedicated error naming the macro and its expansion stack. |
| Malicious template .docx (ZIP bomb, path-traversal entries, XML external entities) | Medium | Denial of service or local file disclosure during template import | Read the ZIP in memory with entry-count, size and compression-ratio limits; never extract to disk; reject `..` and absolute entry names; parse XML with DTDs and external entities disabled. |
| Dangerous output (raw OOXML passthrough, external relationships, fields such as INCLUDETEXT, INCLUDEPICTURE or DDE, remote attached templates) | High | Recipients' Word fetches remote content when the file opens | Emit only an allowlist of fields (REF, PAGEREF, SEQ, TOC, PAGE, NUMPAGES, STYLEREF, XE, INDEX); hyperlinks are the only external relationships; strip external references from user templates; raw OOXML only behind an explicit flag; scan the finished package before writing it. |
| Metadata leakage (author names, absolute paths, timestamps) | Low | Privacy leak | Neutral media names (`image1.png`); metadata only from `\title`/`\author` or config; option to omit timestamps. |

For a hosted version: run each job in its own isolated container or micro-VM as an unprivileged user, with no network, CPU and memory quotas, and ephemeral storage. Return diagnostics to the caller, but keep document text and excerpts out of persistent server logs.

## Tech stack

Build it in TypeScript. One codebase then runs as a command-line tool, in a browser and inside a VS Code extension, and existing libraries cover every subproblem except the ones you should own anyway: the expander, the OOXML writer and the OMML converter.

| Criterion | TypeScript (recommended) | Rust | Python |
| --- | --- | --- | --- |
| Distribution | npm package, standalone binary, runs in browsers | Single native binary; WASM for browsers | pip; standalone binaries are awkward |
| Speed | Ample for documents | Fastest | Adequate |
| Compiler ergonomics | Good (discriminated unions) | Excellent (enums, pattern matching) | Fair |
| CSL bibliography engine | citeproc-js, mature | hayagriva, Typst's library | citeproc-py, less complete |
| LaTeX parsing references | unified-latex (MIT) | tree-sitter-latex, texlab | pylatexenc |
| Web playground later | Native | Via WASM | Hard |
| Learning curve | Low | High | Lowest |

Choose Rust instead if a single fast native binary is the priority; the architecture is identical.

### Library choices (TypeScript)

| Concern | Choice | Note |
| --- | --- | --- |
| Lexer, expander, digester | Write your own | The core of the product. [unified-latex](https://github.com/siefkenj/unified-latex) is a good reference and test oracle, but its README says it does not handle redefined control sequences or complex TeX macros |
| LaTeX math → OMML | Write your own | Full control; compare against Pandoc's output in tests |
| OOXML writer | Thin in-house typed builders | Generic .docx libraries suit prototypes but make fields, OMML, bookmarks and template merging hard to control |
| ZIP | fflate | Small, pure JavaScript, works in Node and browsers |
| XML parsing (templates only) | A non-validating parser with DTDs and entities disabled | Blocks external-entity attacks |
| Bibliography | .bib parser → CSL-JSON → citeproc-js | citeproc-js is dual-licensed CPAL 1.0 or AGPL 3.0 ([LICENSE](https://raw.githubusercontent.com/Juris-M/citeproc-js/master/LICENSE)); get a licence review before shipping closed-source, or compile hayagriva to WASM |
| Citation styles | Official CSL styles repository | Thousands of journal styles |
| Code highlighting | shiki | Coloured tokens map straight onto runs |
| Images | `image-size` for dimensions; resvg for SVG → PNG fallbacks | PDF figures need pdf.js (Apache-2.0) or an external tool such as pdftocairo or MuPDF, which are GPL/AGPL; check licences |
| CLI and watch mode | commander, chokidar |  |
| Tests | vitest; Microsoft's Open XML SDK validator (.NET) in CI; LibreOffice headless for rendering |  |
| Packaging | npm, plus single-file executables via Node SEA, Bun or Deno compile |  |

Pick a permissive licence (MIT or Apache-2.0) for adoption. Pandoc is GPL, so use it only as an external test oracle and never copy its code.

## Repository structure

Use a TypeScript monorepo with one package per pipeline stage, so each stage can be tested alone and the writer never depends on the LaTeX front end. "texdocx" is a working name.

```text
texdocx/
├── packages/
│   ├── core/         tokens, catcodes, lexer, expander, source maps, diagnostics
│   ├── model/        document model types, builders, JSON snapshots
│   ├── digest/       mode stack, command/environment registry, kernel handlers
│   ├── latex-std/    standard classes + packages: amsmath, graphicx, hyperref, geometry …
│   ├── math/         math parser, math tree, OMML writer (+ MathML writer for debugging)
│   ├── resolve/      counters, labels, numbering, TOC entries, cross-references
│   ├── bib/          .bib parser, CSL-JSON, CSL bridge
│   ├── docx/         OPC packager, part writers, schema-ordered builders, template merge, package scan
│   ├── cli/          command line, config, watch mode, sandbox policy
│   └── playground/   (later) browser demo
├── templates/        default reference .docx per class + role maps (YAML)
├── shims/            package shims written in LaTeX (\newcommand-based)
├── tests/
│   ├── unit/         per-stage tests
│   ├── fixtures/     small focused .tex inputs
│   ├── golden/       expected normalized XML per fixture
│   ├── corpus/       licence-cleared real papers for coverage statistics
│   ├── visual/       rendered PNG baselines
│   └── fuzz/         lexer and expander fuzz targets
├── tools/
│   ├── validator/    .NET wrapper around the Open XML SDK validator
│   └── render/       LibreOffice → PDF → PNG diff scripts
└── docs/             user guide, supported-commands matrix, package-author guide
```

Enforce the dependency direction with a lint rule: `digest` depends on `core`, `math` and `model`; `resolve` depends on `model` and `bib`; `docx` depends only on `model`. Keeping the writer blind to LaTeX is what later makes an HTML or ODT writer cheap.

## Implementation roadmap

Eight phases take one experienced full-time developer to a journal-article MVP in 21 weeks and a hardened v1 in 24 weeks. Each phase ends at a gate with a measurable exit test; durations and thresholds are estimates and targets, not measurements.

&#91;embedded content: roadmap · 8 phases over 24 weeks\]

Math is the longest phase at five weeks; the exit test behind each diamond is in the table below.

| Phase | Weeks | Deliverables | Exit gate |
| --- | --- | --- | --- |
| 0. Output spike | 1 | Hand-written minimal .docx; writer skeleton; CI running the Open XML SDK validator and a LibreOffice render | Generated file opens in Word, LibreOffice and Google Docs with zero validator errors |
| 1. Core text | 2–4 | Lexer (catcodes, reader states), basic expander, digester for paragraphs, sections, emphasis, special characters, quotes, dashes, accents; default template; CLI | 10 text-only fixture papers convert; golden tests green |
| 2. Macros and files | 5–7 | `\newcommand` family, `\newenvironment`, `\NewDocumentCommand`, `\def` subset, `\let`, conditionals, scoped groups, sandboxed `\input`/`\include`, `\makeatletter`, verbatim catcode switching, budgets | Macro-heavy fixtures pass; 1 hour of fuzzing finds no hang or crash |
| 3. Structure | 8–11 | Lists (nesting, restarts, `enumitem` labels), tables (`tabular`, `tabularx`, `longtable`, spans, `booktabs`), footnotes, links, images (PNG, JPEG, SVG, converted PDF), figures and captions, highlighted code, title and abstract, `geometry`, headers and footers | Structure corpus converts; images sized correctly; tables pass validation |
| 4. Math | 12–16 | Math parser; OMML writer covering the mapping table; amsmath environments; operators, fonts, symbol table; equation numbering A and B; `\tag`, `\notag` | At least 95% of a 500-equation test set renders correctly (visual review plus diff against Pandoc) |
| 5. Cross-references | 17–18 | Counters, `\label`, `\ref`, `\eqref`, `\pageref`, `\cref`, `\autoref`; SEQ captions; heading numbering; TOC, LOF, LOT; appendix numbering; theorems | Updating all fields in Word changes nothing |
| 6. Bibliography (MVP) | 19–21 | .bib parser, CSL processing, natbib and biblatex commands, `\bibliographystyle` mapping, `thebibliography`, linked citations | Output matches reference renderings for 5 common CSL styles |
| 7. Templates and hardening (v1) | 22–24 | reference.docx support with name-based style mapping, class presets, diagnostics polish, `--strict`, documentation, packaging, 1.0 release | At least 90% of a 100-paper corpus converts without errors |

After v1, let corpus failure statistics pick the work: further packages (`siunitx`, `cleveref`, `subcaption`, `multicol`, right-to-left languages), the sandboxed TikZ-to-SVG fallback, a browser playground, and a VS Code extension with live diagnostics. Keep a supported-commands matrix generated from the handler registry so users can see the subset at any time.

## Code skeletons

These five pieces are the load-bearing walls of the codebase; everything else is handlers and tests around them. They are TypeScript sketches meant to be read and extended, not drop-in code.

### 1. Lexer: catcodes and reader states

```typescript
// packages/core/src/lexer.ts  (normalize CRLF to LF before lexing)
export const enum Cat { Escape, BeginGroup, EndGroup, MathShift, AlignTab, EndLine,
  Param, Sup, Sub, Ignored, Space, Letter, Other, Active, Comment, Invalid }

export type Token =
  | { kind: "char"; ch: string; cat: Cat; pos: number }
  | { kind: "cs"; name: string; pos: number }      // \section, \\, \%
  | { kind: "active"; ch: string; pos: number };   // ~ behaves like a macro

export class CatcodeTable {                        // one per group: \catcode is scoped
  private map = new Map<number, Cat>();
  constructor(private parent?: CatcodeTable) {}
  get(cp: number): Cat { return this.map.get(cp) ?? this.parent?.get(cp) ?? defaultCat(cp); }
  set(cp: number, cat: Cat) { this.map.set(cp, cat); }
}

const DEFAULTS: Record<string, Cat> = { "\\": Cat.Escape, "{": Cat.BeginGroup, "}": Cat.EndGroup,
  "$": Cat.MathShift, "&": Cat.AlignTab, "\n": Cat.EndLine, "#": Cat.Param, "^": Cat.Sup,
  "_": Cat.Sub, " ": Cat.Space, "\t": Cat.Space, "~": Cat.Active, "%": Cat.Comment,
  "\u0000": Cat.Ignored, "\u007f": Cat.Invalid };

function defaultCat(cp: number): Cat {
  const c = String.fromCodePoint(cp);
  if (c in DEFAULTS) return DEFAULTS[c];
  return (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) ? Cat.Letter : Cat.Other;
}

export class Lexer {
  private i = 0;
  private state: "N" | "M" | "S" = "N";
  constructor(private src: string, public cats: CatcodeTable) {}

  private peek(): number | undefined { return this.src.codePointAt(this.i); }
  private read(): number { const cp = this.src.codePointAt(this.i)!; this.i += cp > 0xffff ? 2 : 1; return cp; }

  next(): Token | null {
    while (this.i < this.src.length) {
      const pos = this.i, cp = this.read(), cat = this.cats.get(cp);
      switch (cat) {
        case Cat.Escape: {
          if (this.i >= this.src.length) return { kind: "cs", name: "", pos };
          const first = this.read();
          let name = String.fromCodePoint(first);
          if (this.cats.get(first) === Cat.Letter) {            // control word
            while (this.peek() !== undefined && this.cats.get(this.peek()!) === Cat.Letter)
              name += String.fromCodePoint(this.read());
            this.state = "S";                                    // eat following spaces
          } else {                                               // control symbol
            this.state = this.cats.get(first) === Cat.Space ? "S" : "M";
          }
          return { kind: "cs", name, pos };
        }
        case Cat.EndLine: {
          const was = this.state; this.state = "N";
          if (was === "N") return { kind: "cs", name: "par", pos };   // blank line
          if (was === "M") return { kind: "char", ch: " ", cat: Cat.Space, pos };
          continue;
        }
        case Cat.Space:
          if (this.state !== "M") continue;
          this.state = "S";
          return { kind: "char", ch: " ", cat: Cat.Space, pos };
        case Cat.Comment: {
          const nl = this.src.indexOf("\n", this.i);
          this.i = nl < 0 ? this.src.length : nl + 1;            // drop rest of line
          this.state = "N";
          continue;
        }
        case Cat.Ignored: continue;
        case Cat.Invalid: throw new Error(`invalid character at ${pos}`);
        case Cat.Active: this.state = "M"; return { kind: "active", ch: String.fromCodePoint(cp), pos };
        default: this.state = "M"; return { kind: "char", ch: String.fromCodePoint(cp), cat, pos };
      }
    }
    return null;
  }
}
```

### 2. The document model

```typescript
// packages/model/src/types.ts  (ListFormat, ColumnSpec, Row, Caption, PageSetup, BibEntry elided)
export interface Span { file: string; start: number; end: number }

export interface Marks { bold?: boolean; italic?: boolean; smallCaps?: boolean; mono?: boolean;
  underline?: boolean; color?: string; size?: number /* half-points */; lang?: string }

export type Inline =
  | { kind: "text"; text: string; marks: Marks }
  | { kind: "math"; tree: MathNode }
  | { kind: "footnote"; body: Block[] }
  | { kind: "ref"; label: string; form: "number" | "page" | "name+number" }
  | { kind: "cite"; keys: string[]; mode: "paren" | "text"; prefix?: string; locator?: string }
  | { kind: "link"; href: string; content: Inline[] }
  | { kind: "lineBreak" };

export type Block =
  | { kind: "heading"; level: number; numbered: boolean; content: Inline[]; label?: string; span: Span }
  | { kind: "paragraph"; role?: string; content: Inline[]; span: Span }
  | { kind: "list"; ordered: boolean; format?: ListFormat; items: Block[][]; span: Span }
  | { kind: "table"; columns: ColumnSpec[]; rows: Row[]; caption?: Caption; label?: string; span: Span }
  | { kind: "figure"; content: Block[]; caption?: Caption; label?: string; span: Span }
  | { kind: "equation"; rows: MathNode[]; numbered: boolean[]; labels: (string | null)[]; span: Span }
  | { kind: "code"; language?: string; text: string; span: Span }
  | { kind: "quote"; content: Block[]; span: Span }
  | { kind: "theorem"; name: string; numbered: boolean; content: Block[]; label?: string; span: Span }
  | { kind: "toc"; depth: number }
  | { kind: "pageBreak" };

export interface Document {
  meta: { title?: Inline[]; authors: Inline[][]; date?: Inline[]; lang?: string };
  page: PageSetup;
  blocks: Block[];
  bibliography?: BibEntry[];
}
```

### 3. Command registry with xparse-style signatures

```typescript
// packages/digest/src/kernel.ts
export interface Arg { present: boolean; tokens: Token[] }
export interface CommandDef { signature: string; handler: (ctx: Digester, args: Arg[]) => void }

export const kernel = new Map<string, CommandDef>([
  ["textbf",   { signature: "m", handler: (ctx, [a]) =>
      ctx.withMarks(m => ({ ...m, bold: true }), () => ctx.digest(a)) }],
  ["emph",     { signature: "m", handler: (ctx, [a]) =>
      ctx.withMarks(m => ({ ...m, italic: !m.italic }), () => ctx.digest(a)) }],  // nested \emph toggles
  ["section",  { signature: "s o m", handler: (ctx, [star, _toc, title]) =>
      ctx.heading(1, !star.present, title) }],
  ["label",    { signature: "m", handler: (ctx, [key]) => ctx.attachLabel(ctx.plainText(key)) }],
  ["footnote", { signature: "o m", handler: (ctx, [_n, body]) => ctx.footnote(body) }],
]);
// A package is a function that adds entries: registerGraphicx(registry), registerAmsmath(registry) …
```

### 4. OMML writer

```typescript
// packages/math/src/omml.ts
export type MathNode =
  | { k: "row"; items: MathNode[] }
  | { k: "atom"; text: string; style?: "p" | "b" | "i" | "bi"; normal?: boolean }
  | { k: "frac"; num: MathNode; den: MathNode; bar?: boolean }
  | { k: "sup"; base: MathNode; sup: MathNode }
  | { k: "sub"; base: MathNode; sub: MathNode }
  | { k: "subsup"; base: MathNode; sub: MathNode; sup: MathNode }
  | { k: "sqrt"; body: MathNode; index?: MathNode }
  | { k: "nary"; op: string; sub?: MathNode; sup?: MathNode; body: MathNode; limits: boolean }
  | { k: "delim"; open: string; close: string; body: MathNode[] };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function omml(n: MathNode): string {
  switch (n.k) {
    case "row": return n.items.map(omml).join("");
    case "atom": {
      const pr = n.normal ? "<m:rPr><m:nor/></m:rPr>" : n.style ? `<m:rPr><m:sty m:val="${n.style}"/></m:rPr>` : "";
      return `<m:r>${pr}<m:t xml:space="preserve">${esc(n.text)}</m:t></m:r>`;
    }
    case "frac": return `<m:f>${n.bar === false ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ""}`
      + `<m:num>${omml(n.num)}</m:num><m:den>${omml(n.den)}</m:den></m:f>`;
    case "sup": return `<m:sSup><m:e>${omml(n.base)}</m:e><m:sup>${omml(n.sup)}</m:sup></m:sSup>`;
    case "sub": return `<m:sSub><m:e>${omml(n.base)}</m:e><m:sub>${omml(n.sub)}</m:sub></m:sSub>`;
    case "subsup": return `<m:sSubSup><m:e>${omml(n.base)}</m:e><m:sub>${omml(n.sub)}</m:sub>`
      + `<m:sup>${omml(n.sup)}</m:sup></m:sSubSup>`;
    case "sqrt": return n.index
      ? `<m:rad><m:deg>${omml(n.index)}</m:deg><m:e>${omml(n.body)}</m:e></m:rad>`
      : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${omml(n.body)}</m:e></m:rad>`;
    case "nary": return `<m:nary><m:naryPr><m:chr m:val="${esc(n.op)}"/>`
      + `<m:limLoc m:val="${n.limits ? "undOvr" : "subSup"}"/>`
      + (n.sub ? "" : '<m:subHide m:val="1"/>') + (n.sup ? "" : '<m:supHide m:val="1"/>')
      + `</m:naryPr><m:sub>${n.sub ? omml(n.sub) : ""}</m:sub><m:sup>${n.sup ? omml(n.sup) : ""}</m:sup>`
      + `<m:e>${omml(n.body)}</m:e></m:nary>`;
    case "delim": return `<m:d><m:dPr><m:begChr m:val="${esc(n.open)}"/><m:endChr m:val="${esc(n.close)}"/></m:dPr>`
      + n.body.map(b => `<m:e>${omml(b)}</m:e>`).join("") + "</m:d>";
  }
}
```

### 5. Run properties in schema order, safe text, and the package

```typescript
// packages/docx/src/xml.ts
export const xmlText = (s: string) => s
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")   // illegal in XML 1.0
  .replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function rPr(m: Marks): string {          // always emitted in schema order
  const out: string[] = [];
  if (m.mono) out.push('<w:rStyle w:val="VerbatimChar"/>');
  if (m.bold) out.push("<w:b/>");
  if (m.italic) out.push("<w:i/>");
  if (m.smallCaps) out.push("<w:smallCaps/>");
  if (m.color) out.push(`<w:color w:val="${m.color}"/>`);
  if (m.size) out.push(`<w:sz w:val="${m.size}"/>`);
  if (m.underline) out.push('<w:u w:val="single"/>');
  if (m.lang) out.push(`<w:lang w:val="${m.lang}"/>`);
  return out.length ? `<w:rPr>${out.join("")}</w:rPr>` : "";
}

// packages/docx/src/package.ts
import { zipSync, strToU8 } from "fflate";
const FIXED = new Date(1980, 0, 1);                // ZIP (DOS) time starts in 1980: reproducible builds

export function packageDocx(parts: Map<string, string | Uint8Array>): Uint8Array {
  const files: Record<string, [Uint8Array, { mtime: Date }]> = {};
  const add = (path: string, data: string | Uint8Array) =>
    (files[path] = [typeof data === "string" ? strToU8(data) : data, { mtime: FIXED }]);
  add("[Content_Types].xml", parts.get("[Content_Types].xml")!);   // first entry by convention
  for (const [path, data] of [...parts].sort(([a], [b]) => a.localeCompare(b)))
    if (path !== "[Content_Types].xml") add(path, data);
  return zipSync(files, { level: 6 });
}
```

A first end-to-end test then reads like this:

```typescript
test("section and emphasis", async () => {
  const docx = await compile(String.raw`\documentclass{article}\begin{document}
    \section{Intro}Hello \emph{world}.\end{document}`);
  expect(normalize(await readPart(docx, "word/document.xml"))).toMatchSnapshot();
  expect(await validateOpenXml(docx)).toEqual([]);   // .NET validator from tools/validator
});
```

## Testing and QA

Test each stage in isolation, then test the whole pipeline against three oracles: the Open XML validator (is the file legal?), rendering (does it look right in Word and LibreOffice?) and a corpus of real papers (does it work in practice?).

| Layer | What it checks | Tooling | Cadence |
| --- | --- | --- | --- |
| Unit | Reader states, catcodes, argument parsing, delimited parameters, scoping, each handler, math parser, OMML per node | vitest | Every commit |
| Golden XML | Fixture .tex → normalized `document.xml`, `styles.xml`, `numbering.xml` snapshots | vitest snapshots, canonical XML | Every commit |
| Schema validation | Every generated .docx | Open XML SDK validator (.NET CLI) | Every commit |
| Opens cleanly | LibreOffice converts the file to PDF without error | `soffice --headless --convert-to pdf` | Every commit |
| Security fixtures | Path traversal, `\write18`, file writes, macro bombs, ZIP bombs in templates | Dedicated fixture suite | Every commit |
| Visual regression | PDF pages → PNG → pixel diff against baselines, with tolerance | pdftoppm + pixelmatch | Nightly |
| Differential | Math structure and text content compared with Pandoc's output for the same input | pandoc CLI | Nightly |
| Fuzzing | Random and mutated .tex: no crash, no hang past budget, output always valid | fast-check property tests | Nightly |
| Real Word | Open, update all fields, save; diff cached numbers against Word's | Windows runner with Office automation | Before each release |
| Corpus | 100–500 licence-cleared papers: error-free rate, warnings per paper, top unknown commands and packages | Custom runner + dashboard | Weekly |

Golden tests only work if output is deterministic, which Decision 9 guarantees. Check each corpus paper's licence (for example CC BY) before storing it, or use your own documents.

Keep a compatibility matrix for Word on Windows, Mac and the web, LibreOffice Writer, Google Docs import and Apple Pages, covering equations, fields, numbering, footnotes and images. Viewers that never update fields show your cached values, which is why those values must already be right.

A handler counts as done when it has a unit test, a golden fixture, a docs entry and a row in the supported-commands matrix.

## Project risk register

Ten risks could derail the project; five are rated High, and each has a roadmap gate or CI check that catches it early. Severity and Status are dropdowns, so this table can serve as the live tracker. Security risks are detailed in their own section above.

| Risk | Severity | Impact | Recommended action | Early warning | Status |
| --- | --- | --- | --- | --- | --- |
| Package long tail | High | Real papers fail or silently lose content | Prioritize by corpus failure statistics; add LaTeX-written shims; fall back with warnings; publish the supported-commands matrix | Corpus error-free rate below 90%, or the same packages top the failure list for a month | Open |
| Math fidelity | High | Wrong or uneditable equations, the main reason people need the tool | Golden OMML from Word-made samples; differential tests against Pandoc; 95% gate in phase 4 | More than 5% failures on the equation set; equation bug reports | Open |
| Invalid OOXML | High | Word refuses to open the file | Schema-ordered builders; validator and LibreOffice open test on every commit; real-Word check before each release | Any validator error in CI | Open |
| Scope creep | High | v1 never ships | The mapping table is the v1 contract; new requests go to the post-v1 backlog unless corpus data says otherwise | A phase overruns its estimate by more than 25% | Open |
| Security regression | High | Untrusted documents read files, exhaust resources or plant risky fields | Security fixtures on every commit; one sandbox module; a lint rule that confines file and network APIs to it; output package scan | A failing security fixture; file or network calls outside the sandbox module | Open |
| Numbering drift | Medium | Numbers change when users update fields | One counter implementation feeds both cached text and SEQ/REF fields; real-Word field-update test | Any difference in the field-update test | Open |
| Viewer differences | Medium | Equations, fields or numbering look different outside desktop Word | Compatibility matrix; prefer widely supported constructs; correct cached values | A regression in the compatibility matrix | Open |
| Journal templates | Medium | Output ignores or breaks a journal's styles | Match styles by name, create missing ones, test with real journal templates | Template-related bug reports | Open |
| Licensing | Medium | No closed-source or commercial edition possible | Licence review in phase 6; keep GPL and AGPL tools out of the core; licence check in CI | A new dependency with a copyleft licence | Open |
| Estimate error | Medium | Timeline slips | Re-estimate at every gate; cut post-v1 items first; keep MVP scope fixed | Two consecutive gates finish late | Open |

## Sources and further reading

Every version number, date and security rating in this document comes from the pages below, checked as of Oct 6, 2026.

| Source | Used for |
| --- | --- |
| [LaTeX Project news](https://latex-project.org/news) | Kernel release 2026-06-01, twice-yearly cadence, expl3 in the kernel, tagged-PDF and accessible-math work |
| [Pandoc releases (GitHub)](https://github.com/jgm/pandoc/releases) | Pandoc 3.11, WASM build, .docx writer fixes, template-fetching security fix |
| [Ginev et al., "Scaling Accessible Mathematics on arXiv" (2026)](https://arxiv.org/pdf/2605.16562) | LaTeXML coverage on arXiv, size of the Rust port |
| [make4ht documentation](https://www.kodymirus.cz/make4ht/make4ht-doc.html) | How tex4ht works; its output formats |
| [Typst forum: "Exporting to DOCX"](https://forum.typst.app/t/exporting-to-docx-combining-pdf2docx-and-pandoc/6644) | No built-in .docx export in Typst; the typlite workaround |
| [Ecma International: ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376/) | OOXML parts, editions, ISO/IEC 29500 link; downloadable specification |
| [Microsoft Support: linear format equations in Word](https://support.microsoft.com/en-us/word/linear-format-equations-using-unicodemath-and-latex-in-word) | Word's LaTeX equation input and its unsupported syntax |
| [NVD: CVE-2023-32700](https://nvd.nist.gov/vuln/detail/cve-2023-32700) | LuaTeX shell-command execution from untrusted documents |
| [NVD: CVE-2023-32668](https://nvd.nist.gov/vuln/detail/cve-2023-32668) | LuaTeX network requests with default settings |
| [Red Hat: CVE-2023-32700](https://access.redhat.com/security/cve/CVE-2023-32700) | CVSS 3.1 base score 7.8 (Red Hat and NVD) |
| [citeproc-js LICENSE](https://raw.githubusercontent.com/Juris-M/citeproc-js/master/LICENSE) | CPAL 1.0 or AGPL 3.0 dual licence |
| [unified-latex (GitHub)](https://github.com/siefkenj/unified-latex) | PEG-based parsing approach and its stated limits |

### Further reading

These are standard references named from memory, not opened for this document; check editions before citing them.

- Donald E. Knuth, *The TeXbook*: chapters 7–8 (how TeX reads input, category codes), chapter 20 (macros), Appendix G (math layout rules).
- Donald E. Knuth, *TeX: The Program*: the annotated source of the engine.
- Donald E. Knuth and Michael F. Plass, "Breaking Paragraphs into Lines", *Software: Practice and Experience* (1981).
- Frank M. Liang, "Word Hy-phen-a-tion by Com-put-er", Stanford PhD thesis (1983).
- *The LaTeX Companion*, 3rd edition (2023), announced on the [LaTeX Project news page](https://latex-project.org/news).
- *source2e*: the documented LaTeX kernel source, available locally via `texdoc source2e`.
- ECMA-376 Part 1, the WordprocessingML and Office Math chapters, from the Ecma page above.
