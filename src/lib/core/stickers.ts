import type { Message, MessageReaction } from '../types.js';

export type MaybePromise<T> = T | Promise<T>;

export interface StickerLicence {
  spdx?: string;
  name: string;
  attribution?: string;
  url?: string;
  commercial: boolean;
}

export type StickerFormat = 'svg' | 'png';
export type StickerVariant = 'light' | 'dark';

export interface StickerCollection {
  id: string;
  name: string;
  description?: string;
  count: number;
}

export interface StickerSummary {
  id: string;
  name: string;
  category: string;
  tags?: string[];
  description?: string;
  width: number;
  height: number;
  thumbnail?: string;
  formats: StickerFormat[];
  licence: StickerLicence;
  tintable: boolean;
  aiGenerated?: boolean;
  variants?: StickerVariant[];
  collection?: string;
}

/**
 * Compatible structurally with both `@pixerate/editor/stickers` (`variants?: StickerVariant[]`)
 * and `@pixerate/stickers` (`variants?: { id: string; name: string }[]`).
 */
export interface StickerDescription extends Omit<StickerSummary, 'variants'> {
  silhouette?: string;
  colours?: string[];
  variants?: StickerVariant[] | Array<{ id: string; name: string }>;
}

export type StickerAsset =
  | { kind: 'svg'; svg: string; silhouette?: string }
  | { kind: 'image'; url: string; width: number; height: number };

export interface StickerPage {
  items: StickerSummary[];
  total: number;
  next?: string;
}

export interface StickerSearchOptions {
  category?: string;
  collection?: string;
  tags?: string[];
  limit?: number;
  after?: string;
  licence?: { commercial?: boolean };
}

export interface StickerLoadOptions {
  format?: StickerFormat;
  size?: number;
  colour?: string;
  variant?: StickerVariant;
}

export interface StickerProviderCapabilities {
  supportsSearch: boolean;
  supportsSvg: boolean;
  supportsRaster: boolean;
  maxSize?: number;
}

/**
 * Structural `StickerProvider` matching `@pixerate/editor/stickers` and `@pixerate/stickers`
 * without requiring a runtime dependency on either package.
 */
export interface StickerProvider {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
  readonly capabilities: StickerProviderCapabilities;
  readonly namespaced?: boolean;
  list(options?: StickerSearchOptions): MaybePromise<StickerPage>;
  search(query: string, options?: StickerSearchOptions): MaybePromise<StickerPage>;
  describe(id: string): MaybePromise<StickerDescription | undefined>;
  load(id: string, options?: StickerLoadOptions): MaybePromise<StickerAsset>;
  categories?(): MaybePromise<Array<{ id: string; name: string; count: number }>>;
  collections?(): MaybePromise<StickerCollection[]>;
  listCollections?(): MaybePromise<StickerCollection[]>;
  /**
   * Maps an id of a combined provider to the pack that owns it, for providers whose ids
   * do not reveal their owner (`pixerate-heart` -> `{ providerId: 'pixerate', id: 'heart' }`).
   */
  resolveStickerOwner?(id: string): { providerId: string; id: string } | undefined;
}

/**
 * Accepts a single `StickerProvider` (shortcodes like `:heart:`) or multiple providers
 * (shortcodes namespaced with dashes like `:pixerate-heart:`).
 */
export type StickerProviderInput = StickerProvider | readonly StickerProvider[];

export interface ResolvedSticker {
  /** The sticker's id within its owning provider (e.g. `"heart"`). */
  id: string;
  /** The owning provider's id (e.g. `"pixerate"`). */
  providerId: string;
  /** Canonical colon-separated ref (`"pixerate:heart"`). */
  ref: string;
  /** Shortcode for messages/reactions (`":heart:"` for single pack, `":pixerate-heart:"` for multi-pack). */
  shortcode: string;
  /** Loaded SVG or raster image asset. */
  asset: StickerAsset;
  /** Optional metadata description when requested via `includeDescription`. */
  description?: StickerDescription;
}

export type MessageStickerSegment =
  | { type: 'text'; value: string }
  | { type: 'sticker'; shortcode: string; id: string };

const DEFAULT_PAGE_LIMIT = 24;
const MAX_PAGE_LIMIT = 100;

