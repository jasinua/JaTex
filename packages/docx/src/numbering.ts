// numbering.xml: heading numbering (one multilevel list linked to Heading 1–9) plus list instances.
// Traps handled here: every abstractNum precedes every num; each list gets its own num (restarts).

import { HEADING_NUM_ID } from "./styles.ts";
import { NS, ORDER, XML_DECL, el, ordered, val } from "./xml.ts";

export interface LevelDef {
  format: "decimal" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman" | "bullet" | "none";
  text: string;              // "%1." or "•"
  start?: number;
  leftTw: number;
  hangingTw: number;
  pStyle?: string;
  suffix?: "tab" | "space" | "nothing";
  font?: string;             // for bullet glyphs
}

const nsid = (id: number): string => (0x5A000000 + id).toString(16).toUpperCase();

function levelXml(ilvl: number, d: LevelDef): string {
  return ordered("w:lvl", ORDER.lvl, {
    "w:start": val("w:start", d.start ?? 1),
    "w:numFmt": val("w:numFmt", d.format),
    "w:pStyle": d.pStyle && val("w:pStyle", d.pStyle),
    "w:suff": d.suffix && d.suffix !== "tab" ? val("w:suff", d.suffix) : undefined,
    "w:lvlText": val("w:lvlText", d.text),
    "w:lvlJc": val("w:lvlJc", "left"),
    "w:pPr": ordered("w:pPr", ORDER.pPr, {
      "w:ind": el("w:ind", { "w:left": d.leftTw, "w:hanging": d.hangingTw }),
    }),
    "w:rPr": d.font ? ordered("w:rPr", ORDER.rPr, {
      "w:rFonts": el("w:rFonts", { "w:ascii": d.font, "w:hAnsi": d.font, "w:hint": "default" }),
    }) : undefined,
  }, { "w:ilvl": ilvl });
}

export class Numbering {
  private abstracts: string[] = [];
  private nums: string[] = [];

  constructor(numberedHeadingLevels: number) {
    const levels: LevelDef[] = [];
    for (let i = 0; i < 9; i++) {
      const text = Array.from({ length: i + 1 }, (_, j) => `%${j + 1}`).join(".");
      levels.push({ format: "decimal", text, leftTw: 0, hangingTw: 0,
        pStyle: i < numberedHeadingLevels ? `Heading${i + 1}` : undefined });
    }
    const abs = this.addAbstract(levels, "multilevel");
    const id = this.addNum(abs);
    if (id !== HEADING_NUM_ID) throw new Error("heading numbering must be num 1");
  }

  addAbstract(levels: LevelDef[], type: "multilevel" | "hybridMultilevel" = "hybridMultilevel"): number {
    const id = this.abstracts.length;
    this.abstracts.push(ordered("w:abstractNum", ORDER.abstractNum, {
      "w:nsid": val("w:nsid", nsid(id)),
      "w:multiLevelType": val("w:multiLevelType", type),
      "w:lvl": levels.map((l, i) => levelXml(i, l)),
    }, { "w:abstractNumId": id }));
    return id;
  }

  /**
   * A new num instance. Word continues counting across nums that share an abstractNum, so a list
   * that must restart passes `restartAt` (with the level it uses) to get a startOverride.
   */
  addNum(abstractId: number, restartAt?: number, ilvl = 0): number {
    const id = this.nums.length + 1;
    this.nums.push(el("w:num", { "w:numId": id }, val("w:abstractNumId", abstractId),
      restartAt !== undefined && el("w:lvlOverride", { "w:ilvl": ilvl }, val("w:startOverride", restartAt))));
    return id;
  }

  xml(): string {
    return XML_DECL + el("w:numbering", { "xmlns:w": NS.w }, ...this.abstracts, ...this.nums);
  }
}
