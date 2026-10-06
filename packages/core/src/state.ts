// TeX's equivalents table with a save stack: local assignments are undone at group end,
// global ones survive. Implements TeX's "retain global value" rule on restore.

interface Entry { v: unknown; level: number }

export type GroupKind = "brace" | "semi" | "env" | "math" | "internal";

export class State {
  private table = new Map<string, Entry>();
  private saves: { key: string; old: Entry | undefined }[][] = [];
  private kinds: { kind: GroupKind; name?: string }[] = [];

  get level(): number { return this.saves.length; }

  get<T = unknown>(key: string): T | undefined {
    return this.table.get(key)?.v as T | undefined;
  }

  has(key: string): boolean { return this.table.has(key); }

  set(key: string, v: unknown, global = false): void {
    if (global) {
      this.table.set(key, { v, level: 0 });
      return;
    }
    const cur = this.table.get(key);
    const level = this.level;
    if (level > 0 && (cur === undefined || cur.level !== level)) {
      this.saves[level - 1].push({ key, old: cur });
    }
    this.table.set(key, { v, level });
  }

  beginGroup(kind: GroupKind, name?: string): void {
    this.saves.push([]);
    this.kinds.push({ kind, name });
  }

  /** Closes the innermost group and returns what kind it was (undefined at the outermost level). */
  endGroup(): { kind: GroupKind; name?: string } | undefined {
    const saves = this.saves.pop();
    const kind = this.kinds.pop();
    if (!saves) return undefined;
    for (let i = saves.length - 1; i >= 0; i--) {
      const { key, old } = saves[i];
      const cur = this.table.get(key);
      if (cur && cur.level === 0) continue;          // a global assignment wins over the saved local value
      if (old === undefined) this.table.delete(key); else this.table.set(key, old);
    }
    return kind;
  }

  currentGroup(): { kind: GroupKind; name?: string } | undefined {
    return this.kinds[this.kinds.length - 1];
  }

  groups(): readonly { kind: GroupKind; name?: string }[] { return this.kinds; }
}
