// File access for documents: confined to the project root, by construction.
// Absolute paths, URLs and anything resolving outside the root (including via symlinks) are denied.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { FileRequest, FileResult } from "@texdocx/core";

export interface SandboxOptions {
  root: string;
  maxFileBytes?: number;
  maxFiles?: number;
  log?: (message: string) => void;
}

/** Extensions a document may read as TeX source. */
const TEXT_EXTENSIONS = new Set([".tex", ".ltx", ".bbl", ".tikz", ".pgf"]);
/** Extensions \includegraphics may read. */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".bmp", ".pdf", ".eps", ".ps"]);

export function createFileReader(o: SandboxOptions): (req: FileRequest) => FileResult {
  const root = realpathSync(o.root);
  const maxBytes = o.maxFileBytes ?? 20 * 1024 * 1024;
  const maxFiles = o.maxFiles ?? 2000;
  let reads = 0;

  const read = (req: FileRequest): FileResult => {
    const p = req.path.trim().replace(/^"(.*)"$/, "$1");
    const deny = (why: string): FileResult => ({ error: "denied", message: `\\${req.command}{${p}}: ${why}` });
    if (!p) return { error: "not-found", message: `\\${req.command}: empty file name` };
    if (/^[a-z][a-z0-9+.-]*:/i.test(p) && !/^[a-zA-Z]:[\\/]/.test(p)) return deny("remote resources are not allowed");
    if (isAbsolute(p) || p.startsWith("~") || /^[a-zA-Z]:[\\/]/.test(p)) return deny("absolute paths are not allowed");
    if (p.includes("\0")) return deny("invalid file name");

    // Lexical containment first, so the filesystem is never probed outside the root.
    const inside = (cand: string) => { const r = relative(root, resolve(root, cand)); return !r.startsWith("..") && !isAbsolute(r); };
    if (!inside(p)) return deny("the file is outside the project folder");

    // Dotfiles (.env, .npmrc, …) are never readable: they hold configuration and secrets.
    if (p.split(/[\\/]/).some(seg => seg.startsWith(".") && seg !== "." && seg !== "..")) return deny("hidden files cannot be read");

    const ext = extname(p).toLowerCase();
    const base = req.binary ? IMAGE_EXTENSIONS : TEXT_EXTENSIONS;
    const allowed = new Set([...base, ...req.extensions.filter(x => x && base.has(x.toLowerCase()))]);
    let candidates: string[];
    if (ext && allowed.has(ext)) candidates = [p];
    else if (ext && !req.extensions.includes("")) {
      // An existing file of a type the command may not read is refused outright.
      if (existsSync(resolve(root, p))) return deny(`files of type ${ext} cannot be read by \\${req.command}`);
      candidates = req.extensions.filter(Boolean).map(x => p + x);
    } else candidates = [...req.extensions.filter(Boolean).map(x => p + x), p];

    for (const cand of candidates) {
      if (!inside(cand)) return deny("the file is outside the project folder");
      const full = resolve(root, cand);
      if (!existsSync(full)) continue;
      const real = realpathSync(full);
      const rel = relative(root, real);
      if (rel.startsWith("..") || isAbsolute(rel)) return deny("the file is outside the project folder");
      const st = statSync(real);
      if (!st.isFile()) continue;
      const cext = extname(real).toLowerCase();
      const realBase = real.split(/[\\/]/).pop() ?? "";
      // The file actually read must have an allowed extension (no extension-less files, no dotfiles via symlinks).
      if (realBase.startsWith(".")) return deny("hidden files cannot be read");
      if (!cext || !allowed.has(cext)) return deny(`files of type ${cext || "(none)"} cannot be read by \\${req.command}`);
      if (st.size > maxBytes) return deny(`the file is larger than ${maxBytes} bytes`);
      if (++reads > maxFiles) return deny(`more than ${maxFiles} files were read`);
      o.log?.(`read ${rel}`);
      if (req.binary) return { name: rel, text: "", data: new Uint8Array(readFileSync(real)) };
      return { name: rel, text: readFileSync(real, "utf8") };
    }
    return { error: "not-found", message: `\\${req.command}{${p}}: file not found` };
  };

  return (req: FileRequest): FileResult => {
    // \graphicspath folders are tried after the name itself; each goes through the same checks.
    const first = read(req);
    if (!("error" in first) || first.error === "denied" || !req.searchPaths?.length) return first;
    for (const dir of req.searchPaths) {
      const r = read({ ...req, path: dir.replace(/\/?$/, "/") + req.path, searchPaths: undefined });
      if (!("error" in r) || r.error === "denied") return r;
    }
    return first;
  };
}
