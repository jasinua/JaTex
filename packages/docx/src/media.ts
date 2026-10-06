// Embedded images: media parts, relationships and DrawingML for inline pictures.

import type { ImageRef } from "@texdocx/model";
import { xmlAttr } from "./xml.ts";

export const MEDIA_TYPES: Record<string, string> = {
  png: "image/png", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp",
};

/** A 1×1 transparent PNG, used as the fallback blip for SVGs when no raster version exists. */
export const BLANK_PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));

/** FNV-1a over the bytes: identical images share one media part. */
export function hashBytes(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16) + ":" + data.length;
}

const SVG_EXT = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}";

export function inlinePicture(img: ImageRef, docPrId: number, blipRel: string, svgRel: string | undefined): string {
  const cx = Math.max(1, Math.round(img.width)), cy = Math.max(1, Math.round(img.height));
  const ext = svgRel
    ? `<a:extLst><a:ext uri="${SVG_EXT}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svgRel}"/></a:ext></a:extLst>`
    : "";
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:docPr id="${docPrId}" name="Picture ${docPrId}"${img.alt ? ` descr="${xmlAttr(img.alt)}"` : ""}/>`
    + `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
    + `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:nvPicPr><pic:cNvPr id="0" name="${xmlAttr(img.name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${blipRel}">${ext}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
