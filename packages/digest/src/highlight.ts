// Syntax highlighting for code blocks (listings, minted) with shiki's synchronous JavaScript engine.

import type { CodeToken } from "@texdocx/model";
import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import c from "shiki/langs/c.mjs";
import cpp from "shiki/langs/cpp.mjs";
import csharp from "shiki/langs/csharp.mjs";
import fortran from "shiki/langs/fortran-free-form.mjs";
import go from "shiki/langs/go.mjs";
import haskell from "shiki/langs/haskell.mjs";
import html from "shiki/langs/html.mjs";
import java from "shiki/langs/java.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import julia from "shiki/langs/julia.mjs";
import kotlin from "shiki/langs/kotlin.mjs";
import latex from "shiki/langs/latex.mjs";
import lua from "shiki/langs/lua.mjs";
import matlab from "shiki/langs/matlab.mjs";
import perl from "shiki/langs/perl.mjs";
import php from "shiki/langs/php.mjs";
import python from "shiki/langs/python.mjs";
import r from "shiki/langs/r.mjs";
import ruby from "shiki/langs/ruby.mjs";
import rust from "shiki/langs/rust.mjs";
import scala from "shiki/langs/scala.mjs";
import sql from "shiki/langs/sql.mjs";
import swift from "shiki/langs/swift.mjs";
import typescript from "shiki/langs/typescript.mjs";
import xml from "shiki/langs/xml.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubLight from "shiki/themes/github-light.mjs";

const LANGS = [bash, c, cpp, csharp, fortran, go, haskell, html, java, javascript, json, julia, kotlin, latex, lua,
  matlab, perl, php, python, r, ruby, rust, scala, sql, swift, typescript, xml, yaml];

/** listings / minted language names → shiki ids. */
const ALIASES: Record<string, string> = {
  "c++": "cpp", "[sharp]c": "csharp", "c#": "csharp", cs: "csharp", sh: "bash", shell: "bash", zsh: "bash",
  console: "bash", tex: "latex", "[latex]tex": "latex", "{[latex]tex}": "latex", py: "python", python3: "python",
  js: "javascript", ts: "typescript", fortran: "fortran-free-form", f90: "fortran-free-form", golang: "go",
  octave: "matlab", rs: "rust", yml: "yaml", rb: "ruby", kt: "kotlin", jl: "julia", hs: "haskell", pl: "perl",
};

let highlighter: HighlighterCore | null = null;
const THEME = "github-light";

export function highlight(code: string, language: string | undefined): CodeToken[][] | undefined {
  if (!language) return undefined;
  const raw = language.toLowerCase().trim();
  const lang = ALIASES[raw] ?? ALIASES[raw.replace(/^\[[^\]]*\]/, "")] ?? raw.replace(/^\[[^\]]*\]/, "");
  if (!LANGS.some(l => l.some(g => g.name === lang))) return undefined;
  try {
    highlighter ??= createHighlighterCoreSync({ themes: [githubLight], langs: LANGS, engine: createJavaScriptRegexEngine() });
    const lines = highlighter.codeToTokensBase(code.replace(/\n$/, ""), { lang, theme: THEME });
    return lines.map(line => line.map(t => {
      const color = t.color?.replace(/^#/, "").slice(0, 6).toUpperCase();
      const tok: CodeToken = { text: t.content };
      if (color && color !== "24292E") tok.color = color;
      if (t.fontStyle && t.fontStyle & 1) tok.italic = true;
      if (t.fontStyle && t.fontStyle & 2) tok.bold = true;
      return tok;
    }));
  } catch {
    return undefined;   // a grammar failure leaves the block plain
  }
}
