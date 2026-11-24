import type { Conversation, TextAnchor } from '../types.js';

export interface CreateTextAnchorOptions {
  /** Number of surrounding UTF-16 code units captured as `prefix` and `suffix`. Defaults to `32`. */
  contextChars?: number;
}

export interface ReconcileAnchorOptions {
  /**
   * Minimum normalized Levenshtein similarity (`0..1`) required when falling back to a
   * context-framed fuzzy match. Defaults to `0.5`.
   */
  fuzzyThreshold?: number;
  /**
   * Maximum offset drift allowed when a short quote (`< 4` UTF-16 code units) matches with
   * zero `prefix` and `suffix` overlap. Defaults to `64`.
   */
  maxProximityForShortQuote?: number;
}

const DEFAULT_CONTEXT_CHARS = 32;
const DEFAULT_FUZZY_THRESHOLD = 0.5;
const DEFAULT_MAX_PROXIMITY_SHORT_QUOTE = 64;

/**
 * Creates a `TextAnchor` from a UTF-16 offset range (`[start, end)`) in `documentText`,
 * capturing W3C Web Annotation style `exact`, `prefix`, and `suffix` context.
 */
export function createTextAnchor(
  documentText: string,
  start: number,
  end: number,
  options: CreateTextAnchorOptions = {}
): TextAnchor {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > documentText.length) {
    throw new RangeError(
      `Invalid anchor range [${start}, ${end}] for document of length ${documentText.length}.`
    );
  }

  const contextChars = Math.max(0, options.contextChars ?? DEFAULT_CONTEXT_CHARS);
  const exact = documentText.slice(start, end);
  const prefix = start > 0 && contextChars > 0 ? documentText.slice(Math.max(0, start - contextChars), start) : '';
  const suffix =
    end < documentText.length && contextChars > 0
      ? documentText.slice(end, Math.min(documentText.length, end + contextChars))
      : '';

  return {
    start,
    end,
    quote: {
      exact,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {})
    },
    state: 'attached'
  };
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const indices: number[] = [];
  let fromIndex = 0;
  while (fromIndex <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, fromIndex);
    if (idx === -1) break;
    indices.push(idx);
    fromIndex = idx + 1;
  }
  return indices;
}

function scoreContextAt(
  documentText: string,
  start: number,
  end: number,
  prefix?: string,
  suffix?: string
): { prefixScore: number; suffixScore: number; prefixExact: boolean; suffixExact: boolean } {
  let prefixScore = 0;
  let prefixExact = false;
  if (prefix && prefix.length > 0) {
    const available = Math.min(prefix.length, start);
    let matched = 0;
    while (matched < available && documentText.charCodeAt(start - 1 - matched) === prefix.charCodeAt(prefix.length - 1 - matched)) {
      matched++;
    }
    prefixScore = matched / prefix.length;
    prefixExact = matched === prefix.length;
  }

  let suffixScore = 0;
  let suffixExact = false;
  if (suffix && suffix.length > 0) {
    const available = Math.min(suffix.length, documentText.length - end);
    let matched = 0;
    while (matched < available && documentText.charCodeAt(end + matched) === suffix.charCodeAt(matched)) {
      matched++;
    }
    suffixScore = matched / suffix.length;
    suffixExact = matched === suffix.length;
  }

  return { prefixScore, suffixScore, prefixExact, suffixExact };
}

function isShortQuoteRejected(
  quoteLength: number,
  prefix: string | undefined,
  suffix: string | undefined,
  prefixScore: number,
  suffixScore: number,
  distance: number,
  maxProximityForShortQuote: number
): boolean {
  const hasContext = Boolean((prefix && prefix.length > 0) || (suffix && suffix.length > 0));
  return (
    quoteLength < 4 &&
    hasContext &&
    prefixScore + suffixScore === 0 &&
    distance > maxProximityForShortQuote
  );
}

function withAttachedBounds(anchor: TextAnchor, start: number, end: number): TextAnchor {
  if (anchor.start === start && anchor.end === end && anchor.state === 'attached') {
    return anchor;
  }
  return {
    ...anchor,
    start,
    end,
    state: 'attached'
  };
}

function asOrphaned(anchor: TextAnchor): TextAnchor {
  if (anchor.state === 'orphaned') {
    return anchor;
  }
  return {
    ...anchor,
    state: 'orphaned'
  };
}

