// LaTeX's size commands per class base size (from size10.clo, size11.clo, size12.clo), in points.

export const SIZE_NAMES = ["tiny", "scriptsize", "footnotesize", "small", "normalsize",
  "large", "Large", "LARGE", "huge", "Huge"] as const;
export type SizeName = (typeof SIZE_NAMES)[number];

const TABLE: Record<number, number[]> = {
  10: [5, 7, 8, 9, 10, 12, 14.4, 17.28, 20.74, 24.88],
  11: [6, 8, 9, 10, 10.95, 12, 14.4, 17.28, 20.74, 24.88],
  12: [6, 8, 10, 10.95, 12, 14.4, 17.28, 20.74, 24.88, 24.88],
};

/** Size in points for a LaTeX size command at the given class base size (10, 11 or 12). */
export function sizePt(base: number, name: SizeName): number {
  const row = TABLE[base] ?? TABLE[10];
  return row[SIZE_NAMES.indexOf(name)];
}

/** Word font sizes are half-points: 14.4pt → 29. */
export const halfPoints = (pt: number): number => Math.round(pt * 2);

/** Paragraph indent (\parindent) in points: 15pt, 17pt, 1.5em at 12pt. */
export function parIndentPt(base: number): number {
  return base === 11 ? 17 : base === 12 ? 18 : 15;
}
