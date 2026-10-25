/**
 * Extracts structured mention IDs from HTML markup emitted by rich-text editors.
 * Matches <span data-type="mention" data-id="..."> or data-mention-id="...".
 * Shields code blocks (<pre>...</pre>) and inline code (<code>...</code>) from regex matching.
 */
export function extractMentionIdsFromHtml(html: string): string[] {
  if (!html) return [];
  // Shield code blocks and inline code snippets from accidental match
  const shieldedHtml = html
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '');

  const ids = new Set<string>();
  const idRegex = /(?:data-id|data-mention-id)=["']([^"']+)["']/g;
  for (const match of shieldedHtml.matchAll(idRegex)) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * Generates an idempotent, scoped notification ID for comment mentions.
 */
export function buildMentionNotificationId(commentId: string, recipientId: string): string {
  return `mention_${commentId}_${recipientId}`;
}

/**
 * Resolves recipient IDs for downstream notification delivery, filtering out the author.
 */
export function resolveMentionRecipients(
  message: { author: { id: string }; mentions?: string[] },
  _conversation?: { participantIds?: string[] }
): string[] {
  const authorId = message.author.id;
  const recipients = new Set<string>();

  for (const id of message.mentions || []) {
    if (id && id !== authorId) {
      recipients.add(id);
    }
  }

  return Array.from(recipients);
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
