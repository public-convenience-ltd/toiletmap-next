/**
 * Escaping for the hand-built XML documents (sitemap, RSS). Text and attribute values both
 * go through escapeXml; characters XML 1.0 does not allow at all are dropped.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: removing characters XML forbids is the point
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** Escapes &, <, >, " and ' and strips characters that are illegal in XML 1.0. */
export function escapeXml(value: string | number): string {
  return String(value)
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