function reconcileEmptyQuote(anchor: TextAnchor, documentText: string): TextAnchor {
  const prefix = anchor.quote.prefix ?? '';
  const suffix = anchor.quote.suffix ?? '';

  if (!prefix && !suffix) {
    if (anchor.start <= documentText.length) {
      return withAttachedBounds(anchor, anchor.start, anchor.start);
    }
    return asOrphaned(anchor);
  }

  if (anchor.start <= documentText.length) {
    const { prefixExact, suffixExact } = scoreContextAt(
      documentText,
      anchor.start,
      anchor.start,
      prefix,
      suffix
    );
    const hasPrefix = prefix.length > 0;
    const hasSuffix = suffix.length > 0;
    if ((!hasPrefix || prefixExact) && (!hasSuffix || suffixExact)) {
      return withAttachedBounds(anchor, anchor.start, anchor.start);
    }
  }

  const boundaryNeedle = `${prefix}${suffix}`;
  const candidates = findAllOccurrences(documentText, boundaryNeedle);
  if (candidates.length > 0) {
    let bestPos = candidates[0] + prefix.length;
    let bestDist = Math.abs(bestPos - anchor.start);
    for (let i = 1; i < candidates.length; i++) {
      const pos = candidates[i] + prefix.length;
      const dist = Math.abs(pos - anchor.start);
      if (dist < bestDist) {
        bestDist = dist;
        bestPos = pos;
      }
    }
    return withAttachedBounds(anchor, bestPos, bestPos);
  }

  return asOrphaned(anchor);
}

function buildWhitespaceNormalizedMap(text: string): {
  normalized: string;
  normToOrigStart: number[];
  normToOrigEnd: number[];
} {
  let normalized = '';
  const normToOrigStart: number[] = [];
  const normToOrigEnd: number[] = [];
  let i = 0;

  while (i < text.length) {
    if (/\s/.test(text[i])) {
      const start = i;
      while (i < text.length && /\s/.test(text[i])) {
        i++;
      }
      normalized += ' ';
      normToOrigStart.push(start);
      normToOrigEnd.push(i);
    } else {
      normalized += text[i];
      normToOrigStart.push(i);
      normToOrigEnd.push(i + 1);
      i++;
    }
  }

  return { normalized, normToOrigStart, normToOrigEnd };
}

function normalizeQuoteWhitespace(exact: string): string {
  const collapsed = exact.replace(/\s+/g, ' ');
  const trimmed = collapsed.trim();
  return trimmed.length > 0 ? trimmed : collapsed;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n];
}

/**
 * Re-resolves a `TextAnchor` against updated `documentText`.
 *
 * Strategy:
 * 1. Fast exact-offset check with context verification.
 * 2. Exact `quote.exact` search ranked by `prefix`/`suffix` match and proximity.
 * 3. Whitespace-normalized quote search (for wrapped/reflowed lines).
 * 4. Context-framed fuzzy match using normalized Levenshtein similarity.
 * 5. Otherwise marks `state: 'orphaned'` while keeping offsets and quote intact so undo restores it.
 *
 * Returns the exact same `anchor` reference when offsets and state are unchanged.
 */