/**
 * Matches a run of one or more back-to-back `:shortcode:` tokens, where each inner id is
 * kebab-case starting with a lowercase ASCII letter, and the run is not part of `::`, `://`,
 * URL ports, or adjacent word characters.
 */
const SHORTCODE_RUN_REGEX = /(?<![:\w/])(?::[a-z][a-z0-9-]*:)+(?![:\w/])/g;
const SHORTCODE_TOKEN_REGEX = /:([a-z][a-z0-9-]*):/g;

function* matchShortcodes(
  text: string
): Generator<{ index: number; shortcode: string; id: string }> {
  for (const run of text.matchAll(SHORTCODE_RUN_REGEX)) {
    for (const token of run[0].matchAll(SHORTCODE_TOKEN_REGEX)) {
      yield { index: run.index + token.index, shortcode: token[0], id: token[1] };
    }
  }
}

function unknownStickerError(message: string): Error {
  return Object.assign(new Error(message), { code: 'unknown_sticker' });
}

/** True for a provider's "no such sticker" refusal, as opposed to a real failure. */
function isStickerMiss(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return code === 'unknown_sticker' || code === 'unknown_set';
}

/**
 * Picks a format the provider can serve. A namespaced provider may mix formats across
 * packs, so it is left to decide per pack.
 */
function withDefaultFormat(
  provider: StickerProvider,
  options: StickerLoadOptions = {}
): StickerLoadOptions {
  if (options.format || provider.namespaced) return options;
  return { ...options, format: provider.capabilities.supportsSvg ? 'svg' : 'png' };
}

