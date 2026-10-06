// OPC packaging: deterministic ZIP with [Content_Types].xml first.

import { strToU8, zipSync, type Zippable } from "fflate";

const FIXED_MTIME = new Date(1980, 0, 1);   // DOS time starts in 1980; fixed for reproducible builds

export function packageDocx(parts: Map<string, string | Uint8Array>): Uint8Array {
  const ct = parts.get("[Content_Types].xml");
  if (ct === undefined) throw new Error("package has no [Content_Types].xml");
  const files: Zippable = {};
  const add = (path: string, data: string | Uint8Array) => {
    files[path] = [typeof data === "string" ? strToU8(data) : data, { mtime: FIXED_MTIME }];
  };
  add("[Content_Types].xml", ct);
  const rest = [...parts.keys()].filter(p => p !== "[Content_Types].xml").sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const path of rest) add(path, parts.get(path)!);
  return zipSync(files, { level: 6 });
}
