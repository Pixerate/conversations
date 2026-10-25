/**
 * Extracts structured mention IDs from HTML markup emitted by rich-text editors.
 * Matches <span data-type="mention" data-id="..."> or data-mention-id="...".
 */
export function extractMentionIdsFromHtml(html: string): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  const idRegex = /(?:data-id|data-mention-id)=["']([^"']+)["']/g;
  for (const match of html.matchAll(idRegex)) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * Strips HTML tags and entities to produce clean plain-text.
 */
export function stripHtmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
