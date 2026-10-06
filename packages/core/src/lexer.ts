// TeX's "mouth": characters → tokens, one at a time, with catcodes looked up at read time
// so a command executed by the consumer can change how the very next character is read.

import { Cat, type Token } from "./tokens.ts";

export type CatLookup = (cp: number) => Cat;

export interface LexerEvents {
  invalidChar?: (pos: number, ch: string) => void;
}

const isHex = (cp: number | undefined): boolean => cp !== undefined && ((cp >= 48 && cp <= 57) || (cp >= 97 && cp <= 102));

export class Lexer {
  private i = 0;
  private state: "N" | "M" | "S" = "N";
  private stopAtEol = false;
  readonly file: number;
  private src: string;
  private cat: CatLookup;
  private events: LexerEvents;

  constructor(file: number, src: string, cat: CatLookup, events: LexerEvents = {}) {
    this.file = file;
    this.src = src;
    this.cat = cat;
    this.events = events;
  }

  get offset(): number { return this.i; }
  get done(): boolean { return this.i >= this.src.length; }

  /** Reads one character, decoding ^^ notation (^^M, ^^3f). Returns code point and length consumed. */
  private decode(at: number): { cp: number; len: number } | undefined {
    const cp = this.src.codePointAt(at);
    if (cp === undefined) return undefined;
    const len = cp > 0xffff ? 2 : 1;
    if (this.cat(cp) === Cat.Sup && this.src.codePointAt(at + len) === cp) {
      const a = this.src.codePointAt(at + 2 * len), b = this.src.codePointAt(at + 2 * len + 1);
      if (isHex(a) && isHex(b)) return { cp: parseInt(String.fromCodePoint(a!, b!), 16), len: 2 * len + 2 };
      if (a !== undefined && a < 128) return { cp: a < 64 ? a + 64 : a - 64, len: 2 * len + 1 };
    }
    return { cp, len };
  }

  private peekChar(): number | undefined { return this.decode(this.i)?.cp; }
  private readChar(): number {
    const d = this.decode(this.i)!;
    this.i += d.len;
    return d.cp;
  }

  /** \endinput: finish the current line, then stop. */
  endInput(): void { this.stopAtEol = true; }

  next(): Token | null {
    while (this.i < this.src.length) {
      const pos = this.i;
      const cp = this.readChar();
      const cat = this.cat(cp);
      switch (cat) {
        case Cat.Escape: {
          if (this.i >= this.src.length) return { kind: "cs", name: " ", file: this.file, pos };
          const first = this.readChar();
          let name = String.fromCodePoint(first);
          const firstCat = this.cat(first);
          if (firstCat === Cat.Letter) {
            while (this.i < this.src.length && this.cat(this.peekChar()!) === Cat.Letter) name += String.fromCodePoint(this.readChar());
            this.state = "S";
          } else if (firstCat === Cat.EndLine || first === 10) {
            // "\" at the end of a line is \^^M, which LaTeX defines as a control space.
            this.state = "N";
            if (this.stopAtEol) this.i = this.src.length;
            return { kind: "cs", name: " ", file: this.file, pos };
          } else {
            this.state = firstCat === Cat.Space ? "S" : "M";
          }
          return { kind: "cs", name, file: this.file, pos };
        }
        case Cat.EndLine: {
          const was = this.state;
          this.state = "N";
          // TeX discards the rest of the line after an end-of-line character.
          if (cp !== 10) { const nl = this.src.indexOf("\n", this.i); this.i = nl < 0 ? this.src.length : nl + 1; }
          if (this.stopAtEol) this.i = this.src.length;
          if (was === "N") return { kind: "cs", name: "par", file: this.file, pos };
          if (was === "M") return { kind: "char", ch: " ", cat: Cat.Space, file: this.file, pos };
          continue;
        }
        case Cat.Space:
          if (this.state !== "M") continue;
          this.state = "S";
          return { kind: "char", ch: " ", cat: Cat.Space, file: this.file, pos };
        case Cat.Comment: {
          const nl = this.src.indexOf("\n", this.i);
          this.i = nl < 0 ? this.src.length : nl + 1;
          this.state = "N";
          if (this.stopAtEol) this.i = this.src.length;
          continue;
        }
        case Cat.Ignored:
          continue;
        case Cat.Invalid:
          this.events.invalidChar?.(pos, String.fromCodePoint(cp));
          continue;
        case Cat.Active:
          this.state = "M";
          return { kind: "cs", name: String.fromCodePoint(cp), active: true, file: this.file, pos };
        default:
          if (cp === 10 && this.stopAtEol) { this.i = this.src.length; }
          this.state = "M";
          return { kind: "char", ch: String.fromCodePoint(cp), cat, file: this.file, pos };
      }
    }
    return null;
  }

  // ---- raw access for verbatim material (\verb, verbatim environments) ----

  /** Next raw character without tokenizing, or undefined at end of input. */
  readRawChar(): string | undefined {
    if (this.i >= this.src.length) return undefined;
    const cp = this.src.codePointAt(this.i)!;
    this.i += cp > 0xffff ? 2 : 1;
    this.state = "M";
    return String.fromCodePoint(cp);
  }

  peekRawChar(): string | undefined {
    const cp = this.src.codePointAt(this.i);
    return cp === undefined ? undefined : String.fromCodePoint(cp);
  }

  /** Raw text up to (not including) `pattern`; consumes the match. Null when not found (nothing consumed). */
  readRawUntil(pattern: RegExp): { text: string; start: number } | null {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    re.lastIndex = this.i;
    const m = re.exec(this.src);
    if (!m) return null;
    const start = this.i;
    const text = this.src.slice(this.i, m.index);
    this.i = m.index + m[0].length;
    this.state = "M";
    return { text, start };
  }

  /** Puts the reader in state S, as after a control word (used after raw-skipping a command). */
  skipFollowingSpaces(): void { this.state = "S"; }

  /** Skips the rest of the current line when it holds only spaces (after \begin{verbatim}). */
  skipBlankRestOfLine(): void {
    const nl = this.src.indexOf("\n", this.i);
    const rest = this.src.slice(this.i, nl < 0 ? this.src.length : nl);
    if (/^[ \t]*$/.test(rest)) this.i = nl < 0 ? this.src.length : nl + 1;
  }
}
