// Document classes as TeX source: counters, \the formats, names and lengths, so users can redefine them.

/** Shared by all classes (the parts of latex.ltx that documents rely on). */
const COMMON = String.raw`\makeatletter
\newcounter{page}\setcounter{page}{1}
\newcounter{equation}\newcounter{figure}\newcounter{table}\newcounter{footnote}\newcounter{mpfootnote}
\newcounter{enumi}\newcounter{enumii}\newcounter{enumiii}\newcounter{enumiv}
\renewcommand\theenumii{\alph{enumii}}
\renewcommand\theenumiii{\roman{enumiii}}
\renewcommand\theenumiv{\Alph{enumiv}}
\renewcommand\p@enumii{\theenumi}
\renewcommand\p@enumiii{\theenumi(\theenumii)}
\renewcommand\p@enumiv{\p@enumiii\theenumiii}
\newcommand\labelenumi{\theenumi.}
\newcommand\labelenumii{(\theenumii)}
\newcommand\labelenumiii{\theenumiii.}
\newcommand\labelenumiv{\theenumiv.}
\newcommand\labelitemi{\textbullet}
\newcommand\labelitemii{\textendash}
\newcommand\labelitemiii{\textasteriskcentered}
\newcommand\labelitemiv{\textperiodcentered}
\newcounter{subfigure}[figure]\newcounter{subtable}[table]
\renewcommand\thesubfigure{\alph{subfigure}}\renewcommand\thesubtable{\alph{subtable}}
\renewcommand\p@subfigure{\thefigure}\renewcommand\p@subtable{\thetable}
\newcounter{secnumdepth}\newcounter{tocdepth}
\newcommand\abstractname{Abstract}
\newcommand\contentsname{Contents}
\newcommand\listfigurename{List of Figures}
\newcommand\listtablename{List of Tables}
\newcommand\figurename{Figure}
\newcommand\tablename{Table}
\newcommand\appendixname{Appendix}
\newcommand\partname{Part}
\newcommand\indexname{Index}
\newcommand\proofname{Proof}
\newlength\textwidth \newlength\linewidth \newlength\columnwidth \newlength\textheight
\newlength\paperwidth \newlength\paperheight \newlength\parindent \newlength\parskip \newlength\baselineskip
\newlength\tabcolsep \newlength\arraycolsep \newlength\fboxsep \newlength\fboxrule \newlength\marginparwidth
\newlength\oddsidemargin \newlength\evensidemargin \newlength\topmargin \newlength\headheight \newlength\headsep
\newlength\footskip \newlength\leftmargin \newlength\rightmargin \newlength\labelwidth \newlength\labelsep
\newlength\itemsep \newlength\topsep \newlength\parsep \newlength\itemindent \newlength\listparindent
\newlength\unitlength \newlength\abovedisplayskip \newlength\belowdisplayskip \newlength\columnsep
\newlength\arrayrulewidth \newlength\doublerulesep \newlength\marginparsep \newlength\emergencystretch
\newlength\hoffset \newlength\voffset \newlength\lineskip \newlength\normallineskip \newlength\jot
\newlength\mathindent \newlength\footnotesep \newlength\floatsep \newlength\textfloatsep \newlength\intextsep
\newlength\heavyrulewidth \newlength\lightrulewidth \newlength\cmidrulewidth \newlength\belowcaptionskip
\newlength\abovecaptionskip \newlength\multicolsep \newlength\partopsep \newlength\smallskipamount
\newlength\medskipamount \newlength\bigskipamount
\parindent=15pt \baselineskip=12pt \tabcolsep=6pt \arraycolsep=5pt \fboxsep=3pt \fboxrule=.4pt
\unitlength=1pt \jot=3pt \columnsep=10pt \arrayrulewidth=.4pt \labelsep=5pt \itemsep=4pt \topsep=8pt
\smallskipamount=3pt \medskipamount=6pt \bigskipamount=12pt
\def\@title{}\def\@author{}\def\@date{\today}
\makeatother
`;

