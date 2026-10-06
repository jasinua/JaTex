// The kernel bootstrap: LaTeX's programming helpers, written in TeX and read at engine start.

const BT = "`";

export const KERNEL_TEX = String.raw`\catcode${BT}\@=11
\let\bgroup={ \let\egroup=}
\def\@firstoftwo#1#2{#1}
\def\@secondoftwo#1#2{#2}
\def\@firstofone#1{#1}
\def\@iden#1{#1}
\def\@gobble#1{}
\def\@gobbletwo#1#2{}
\def\@gobblethree#1#2#3{}
\def\@gobblefour#1#2#3#4{}
\def\@empty{}
\def\@nnil{\@nil}
\def\@car#1#2\@nil{#1}
\def\@cdr#1#2\@nil{#2}
\def\@nameuse#1{\csname #1\endcsname}
\def\space{ }
\def\@spaces{\space\space\space\space}
\def\lq{${BT}}
\def\rq{'}
\def\@makeother#1{\catcode${BT}#1=12\relax}
\def\arabic#1{\expandafter\@arabic\csname c@#1\endcsname}
\def\roman#1{\expandafter\@roman\csname c@#1\endcsname}
\def\Roman#1{\expandafter\@Roman\csname c@#1\endcsname}
\def\alph#1{\expandafter\@alph\csname c@#1\endcsname}
\def\Alph#1{\expandafter\@Alph\csname c@#1\endcsname}
\def\fnsymbol#1{\expandafter\@fnsymbol\csname c@#1\endcsname}
\def\value#1{\csname c@#1\endcsname}
\def\ensuremath#1{\ifmmode#1\else$#1$\fi}
\def\@ifdefinable#1#2{#2}
\def\@onlypreamble#1{}
\def\@currentlabel{}
\let\protect\relax
\let\@typeset@protect\relax
\let\@@input\input
\chardef\active=13
\chardef\@ne=1
\chardef\tw@=2
\chardef\thr@@=3
\chardef\sixt@@n=16
\chardef\@cclv=255
\mathchardef\@cclvi=256
\mathchardef\@m=1000
\mathchardef\@M=10000
\newcount\m@ne \m@ne=-1
\newcount\count@
\newcount\@tempcnta
\newcount\@tempcntb
\newdimen\z@
\newdimen\p@ \p@=1pt
\newdimen\dimen@
\newdimen\@tempdima
\newdimen\@tempdimb
\newskip\@tempskipa
\newskip\@tempskipb
\newskip\skip@
\newtoks\toks@
\newtoks\@temptokena
\newif\if@tempswa
\long\def\g@addto@macro#1#2{\begingroup\toks@\expandafter{#1#2}\xdef#1{\the\toks@}\endgroup}
\def\addto@hook#1#2{#1\expandafter{\the#1#2}}
\def\@namedef#1{\expandafter\def\csname #1\endcsname}
\def\@ifempty#1{\if\relax\detokenize{#1}\relax\expandafter\@firstoftwo\else\expandafter\@secondoftwo\fi}
\def\IfEmptyTF#1{\@ifempty{#1}}
\def\@ifnotempty#1#2{\@ifempty{#1}{}{#2}}
\catcode${BT}\@=12
`;
