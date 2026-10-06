// Source files and offset → line/column mapping for diagnostics.

export interface SourceFile { name: string; text: string; lineStarts: number[] }

export class SourceMap {
  readonly files: SourceFile[] = [];

  add(name: string, text: string): number {
    const normalized = text.replace(/\r\n?/g, "\n");
    const lineStarts = [0];
    for (let i = 0; i < normalized.length; i++) if (normalized.charCodeAt(i) === 10) lineStarts.push(i + 1);
    this.files.push({ name, text: normalized, lineStarts });
    return this.files.length - 1;
  }

  get(file: number): SourceFile | undefined { return this.files[file]; }

  /** 1-based line and column (column counts code points). */
  position(file: number, pos: number): { line: number; col: number } {
    const f = this.files[file];
    if (!f) return { line: 0, col: 0 };
    let lo = 0, hi = f.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f.lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    const col = [...f.text.slice(f.lineStarts[lo], pos)].length + 1;
    return { line: lo + 1, col };
  }

  lineText(file: number, line: number): string {
    const f = this.files[file];
    if (!f) return "";
    const start = f.lineStarts[line - 1] ?? 0;
    const end = f.lineStarts[line] !== undefined ? f.lineStarts[line] - 1 : f.text.length;
    return f.text.slice(start, end);
  }
}
