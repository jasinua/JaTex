import { installCommands, NO_PREFIX, assignRegister } from "./commands.ts";
import { Engine, type EngineOptions } from "./engine.ts";
import { KERNEL_TEX } from "./kernel.ts";
import { installPrimitives } from "./primitives.ts";
import { isCs, isSpace, type CsToken } from "./tokens.ts";

export * from "./tokens.ts";
export * from "./source.ts";
export * from "./diagnostics.ts";
export * from "./lexer.ts";
export * from "./state.ts";
export * from "./argspec.ts";
export * from "./engine.ts";
export * from "./commands.ts";
export { toRoman, toAlph, toFnSymbol, readCsName, sameMeaning } from "./primitives.ts";

/** Executes core commands until the input ends; anything else is an error. Used for the kernel bootstrap. */
export function runCoreOnly(e: Engine): void {
  for (;;) {
    const t = e.next();
    if (!t) return;
    if (isSpace(t) || isCs(t, "par")) continue;
    const m = e.meaning(t);
    if (t.kind === "cs" && m?.type === "command" && e.commands.has(m.name)) { e.commands.get(m.name)!(e, t, NO_PREFIX); continue; }
    if (t.kind === "cs" && m?.type === "register") { assignRegister(e, t as CsToken, m.reg, m.key, false); continue; }
    throw new Error(`kernel bootstrap: unexpected ${t.kind === "cs" ? "\\" + t.name : t.kind === "char" ? `'${t.ch}'` : "#"}`);
  }
}

/** An engine with all primitives, core commands and the kernel bootstrap loaded. */
export function createEngine(opts: EngineOptions = {}): Engine {
  const e = new Engine(opts);
  installPrimitives(e);
  installCommands(e);
  e.pushFile("<kernel>", KERNEL_TEX);
  runCoreOnly(e);
  if (e.diag.list.length) throw new Error("kernel bootstrap produced diagnostics: " + e.diag.list.map(d => d.message).join("; "));
  return e;
}