const ARTICLE = String.raw`\makeatletter
\newcounter{part}\newcounter{section}\newcounter{subsection}[section]
\newcounter{subsubsection}[subsection]\newcounter{paragraph}[subsubsection]\newcounter{subparagraph}[paragraph]
\renewcommand\thepart{\Roman{part}}
\renewcommand\thesection{\arabic{section}}
\renewcommand\thesubsection{\thesection.\arabic{subsection}}
\renewcommand\thesubsubsection{\thesubsection.\arabic{subsubsection}}
\renewcommand\theparagraph{\thesubsubsection.\arabic{paragraph}}
\renewcommand\thesubparagraph{\theparagraph.\arabic{subparagraph}}
\setcounter{secnumdepth}{3}\setcounter{tocdepth}{3}
\newcommand\refname{References}
\makeatother
`;

const REPORT = String.raw`\makeatletter
\newcounter{part}\newcounter{chapter}\newcounter{section}[chapter]\newcounter{subsection}[section]
\newcounter{subsubsection}[subsection]\newcounter{paragraph}[subsubsection]\newcounter{subparagraph}[paragraph]
\renewcommand\thepart{\Roman{part}}
\renewcommand\thechapter{\arabic{chapter}}
\renewcommand\thesection{\thechapter.\arabic{section}}
\renewcommand\thesubsection{\thesection.\arabic{subsection}}
\renewcommand\thesubsubsection{\thesubsection.\arabic{subsubsection}}
\renewcommand\theparagraph{\thesubsubsection.\arabic{paragraph}}
\renewcommand\thesubparagraph{\theparagraph.\arabic{subparagraph}}
\@addtoreset{equation}{chapter}\@addtoreset{figure}{chapter}\@addtoreset{table}{chapter}\@addtoreset{footnote}{chapter}
\renewcommand\theequation{\thechapter.\arabic{equation}}
\renewcommand\thefigure{\thechapter.\arabic{figure}}
\renewcommand\thetable{\thechapter.\arabic{table}}
\setcounter{secnumdepth}{2}\setcounter{tocdepth}{2}
\newcommand\chaptername{Chapter}
\newcommand\bibname{Bibliography}
\newcommand\refname{References}
\makeatother
`;

export interface ClassInfo { base: "article" | "report" | "book"; known: boolean }

const REPORT_LIKE = new Set(["report", "scrreprt", "thesis", "ut-thesis", "mitthesis", "ociamthesis", "uiucthesis"]);
const BOOK_LIKE = new Set(["book", "scrbook", "memoir", "octavo", "tufte-book", "krantz"]);
const ARTICLE_LIKE = new Set(["article", "amsart", "scrartcl", "IEEEtran", "llncs", "elsarticle", "revtex4", "revtex4-1",
  "revtex4-2", "acmart", "svjour3", "aastex", "aastex6", "aastex61", "aastex62", "aastex63", "aastex631", "jss",
  "sigplanconf", "achemso", "amsproc", "tufte-handout", "extarticle", "letter", "minimal", "standalone", "jarticle",
  "ltjsarticle", "ctexart", "paper", "nature", "aa", "mnras", "copernicus", "interact", "wlscirep", "cas-sc", "cas-dc",
  "PoS", "JHEP", "sn-jnl", "iopart", "spie", "osajnl", "ws-ijmpa", "lipics-v2021", "beamer"]);

export function classInfo(name: string): ClassInfo {
  if (REPORT_LIKE.has(name)) return { base: "report", known: true };
  if (BOOK_LIKE.has(name)) return { base: "book", known: true };
  return { base: "article", known: ARTICLE_LIKE.has(name) };
}

export function classCode(info: ClassInfo): string {
  return COMMON + (info.base === "article" ? ARTICLE : REPORT);
}
