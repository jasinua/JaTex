// Image headers: format, pixel size and resolution, so \includegraphics sizes match LaTeX's.

export interface ImageInfo {
  format: "png" | "jpeg" | "gif" | "svg" | "bmp";
  /** Natural size in big points (1/72 in), as graphicx computes it from pixels and resolution. */
  widthBp: number;
  heightBp: number;
}

const u16be = (d: Uint8Array, i: number) => (d[i] << 8) | d[i + 1];
const u32be = (d: Uint8Array, i: number) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
const u16le = (d: Uint8Array, i: number) => d[i] | (d[i + 1] << 8);
const i32le = (d: Uint8Array, i: number) => d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24);

/** pdfTeX's default resolution for images without one. */
const DEFAULT_DPI = 72;

export function imageInfo(d: Uint8Array): ImageInfo | null {
  if (d.length >= 24 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return png(d);
  if (d.length >= 4 && d[0] === 0xff && d[1] === 0xd8) return jpeg(d);
  if (d.length >= 10 && d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) {
    return { format: "gif", widthBp: u16le(d, 6) * 72 / 96, heightBp: u16le(d, 8) * 72 / 96 };
  }
  if (d.length >= 30 && d[0] === 0x42 && d[1] === 0x4d) {
    const w = Math.abs(i32le(d, 18)), h = Math.abs(i32le(d, 22));
    const ppm = d.length >= 42 ? i32le(d, 38) : 0;
    const dpi = ppm > 0 ? ppm * 0.0254 : 96;
    return { format: "bmp", widthBp: w * 72 / dpi, heightBp: h * 72 / dpi };
  }
  const head = new TextDecoder().decode(d.subarray(0, Math.min(d.length, 4096)));
  if (/<svg[\s>]/.test(head)) return svg(head);
  return null;
}

function png(d: Uint8Array): ImageInfo | null {
  const w = u32be(d, 16), h = u32be(d, 20);
  let dpiX = DEFAULT_DPI, dpiY = DEFAULT_DPI;
  for (let i = 8; i + 8 <= d.length;) {
    const len = u32be(d, i);
    const type = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
    if (type === "pHYs" && len >= 9 && d[i + 16] === 1) {
      dpiX = u32be(d, i + 8) * 0.0254 || DEFAULT_DPI;
      dpiY = u32be(d, i + 12) * 0.0254 || DEFAULT_DPI;
    }
    if (type === "IDAT" || type === "IEND") break;
    i += 12 + len;
  }
  if (!w || !h) return null;
  return { format: "png", widthBp: w * 72 / dpiX, heightBp: h * 72 / dpiY };
}

function jpeg(d: Uint8Array): ImageInfo | null {
  let dpiX = DEFAULT_DPI, dpiY = DEFAULT_DPI;
  for (let i = 2; i + 4 <= d.length;) {
    if (d[i] !== 0xff) { i++; continue; }
    const marker = d[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
    const len = u16be(d, i + 2);
    if (marker === 0xe0 && len >= 14 && String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]) === "JFIF") {
      const units = d[i + 11], x = u16be(d, i + 12), y = u16be(d, i + 14);
      if (units === 1 && x && y) { dpiX = x; dpiY = y; }
      if (units === 2 && x && y) { dpiX = x * 2.54; dpiY = y * 2.54; }
    }
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = u16be(d, i + 5), w = u16be(d, i + 7);
      if (!w || !h) return null;
      return { format: "jpeg", widthBp: w * 72 / dpiX, heightBp: h * 72 / dpiY };
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return null;
}

const SVG_UNITS: Record<string, number> = { "": 0.75, px: 0.75, pt: 1, pc: 12, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, em: 12, ex: 6 };

function svg(text: string): ImageInfo | null {
  const tag = /<svg\b[^>]*>/.exec(text)?.[0] ?? "";
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`).exec(tag)?.[1];
  const len = (v: string | undefined): number | undefined => {
    const m = v && /^\s*([\d.]+)\s*([a-z]*)\s*$/i.exec(v);
    return m && SVG_UNITS[m[2].toLowerCase()] !== undefined ? parseFloat(m[1]) * SVG_UNITS[m[2].toLowerCase()] : undefined;
  };
  const vb = attr("viewBox")?.split(/[\s,]+/).map(Number);
  let w = len(attr("width")), h = len(attr("height"));
  if (vb && vb.length === 4) {
    if (w === undefined && h === undefined) { w = vb[2] * 0.75; h = vb[3] * 0.75; }
    else if (w === undefined && h !== undefined) w = h * vb[2] / vb[3];
    else if (h === undefined && w !== undefined) h = w * vb[3] / vb[2];
  }
  if (!w || !h) return { format: "svg", widthBp: 300, heightBp: 150 };
  return { format: "svg", widthBp: w, heightBp: h };
}