export function reconcileTextAnchor(
  anchor: TextAnchor,
  documentText: string,
  options: ReconcileAnchorOptions = {}
): TextAnchor {
  const fuzzyThreshold = options.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
  const maxProximityForShortQuote =
    options.maxProximityForShortQuote ?? DEFAULT_MAX_PROXIMITY_SHORT_QUOTE;

  const { exact, prefix, suffix } = anchor.quote;

  if (exact.length === 0) {
    return reconcileEmptyQuote(anchor, documentText);
  }

  const exactCandidates = findAllOccurrences(documentText, exact);

  // 1. Fast exact-offset check
  if (
    anchor.start >= 0 &&
    anchor.end <= documentText.length &&
    anchor.end - anchor.start === exact.length &&
    documentText.slice(anchor.start, anchor.end) === exact
  ) {
    const { prefixExact, suffixExact } = scoreContextAt(
      documentText,
      anchor.start,
      anchor.end,
      prefix,
      suffix
    );
    const hasNoContext = !prefix && !suffix;
    if (exactCandidates.length <= 1 || prefixExact || suffixExact || hasNoContext) {
      return withAttachedBounds(anchor, anchor.start, anchor.end);
    }
  }

  // 2. Exact quote search scored by prefix/suffix context and offset proximity
  if (exactCandidates.length > 0) {
    let bestStart = -1;
    let bestScore = -1;
    let bestDist = Infinity;

    for (const idx of exactCandidates) {
      const candEnd = idx + exact.length;
      const { prefixScore, suffixScore } = scoreContextAt(
        documentText,
        idx,
        candEnd,
        prefix,
        suffix
      );
      const dist = Math.abs(idx - anchor.start);

      if (
        isShortQuoteRejected(
          exact.length,
          prefix,
          suffix,
          prefixScore,
          suffixScore,
          dist,
          maxProximityForShortQuote
        )
      ) {
        continue;
      }

      const score = prefixScore + suffixScore;
      if (score > bestScore || (score === bestScore && dist < bestDist)) {
        bestScore = score;
        bestDist = dist;
        bestStart = idx;
      }
    }

    if (bestStart !== -1) {
      return withAttachedBounds(anchor, bestStart, bestStart + exact.length);
    }
  }

  // 3a. Whitespace-normalized quote search
  const normExact = normalizeQuoteWhitespace(exact);
  if (normExact.length > 0) {
    const { normalized, normToOrigStart, normToOrigEnd } = buildWhitespaceNormalizedMap(documentText);
    const normCandidates = findAllOccurrences(normalized, normExact);
    if (normCandidates.length > 0) {
      let bestOrigStart = -1;
      let bestOrigEnd = -1;
      let bestScore = -1;
      let bestDist = Infinity;

      for (const normIdx of normCandidates) {
        const origStart = normToOrigStart[normIdx];
        const origEnd = normToOrigEnd[normIdx + normExact.length - 1];
        const { prefixScore, suffixScore } = scoreContextAt(
          documentText,
          origStart,
          origEnd,
          prefix,
          suffix
        );
        const dist = Math.abs(origStart - anchor.start);

        if (
          isShortQuoteRejected(
            exact.length,
            prefix,
            suffix,
            prefixScore,
            suffixScore,
            dist,
            maxProximityForShortQuote
          )
        ) {
          continue;
        }

        const score = prefixScore + suffixScore;
        if (score > bestScore || (score === bestScore && dist < bestDist)) {
          bestScore = score;
          bestDist = dist;
          bestOrigStart = origStart;
          bestOrigEnd = origEnd;
        }
      }

      if (bestOrigStart !== -1) {
        return withAttachedBounds(anchor, bestOrigStart, bestOrigEnd);
      }
    }
  }

  // 3b. Context-framed fuzzy match when both prefix and suffix are substantial and intact
  if (prefix && prefix.length >= 4 && suffix && suffix.length >= 4) {
    const prefixMatches = findAllOccurrences(documentText, prefix);
    const suffixMatches = findAllOccurrences(documentText, suffix);
    const maxSpanLength = Math.max(exact.length * 2, exact.length + 32);

    let bestStart = -1;
    let bestEnd = -1;
    let bestSimilarity = -1;
    let bestDist = Infinity;

    for (const pIdx of prefixMatches) {
      const spanStart = pIdx + prefix.length;
      for (const sIdx of suffixMatches) {
        if (sIdx < spanStart) continue;
        const spanLength = sIdx - spanStart;
        if (spanLength === 0 || spanLength > maxSpanLength) continue;

        const candidate = documentText.slice(spanStart, sIdx);
        const maxLen = Math.max(candidate.length, exact.length);
        const similarity = maxLen === 0 ? 1 : 1 - levenshteinDistance(candidate, exact) / maxLen;
        if (similarity < fuzzyThreshold) continue;

        const dist = Math.abs(spanStart - anchor.start);
        if (
          similarity > bestSimilarity ||
          (similarity === bestSimilarity && dist < bestDist)
        ) {
          bestSimilarity = similarity;
          bestDist = dist;
          bestStart = spanStart;
          bestEnd = sIdx;
        }
      }
    }

    if (bestStart !== -1) {
      return withAttachedBounds(anchor, bestStart, bestEnd);
    }
  }

  // 4. Mark orphaned while preserving original offsets & quote for undo recovery
  return asOrphaned(anchor);
}

/**
 * Re-anchors all anchored conversations in an array against `documentText`.
 * Preserves array and object referential equality when nothing changed.
 */
export function reconcileConversationAnchors(
  conversations: Conversation[],
  documentText: string,
  options: ReconcileAnchorOptions = {}
): Conversation[] {
  let changed = false;
  const next = conversations.map(convo => {
    if (!convo.anchor) return convo;
    const reconciled = reconcileTextAnchor(convo.anchor, documentText, options);
    if (reconciled === convo.anchor) return convo;
    changed = true;
    return {
      ...convo,
      anchor: reconciled
    };
  });

  return changed ? next : conversations;
}

/**
 * Filters a list of conversations to those matching `entityId` (and optional `entityType`).
 */
export function filterConversationsByEntity(
  conversations: Conversation[],
  entityId: string,
  entityType?: string
): Conversation[] {
  return conversations.filter(
    convo =>
      convo.entity.id === entityId && (!entityType || convo.entity.type === entityType)
  );
}

export interface SortByAnchorOptions {
  /** When true, `'orphaned'` anchors sort after `'attached'` anchors. Defaults to `false`. */
  orphanedLast?: boolean;
}

/**
 * Sorts conversations by document anchor position (`start`, `end`, `createdAt`, `id`),
 * placing anchored conversations before unanchored ones.
 */
export function sortConversationsByAnchor(
  conversations: Conversation[],
  options: SortByAnchorOptions = {}
): Conversation[] {
  const orphanedLast = options.orphanedLast ?? false;

  return [...conversations].sort((a, b) => {
    const aAnchored = Boolean(a.anchor);
    const bAnchored = Boolean(b.anchor);
    if (aAnchored !== bAnchored) {
      return aAnchored ? -1 : 1;
    }

    if (a.anchor && b.anchor) {
      if (orphanedLast && a.anchor.state !== b.anchor.state) {
        return a.anchor.state === 'attached' ? -1 : 1;
      }
      if (a.anchor.start !== b.anchor.start) {
        return a.anchor.start - b.anchor.start;
      }
      if (a.anchor.end !== b.anchor.end) {
        return a.anchor.end - b.anchor.end;
      }
    }

    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return a.id.localeCompare(b.id);
  });
}