function stripColons(token: string): string {
  const trimmed = token.trim();
  if (trimmed.startsWith(':') && trimmed.endsWith(':') && trimmed.length > 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isProviderArray(input: StickerProviderInput): input is readonly StickerProvider[] {
  return Array.isArray(input);
}

function isMultiPack(provider?: StickerProviderInput): boolean {
  if (!provider) return false;
  if (isProviderArray(provider)) {
    return provider.length > 1 || Boolean(provider[0]?.namespaced);
  }
  return Boolean(provider.namespaced);
}

/**
 * Formats a sticker id or `provider:id` ref into a message shortcode:
 * - Single sticker pack (`pixerateStickers()`): `:heart:`
 * - Multiple sticker packs (`[pixerateStickers(), slopMachineStickers()]` or combined provider): `:pixerate-heart:`
 */
export function formatStickerShortcode(
  idOrRef: string,
  provider?: StickerProviderInput
): string {
  const raw = stripColons(idOrRef);
  if (!raw) return '';

  const singleProvider =
    provider && !isProviderArray(provider) && !provider.namespaced
      ? provider
      : provider && isProviderArray(provider) && provider.length === 1 && !provider[0].namespaced
        ? provider[0]
        : null;

  const colonIdx = raw.indexOf(':');
  if (singleProvider) {
    if (colonIdx > 0) {
      const prefix = raw.slice(0, colonIdx);
      const rest = raw.slice(colonIdx + 1);
      return prefix === singleProvider.id ? `:${rest}:` : `:${prefix}-${rest}:`;
    }
    // `:pixerate-heart:` and `:heart:` resolve to the same sticker in a single pack
    const ownPrefix = `${singleProvider.id}-`;
    if (raw.startsWith(ownPrefix) && raw.length > ownPrefix.length) {
      return `:${raw.slice(ownPrefix.length)}:`;
    }
    return `:${raw}:`;
  }

  if (colonIdx > 0) {
    const prefix = raw.slice(0, colonIdx);
    const rest = raw.slice(colonIdx + 1);
    return `:${prefix}-${rest}:`;
  }

  return `:${raw}:`;
}

/**
 * Parses a `:shortcode:` string and returns the inner sticker identifier (`"heart"` or `"pixerate-heart"`),
 * or `null` if the string is not a valid sticker shortcode.
 */
export function parseStickerShortcode(shortcode: string): string | null {
  if (typeof shortcode !== 'string') return null;
  const trimmed = shortcode.trim();
  const match = /^:([a-z][a-z0-9-]*):$/.exec(trimmed);
  return match ? match[1] : null;
}

/**
 * Combines multiple `StickerProvider` instances into a single `StickerProvider` whose ids
 * are dash-namespaced (`pixerate-heart`, `slop-machine-slop-bucket`) when multiple packs
 * are supplied, or returns the single provider directly when only one is given.
 */
export function combineMessageStickerProviders(
  providers: readonly StickerProvider[],
  options: { id?: string; name?: string } = {}
): StickerProvider {
  if (providers.length === 0) {
    throw new Error('combineMessageStickerProviders requires at least one StickerProvider.');
  }
  if (providers.length === 1 && !options.id && !options.name) {
    return providers[0];
  }

  const ids = providers.map(p => p.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) {
    throw new Error(`Duplicate sticker provider id "${dup}"; each provider must have a unique id.`);
  }

  // Sort by longest provider id first so e.g. "slop-machine" matches before "slop"
  const sortedByPrefix = [...providers].sort((a, b) => b.id.length - a.id.length);
  const byId = new Map(providers.map(p => [p.id, p]));

  const resolveOwner = (rawId: string): { provider: StickerProvider; id: string } => {
    const clean = stripColons(rawId);
    const colonIdx = clean.indexOf(':');
    if (colonIdx > 0) {
      const p = byId.get(clean.slice(0, colonIdx));
      if (!p) {
        throw unknownStickerError(
          `Unknown sticker provider "${clean.slice(0, colonIdx)}". Available providers: ${ids.join(', ')}.`
        );
      }
      return { provider: p, id: clean.slice(colonIdx + 1) };
    }

    for (const p of sortedByPrefix) {
      const prefix = `${p.id}-`;
      if (clean.startsWith(prefix) && clean.length > prefix.length) {
        return { provider: p, id: clean.slice(prefix.length) };
      }
    }

    if (providers.length === 1) {
      return { provider: providers[0], id: clean };
    }

    throw unknownStickerError(
      `Sticker "${rawId}" must be namespaced with its pack id (e.g. ":${providers[0].id}-${clean}:"). Available packs: ${ids.join(', ')}.`
    );
  };

  const prefixSummary = <S extends StickerSummary | StickerDescription>(
    p: StickerProvider,
    s: S
  ): S => {
    const rawId = p.namespaced ? s.id.replace(/:/g, '-') : `${p.id}-${s.id}`;
    return {
      ...s,
      id: rawId,
      ...(s.collection ? { collection: p.namespaced ? s.collection : `${p.id}-${s.collection}` } : {})
    };
  };

  const page = async (
    query: string | null,
    searchOpts: StickerSearchOptions = {}
  ): Promise<StickerPage> => {
    const limit = searchOpts.limit ?? DEFAULT_PAGE_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      throw new Error(`limit must be a whole number from 1 to ${MAX_PAGE_LIMIT}, got ${limit}.`);
    }

    const { after: _after, limit: _limit, ...baseFilters } = searchOpts;

    // Results carry `<pack>-<collection>` ids, so a filter on one targets only that pack
    let targets: readonly StickerProvider[] = providers;
    let filters = baseFilters;
    const collection = baseFilters.collection;
    const collectionOwner = collection
      ? sortedByPrefix.find(
          p =>
            !p.namespaced &&
            collection.startsWith(`${p.id}-`) &&
            collection.length > p.id.length + 1
        )
      : undefined;
    if (collection && collectionOwner) {
      targets = [collectionOwner];
      filters = { ...baseFilters, collection: collection.slice(collectionOwner.id.length + 1) };
    }

    let providerIdx = 0;
    let innerCursor: string | undefined;
    if (searchOpts.after !== undefined) {
      const m = /^(\d+)\|(.*)$/.exec(searchOpts.after);
      if (!m || Number(m[1]) >= targets.length) {
        throw new Error(
          `after "${searchOpts.after}" is not a valid cursor; pass the next value from the previous page.`
        );
      }
      providerIdx = Number(m[1]);
      innerCursor = m[2] || undefined;
    }

    const runProvider = (p: StickerProvider, opts: StickerSearchOptions) =>
      query === null ? p.list(opts) : p.search(query, opts);

    let total = 0;
    for (const p of targets) {
      total += (await runProvider(p, { ...filters, limit: 1 })).total;
    }

    const items: StickerSummary[] = [];
    let next: string | undefined;

    while (providerIdx < targets.length && items.length < limit) {
      const p = targets[providerIdx];
      const res = await runProvider(p, {
        ...filters,
        limit: limit - items.length,
        ...(innerCursor ? { after: innerCursor } : {})
      });
      items.push(...res.items.map(s => prefixSummary(p, s)));
      if (res.next && res.items.length > 0) {
        innerCursor = res.next;
        if (items.length >= limit) {
          next = `${providerIdx}|${innerCursor}`;
        }
        continue;
      }
      providerIdx++;
      innerCursor = undefined;
    }

    if (!next && items.length >= limit && providerIdx < targets.length) {
      next = `${providerIdx}|`;
    }

    return { items, total, ...(next ? { next } : {}) };
  };

  return {
    id: options.id ?? 'stickers',
    name: options.name ?? providers.map(p => p.name).join(' + '),
    namespaced: true,
    capabilities: {
      supportsSearch: providers.some(p => p.capabilities.supportsSearch),
      supportsSvg: providers.some(p => p.capabilities.supportsSvg),
      supportsRaster: providers.some(p => p.capabilities.supportsRaster),
      ...(providers.every(p => p.capabilities.maxSize)
        ? { maxSize: Math.max(...providers.map(p => p.capabilities.maxSize!)) }
        : {})
    },
    list: opts => page(null, opts),
    search: (q, opts) => page(q, opts),
    async describe(id) {
      try {
        const { provider, id: innerId } = resolveOwner(id);
        const d = await provider.describe(innerId);
        return d ? prefixSummary(provider, d) : undefined;
      } catch (err) {
        if (isStickerMiss(err)) return undefined;
        throw err;
      }
    },
    async load(id, opts) {
      const { provider, id: innerId } = resolveOwner(id);
      return provider.load(innerId, withDefaultFormat(provider, opts));
    },
    resolveStickerOwner(id) {
      try {
        const { provider, id: innerId } = resolveOwner(id);
        return { providerId: provider.id, id: innerId };
      } catch {
        return undefined;
      }
    },
    async categories() {
      const counts = new Map<string, { id: string; name: string; count: number }>();
      for (const p of providers) {
        for (const c of (await p.categories?.()) ?? []) {
          const existing = counts.get(c.id);
          counts.set(c.id, {
            id: c.id,
            name: existing?.name ?? c.name,
            count: (existing?.count ?? 0) + c.count
          });
        }
      }
      return [...counts.values()];
    }
  };
}

/**
 * Extracts unique inline sticker shortcode IDs (e.g. `"heart"` from `:heart:` or
 * `"pixerate-heart"` from `:pixerate-heart:`) from plain-text or Markdown message content.
 * Shields fenced code blocks and inline code spans from accidental matching.
 */
export function extractStickerTokensFromText(text: string): string[] {
  if (!text) return [];

  const shielded = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');

  const ids = new Set<string>();
  for (const { id } of matchShortcodes(shielded)) {
    ids.add(id);
  }
  return Array.from(ids);
}

/**
 * Extracts unique inline sticker IDs from rich HTML content (`<span data-type="sticker" ...>`
 * or `data-sticker` / `data-sticker-id` / `data-sticker-ref` attributes, plus `:shortcode:` text),
 * ignoring `<pre>` and `<code>` blocks.
 */
export function extractStickerIdsFromHtml(html: string): string[] {
  if (!html) return [];

  const shielded = html
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '');

  const ids = new Set<string>();

  // 1. Explicit data-sticker / data-sticker-id / data-sticker-ref attributes
  const attrRegex = /(?:data-sticker|data-sticker-id|data-sticker-ref)=["']([^"']+)["']/gi;
  for (const match of shielded.matchAll(attrRegex)) {
    if (match[1]) {
      ids.add(stripColons(match[1]));
    }
  }

  // 2. <span data-type="sticker" data-id="..."> elements
  const tagRegex = /<[a-z0-9]+\b[^>]*\bdata-type=["']sticker["'][^>]*>/gi;
  for (const tagMatch of shielded.matchAll(tagRegex)) {
    const idMatch = /\bdata-id=["']([^"']+)["']/i.exec(tagMatch[0]);
    if (idMatch?.[1]) {
      ids.add(stripColons(idMatch[1]));
    }
  }

  // 3. Plain-text shortcodes outside HTML tags
  const textOnly = shielded.replace(/<[^>]+>/g, ' ');
  for (const token of extractStickerTokensFromText(textOnly)) {
    ids.add(token);
  }

  return Array.from(ids);
}

/**
 * Harvests all unique inline sticker identifiers from a message's `content` and `richContent`.
 */
export function extractMessageStickers(content: string, richContent?: string): string[] {
  const ids = new Set<string>(extractStickerTokensFromText(content));
  if (richContent) {
    for (const id of extractStickerIdsFromHtml(richContent)) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

/**
 * Merges explicitly attached sticker ids with those harvested from a message's content,
 * keeping the explicit ones first and dropping duplicates.
 */
export function mergeMessageStickers(
  explicit: readonly string[] | undefined,
  content: string,
  richContent?: string
): string[] {
  return Array.from(new Set([...(explicit ?? []), ...extractMessageStickers(content, richContent)]));
}

/**
 * Reads the sticker provider from a framework wrapper's options, which accept either
 * `{ stickerProvider }` or the provider input itself.
 */
export function unwrapStickerProvider(
  options?: { stickerProvider?: StickerProviderInput } | StickerProviderInput
): StickerProviderInput | undefined {
  if (!options) return undefined;
  if (isProviderArray(options as StickerProviderInput)) return options as StickerProviderInput;
  if (typeof (options as StickerProvider).load === 'function') {
    return options as StickerProvider;
  }
  return (options as { stickerProvider?: StickerProviderInput }).stickerProvider;
}

/**
 * Splits message text into alternating `'text'` and `'sticker'` segments so UI components
 * can render inline stickers alongside text without matching inside fenced or inline code blocks.
 */
export function parseMessageStickerSegments(text: string): MessageStickerSegment[] {
  if (!text) return [];

  const segments: MessageStickerSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const prev = segments[segments.length - 1];
    if (prev && prev.type === 'text') {
      prev.value += value;
    } else {
      segments.push({ type: 'text', value });
    }
  };

  // Tokenize code spans first so shortcodes inside code stay literal text
  const codeBlockRegex = /(```[\s\S]*?```|`[^`\n]+`)/g;
  let lastIndex = 0;

  const parsePlainChunk = (chunk: string) => {
    let chunkIndex = 0;
    for (const { index, shortcode, id } of matchShortcodes(chunk)) {
      if (index > chunkIndex) {
        pushText(chunk.slice(chunkIndex, index));
      }
      segments.push({ type: 'sticker', shortcode, id });
      chunkIndex = index + shortcode.length;
    }
    if (chunkIndex < chunk.length) {
      pushText(chunk.slice(chunkIndex));
    }
  };

  for (const match of text.matchAll(codeBlockRegex)) {
    const start = match.index!;
    if (start > lastIndex) {
      parsePlainChunk(text.slice(lastIndex, start));
    }
    pushText(match[0]);
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    parsePlainChunk(text.slice(lastIndex));
  }

  return segments;
}

export interface ResolveStickerOptions extends StickerLoadOptions {
  /** Also fetch `StickerDescription` from `provider.describe(id)`. */
  includeDescription?: boolean;
  /**
   * Called when a provider fails for a reason other than an unknown sticker, such as a
   * network error. Resolution still yields `undefined` so one bad sticker cannot break
   * rendering a message; this is how callers tell the two apart.
   */
  onError?: (error: unknown, token: string) => void;
}

interface StickerLoadContext {
  loadOpts: StickerLoadOptions;
  includeDescription: boolean | undefined;
  reportError: (error: unknown) => void;
}

/**
 * Resolves a sticker shortcode (`:heart:` or `:pixerate-heart:`), bare id (`heart` or `pixerate-heart`),
 * or colon ref (`pixerate:heart`) against a single `StickerProvider` or an array of `StickerProvider`s.
 * Returns `undefined` when the token does not match any sticker in the provider(s).
 */
export async function resolveSticker(
  providerInput: StickerProviderInput,
  tokenOrRef: string,
  options: ResolveStickerOptions = {}
): Promise<ResolvedSticker | undefined> {
  if (!tokenOrRef || typeof tokenOrRef !== 'string') return undefined;
  const clean = stripColons(tokenOrRef);
  if (!clean) return undefined;

  const { includeDescription, onError, ...loadOpts } = options;
  const ctx: StickerLoadContext = {
    loadOpts,
    includeDescription,
    reportError: error => onError?.(error, tokenOrRef)
  };

  // Case 1: Array of providers
  if (Array.isArray(providerInput)) {
    if (providerInput.length === 0) return undefined;
    if (providerInput.length === 1) {
      return resolveFromSingleProvider(providerInput[0], clean, ctx);
    }

    const sorted = [...providerInput].sort((a, b) => b.id.length - a.id.length);
    const colonIdx = clean.indexOf(':');
    if (colonIdx > 0) {
      const targetProviderId = clean.slice(0, colonIdx);
      const innerId = clean.slice(colonIdx + 1);
      const matched = providerInput.find(p => p.id === targetProviderId);
      if (!matched) return undefined;
      return loadFromProvider(matched, innerId, ctx, true);
    }

    for (const p of sorted) {
      const prefix = `${p.id}-`;
      if (clean.startsWith(prefix) && clean.length > prefix.length) {
        const innerId = clean.slice(prefix.length);
        const resolved = await loadFromProvider(p, innerId, ctx, true);
        if (resolved) return resolved;
      }
    }
    return undefined;
  }

  // Case 2: Single StickerProvider (either standalone or pre-combined namespaced)
  return resolveFromSingleProvider(providerInput as StickerProvider, clean, ctx);
}

async function resolveFromSingleProvider(
  provider: StickerProvider,
  clean: string,
  ctx: StickerLoadContext
): Promise<ResolvedSticker | undefined> {
  if (!provider.namespaced) {
    // Non-namespaced single provider (e.g. `pixerateStickers()`, id = "pixerate")
    // Try exact id first (e.g. "heart", or "slop-bucket" in "slop-machine")
    const candidates: string[] = [];
    const colonIdx = clean.indexOf(':');
    if (colonIdx > 0) {
      if (clean.slice(0, colonIdx) !== provider.id) return undefined;
      candidates.push(clean.slice(colonIdx + 1));
    } else {
      candidates.push(clean);
      const dashPrefix = `${provider.id}-`;
      if (clean.startsWith(dashPrefix) && clean.length > dashPrefix.length) {
        candidates.push(clean.slice(dashPrefix.length));
      }
    }

    for (const candidate of candidates) {
      const resolved = await loadFromProvider(provider, candidate, ctx, false);
      if (resolved) return resolved;
    }
    return undefined;
  }

  // Pre-combined namespaced provider (e.g. `combineStickerProviders` or `combineMessageStickerProviders`)
  // 1. Try as-is (works when `clean` is `pixerate:heart` or dash-namespaced in `combineMessageStickerProviders`)
  const owner = clean.includes(':') ? undefined : provider.resolveStickerOwner?.(clean);
  const direct = await loadFromNamespacedProvider(
    provider,
    clean,
    ctx,
    owner?.providerId,
    owner?.id
  );
  if (direct) return direct;

  // 2. If `clean` is dash-namespaced (`pixerate-heart` or `slop-machine-slop-bucket`) and the
  // underlying provider uses colon refs (`pixerate:heart`, `slop-machine:slop-bucket`), try
  // splitting at each `-` from longest prefix to shortest.
  if (!clean.includes(':')) {
    const dashIndices: number[] = [];
    for (let i = 1; i < clean.length - 1; i++) {
      if (clean[i] === '-') dashIndices.push(i);
    }
    for (let k = dashIndices.length - 1; k >= 0; k--) {
      const splitIdx = dashIndices[k];
      const candidateProvider = clean.slice(0, splitIdx);
      const candidateId = clean.slice(splitIdx + 1);
      const colonRef = `${candidateProvider}:${candidateId}`;
      const resolved = await loadFromNamespacedProvider(
        provider,
        colonRef,
        ctx,
        candidateProvider,
        candidateId
      );
      if (resolved) return resolved;
    }
  }

  return undefined;
}

/** Loads an asset, keeping it even if the optional description cannot be fetched. */
async function loadAsset(
  provider: StickerProvider,
  id: string,
  ctx: StickerLoadContext
): Promise<{ asset: StickerAsset; description?: StickerDescription } | undefined> {
  const report = (err: unknown) => {
    if (!isStickerMiss(err)) ctx.reportError(err);
  };

  let asset: StickerAsset;
  try {
    asset = await provider.load(id, withDefaultFormat(provider, ctx.loadOpts));
  } catch (err) {
    report(err);
    return undefined;
  }

  if (!ctx.includeDescription) return { asset };
  try {
    const description = await provider.describe(id);
    return { asset, ...(description ? { description } : {}) };
  } catch (err) {
    report(err);
    return { asset };
  }
}

async function loadFromProvider(
  provider: StickerProvider,
  id: string,
  ctx: StickerLoadContext,
  multi: boolean
): Promise<ResolvedSticker | undefined> {
  const loaded = await loadAsset(provider, id, ctx);
  if (!loaded) return undefined;
  return {
    id,
    providerId: provider.id,
    ref: `${provider.id}:${id}`,
    shortcode: multi ? `:${provider.id}-${id}:` : `:${id}:`,
    ...loaded
  };
}

async function loadFromNamespacedProvider(
  provider: StickerProvider,
  refOrId: string,
  ctx: StickerLoadContext,
  knownProviderId?: string,
  knownInnerId?: string
): Promise<ResolvedSticker | undefined> {
  const loaded = await loadAsset(provider, refOrId, ctx);
  if (!loaded) return undefined;

  let providerId = knownProviderId ?? provider.id;
  let id = knownInnerId ?? refOrId;
  const colonIdx = refOrId.indexOf(':');
  if (colonIdx > 0) {
    providerId = refOrId.slice(0, colonIdx);
    id = refOrId.slice(colonIdx + 1);
  } else if (!knownProviderId && loaded.description?.id) {
    const dColon = loaded.description.id.indexOf(':');
    if (dColon > 0) {
      providerId = loaded.description.id.slice(0, dColon);
      id = loaded.description.id.slice(dColon + 1);
    }
  }

  const dashId = colonIdx > 0 ? `${providerId}-${id}` : refOrId;
  return {
    id,
    providerId,
    ref: colonIdx > 0 ? refOrId : `${providerId}:${id}`,
    shortcode: `:${dashId}:`,
    ...loaded
  };
}

/**
 * Resolves all inline stickers and sticker reactions present on a message.
 * Returns a Map keyed by the raw token/id, its `:shortcode:` and its ref for fast lookup, plus
 * its bare id when a single pack is active.
 */
export async function resolveMessageStickers(
  providerInput: StickerProviderInput,
  message: Pick<Message, 'content' | 'richContent' | 'stickers'> & {
    reactions?: MessageReaction[];
  },
  options: ResolveStickerOptions = {}
): Promise<Map<string, ResolvedSticker>> {
  const tokens = new Set<string>(extractMessageStickers(message.content, message.richContent));
  for (const s of message.stickers ?? []) {
    if (s) tokens.add(s);
  }
  for (const r of message.reactions ?? []) {
    if (r?.sticker) {
      tokens.add(r.sticker);
    } else if (r?.emoji && parseStickerShortcode(r.emoji)) {
      tokens.add(r.emoji);
    }
  }

  // Bare ids are only unique within a pack, so they cannot key a multi-pack map
  const multi = isMultiPack(providerInput);
  const resolvedMap = new Map<string, ResolvedSticker>();
  await Promise.all(
    Array.from(tokens).map(async token => {
      const resolved = await resolveSticker(providerInput, token, options);
      if (resolved) {
        resolvedMap.set(token, resolved);
        resolvedMap.set(stripColons(token), resolved);
        resolvedMap.set(resolved.shortcode, resolved);
        if (!multi) resolvedMap.set(resolved.id, resolved);
        resolvedMap.set(resolved.ref, resolved);
      }
    })
  );

  return resolvedMap;
}

export interface MessageStickerAgentTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  handler: (args: Record<string, unknown>, context?: unknown) => Promise<unknown>;
}

export interface MessageStickerToolsOptions {
  /** Returns the active sticker provider (or array of providers). */
  provider: () => StickerProviderInput;
}

/**
 * Creates agent tools (`find_message_stickers` and `describe_message_sticker`) that surface
 * each sticker's message `shortcode` (`:heart:` when one sticker pack is active, or
 * `:pixerate-heart:` when multiple packs are active) so agents can insert stickers inline
 * in message content or pass them as message reactions in lieu of emoji.
 */
export function createMessageStickerTools(
  options: MessageStickerToolsOptions
): MessageStickerAgentTool[] {
  const getCombined = (): {
    input: StickerProviderInput;
    provider: StickerProvider;
    multi: boolean;
  } => {
    const input = options.provider();
    const multi = isMultiPack(input);
    const provider = isProviderArray(input) ? combineMessageStickerProviders(input) : input;
    return { input, provider, multi };
  };

  const toAgentItem = (
    input: StickerProviderInput,
    provider: StickerProvider,
    s: StickerSummary | StickerDescription
  ) => {
    const { id, thumbnail: _thumbnail, ...rest } = s;
    const shortcode = formatStickerShortcode(
      provider.namespaced ? id : `${provider.id}:${id}`,
      input
    );
    const cleanId = stripColons(shortcode);
    return {
      id: cleanId,
      shortcode,
      ...rest
    };
  };

  const findTool: MessageStickerAgentTool = {
    name: 'find_message_stickers',
    title: 'Find message stickers',
    description:
      'Searches available stickers for use inline in message text or as message reactions in lieu of emoji. Returns each sticker with its `shortcode` (e.g. `:heart:` when a single pack is configured, or `:pixerate-heart:` when multiple packs are configured). Place `shortcode` directly in message content or pass `shortcode` / `id` when reacting to a message.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          maxLength: 200,
          description: 'Search words matching sticker name, tags, category, or description.'
        },
        category: {
          type: 'string',
          description: 'Filter by category id.'
        },
        tags: {
          type: 'array',
          maxItems: 10,
          items: { type: 'string' },
          description: 'Only stickers containing all specified tags.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_PAGE_LIMIT,
          description: 'Page size (1..100, default 24).'
        },
        after: {
          type: 'string',
          description: 'Pagination cursor (`next` from previous page).'
        }
      },
      additionalProperties: false
    },
    annotations: {
      title: 'Find message stickers',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    handler: async ({ query, category, tags, limit, after }) => {
      const { input, provider, multi } = getCombined();
      const searchOpts: StickerSearchOptions = {
        ...(category !== undefined ? { category: category as string } : {}),
        ...(tags !== undefined ? { tags: tags as string[] } : {}),
        ...(limit !== undefined ? { limit: limit as number } : {}),
        ...(after !== undefined ? { after: after as string } : {})
      };
      const q = typeof query === 'string' ? query.trim() : '';
      const page = q ? await provider.search(q, searchOpts) : await provider.list(searchOpts);
      const categories = (await provider.categories?.()) ?? undefined;

      return {
        namespaced: multi,
        items: page.items.map(s => toAgentItem(input, provider, s)),
        total: page.total,
        ...(page.next ? { next: page.next } : {}),
        ...(categories ? { categories } : {})
      };
    }
  };

  const describeTool: MessageStickerAgentTool = {
    name: 'describe_message_sticker',
    title: 'Describe a message sticker',
    description:
      'Returns full details (shortcode, dimensions, variants, colours, licence, and AI attribution) for a sticker by its shortcode (e.g. `:heart:` or `:pixerate-heart:`), id, or ref.',
    inputSchema: {
      type: 'object',
      properties: {
        sticker: {
          type: 'string',
          description: 'Sticker shortcode (`:heart:` or `:pixerate-heart:`), id, or ref.'
        }
      },
      required: ['sticker'],
      additionalProperties: false
    },
    annotations: {
      title: 'Describe a message sticker',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    handler: async ({ sticker }) => {
      const { input } = getCombined();
      let failure: unknown;
      const resolved = await resolveSticker(input, String(sticker), {
        includeDescription: true,
        onError: error => {
          failure = error;
        }
      });
      if (!resolved && failure !== undefined) {
        throw new Error(`Could not load sticker "${String(sticker)}".`, { cause: failure });
      }
      if (!resolved) {
        throw new Error(
          `Unknown sticker "${String(sticker)}". Use find_message_stickers to list available sticker shortcodes.`
        );
      }
      const { thumbnail: _thumbnail, id: _rawId, ...rest } = resolved.description ?? ({} as any);
      return {
        id: stripColons(resolved.shortcode),
        shortcode: resolved.shortcode,
        ref: resolved.ref,
        ...rest
      };
    }
  };

  return [findTool, describeTool];
}
