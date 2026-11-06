import { describe, it, expect } from 'vitest';
import {
  combineMessageStickerProviders,
  createMessageStickerTools,
  extractMessageStickers,
  extractStickerIdsFromHtml,
  extractStickerTokensFromText,
  formatStickerShortcode,
  parseMessageStickerSegments,
  parseStickerShortcode,
  resolveMessageStickers,
  resolveSticker,
  type StickerDescription,
  type StickerProvider,
  type StickerSummary
} from '../core/stickers.js';
import { ConversationManager } from '../core/ConversationManager.js';
import { MemoryConversationDriver } from '../drivers/MemoryConversationDriver.js';

function createMockStickerPack(
  packId: string,
  packName: string,
  stickers: Array<{
    id: string;
    name: string;
    category: string;
    tags: string[];
    tintable?: boolean;
    variants?: ('light' | 'dark')[];
  }>
): StickerProvider {
  const summaries: StickerSummary[] = stickers.map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
    tags: s.tags,
    width: 128,
    height: 128,
    formats: ['svg'],
    licence: { name: 'Pixerate', attribution: 'AI-generated', commercial: true },
    tintable: s.tintable ?? false,
    aiGenerated: true,
    variants: s.variants ?? ['light', 'dark']
  }));

  const byId = new Map(summaries.map(s => [s.id, s]));

  return {
    id: packId,
    name: packName,
    capabilities: { supportsSearch: true, supportsSvg: true, supportsRaster: false },
    list: ({ category, tags, limit = 24, after } = {}) => {
      const filtered = summaries.filter(s => {
        if (category && s.category !== category) return false;
        if (tags?.length && !tags.every(t => s.tags?.includes(t))) return false;
        return true;
      });
      const start = after ? Number(after) : 0;
      const items = filtered.slice(start, start + limit);
      return {
        items,
        total: filtered.length,
        ...(start + limit < filtered.length ? { next: String(start + limit) } : {})
      };
    },
    search: (query, opts = {}) => {
      const q = query.toLowerCase().trim();
      const filtered = summaries.filter(
        s =>
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.tags ?? []).some(t => t.toLowerCase().includes(q))
      );
      const limit = opts.limit ?? 24;
      const start = opts.after ? Number(opts.after) : 0;
      const items = filtered.slice(start, start + limit);
      return {
        items,
        total: filtered.length,
        ...(start + limit < filtered.length ? { next: String(start + limit) } : {})
      };
    },
    describe: (id): StickerDescription | undefined => {
      const s = byId.get(id);
      if (!s) return undefined;
      return {
        ...s,
        colours: ['#ff4d6d'],
        silhouette: 'M0 0L10 10Z',
        variants: [
          { id: 'light', name: 'Light' },
          { id: 'dark', name: 'Dark' }
        ]
      };
    },
    load: (id, opts = {}) => {
      const s = byId.get(id);
      if (!s) throw new Error(`Unknown sticker "${id}" in ${packId}`);
      const variant = opts.variant ?? 'light';
      const colorAttr = s.tintable && opts.colour ? ` color="${opts.colour.toLowerCase()}"` : '';
      return {
        kind: 'svg',
        svg: `<svg${colorAttr} data-pack="${packId}" data-id="${s.id}" data-variant="${variant}"></svg>`,
        silhouette: 'M0 0L10 10Z'
      };
    },
    categories: () => {
      const cats = [...new Set(summaries.map(s => s.category))];
      return cats.map(c => ({
        id: c,
        name: c,
        count: summaries.filter(s => s.category === c).length
      }));
    }
  };
}

const pixeratePack = createMockStickerPack('pixerate', 'Pixerate', [
  { id: 'heart', name: 'Heart', category: 'shapes', tags: ['love', 'like'], tintable: true },
  { id: 'party-popper', name: 'Party Popper', category: 'celebration', tags: ['party', 'ship'] }
]);

const slopMachinePack = createMockStickerPack('slop-machine', 'Slop Machine', [
  { id: 'slop-bucket', name: 'Slop Bucket', category: 'containers', tags: ['slop', 'bucket'] },
  { id: 'slop-heart', name: 'Slop Heart', category: 'shapes', tags: ['love', 'slop'] }
]);

const uchiagePack = createMockStickerPack('uchiage', 'Uchiage', [
  { id: 'daruma', name: 'Daruma', category: 'tradition', tags: ['luck', 'goal'] }
]);

describe('Stickers core utilities', () => {
  describe('formatStickerShortcode & parseStickerShortcode', () => {
    it('uses bare :id: shortcode when a single sticker pack is provided', () => {
      expect(formatStickerShortcode('heart', pixeratePack)).toBe(':heart:');
      expect(formatStickerShortcode(':heart:', pixeratePack)).toBe(':heart:');
      expect(formatStickerShortcode('pixerate:heart', pixeratePack)).toBe(':heart:');
      expect(formatStickerShortcode('party-popper', [pixeratePack])).toBe(':party-popper:');
    });

    it('namespaces shortcodes with dashes when multiple sticker packs are provided', () => {
      const packs = [pixeratePack, slopMachinePack, uchiagePack];
      expect(formatStickerShortcode('pixerate:heart', packs)).toBe(':pixerate-heart:');
      expect(formatStickerShortcode('slop-machine:slop-bucket', packs)).toBe(
        ':slop-machine-slop-bucket:'
      );
      expect(formatStickerShortcode(':uchiage-daruma:', packs)).toBe(':uchiage-daruma:');
    });

    it('parses valid shortcodes and rejects non-shortcodes', () => {
      expect(parseStickerShortcode(':heart:')).toBe('heart');
      expect(parseStickerShortcode(':pixerate-heart:')).toBe('pixerate-heart');
      expect(parseStickerShortcode(':slop-machine-slop-bucket:')).toBe(
        'slop-machine-slop-bucket'
      );
      expect(parseStickerShortcode('heart')).toBeNull();
      expect(parseStickerShortcode('👍')).toBeNull();
      expect(parseStickerShortcode('::')).toBeNull();
    });
  });

  describe('extractStickerTokensFromText & extractStickerIdsFromHtml', () => {
    it('extracts single-pack and multi-pack shortcodes from plain text', () => {
      const text = 'Shipped it :party-popper:! Sending :pixerate-heart: and :slop-machine-slop-bucket:';
      expect(extractStickerTokensFromText(text)).toEqual([
        'party-popper',
        'pixerate-heart',
        'slop-machine-slop-bucket'
      ]);
    });

    it('ignores shortcodes inside inline code, fenced code blocks, URLs, and times', () => {
      const text = [
        'Real sticker :heart: here!',
        'Inline code `:fake-inline:` should be ignored.',
        '```ts\nconst x = ":fake-fenced:";\n```',
        'URL https://example.com:8080/test and time 12:30:45 or C::scope::name.'
      ].join('\n');

      expect(extractStickerTokensFromText(text)).toEqual(['heart']);
    });

    it('extracts sticker tokens from richContent HTML attributes and text while shielding <pre>/<code>', () => {
      const html =
        '<p>Great job <span data-type="sticker" data-sticker="heart"></span> and ' +
        '<span data-type="sticker" data-sticker-ref="slop-machine-slop-bucket"></span> ' +
        'plus inline :uchiage-daruma:!</p>' +
        '<pre><code><span data-type="sticker" data-sticker="ignored-pre"></span> :ignored-code:</code></pre>';

      expect(extractStickerIdsFromHtml(html)).toEqual([
        'heart',
        'slop-machine-slop-bucket',
        'uchiage-daruma'
      ]);
    });

    it('extractMessageStickers deduplicates across content and richContent', () => {
      const stickers = extractMessageStickers(
        'Hello :heart:!',
        '<p>Hello <span data-type="sticker" data-sticker="heart"></span> and <span data-sticker-id="daruma"></span>!</p>'
      );
      expect(stickers).toEqual(['heart', 'daruma']);
    });
  });

  describe('parseMessageStickerSegments', () => {
    it('splits message content into text and sticker segments while preserving code blocks', () => {
      const content = 'Awesome work :heart:! Run `:not-a-sticker:` then celebrate :party-popper:';
      const segments = parseMessageStickerSegments(content);

      expect(segments).toEqual([
        { type: 'text', value: 'Awesome work ' },
        { type: 'sticker', shortcode: ':heart:', id: 'heart' },
        { type: 'text', value: '! Run `:not-a-sticker:` then celebrate ' },
        { type: 'sticker', shortcode: ':party-popper:', id: 'party-popper' }
      ]);
    });
  });

  describe('resolveSticker & combineMessageStickerProviders', () => {
    it('resolves bare :id: shortcode against a single sticker provider', async () => {
      const resolved = await resolveSticker(pixeratePack, ':heart:', {
        variant: 'dark',
        colour: '#FF0055',
        includeDescription: true
      });

      expect(resolved).toBeDefined();
      expect(resolved?.id).toBe('heart');
      expect(resolved?.providerId).toBe('pixerate');
      expect(resolved?.shortcode).toBe(':heart:');
      expect(resolved?.ref).toBe('pixerate:heart');
      expect(resolved?.asset.kind === 'svg' && resolved.asset.svg).toContain('color="#ff0055"');
      expect(resolved?.asset.kind === 'svg' && resolved.asset.svg).toContain('data-variant="dark"');
      expect(resolved?.description?.name).toBe('Heart');
    });

    it('also accepts dash-prefixed or colon-prefixed ref against a single provider', async () => {
      const fromDash = await resolveSticker(pixeratePack, ':pixerate-heart:');
      const fromColon = await resolveSticker(pixeratePack, 'pixerate:heart');
      expect(fromDash?.id).toBe('heart');
      expect(fromDash?.shortcode).toBe(':heart:');
      expect(fromColon?.id).toBe('heart');
    });

    it('resolves dash-namespaced shortcodes across multiple sticker providers (including hyphenated pack ids)', async () => {
      const providers = [pixeratePack, slopMachinePack, uchiagePack];

      const heart = await resolveSticker(providers, ':pixerate-heart:');
      expect(heart?.providerId).toBe('pixerate');
      expect(heart?.id).toBe('heart');
      expect(heart?.shortcode).toBe(':pixerate-heart:');

      const bucket = await resolveSticker(providers, ':slop-machine-slop-bucket:');
      expect(bucket?.providerId).toBe('slop-machine');
      expect(bucket?.id).toBe('slop-bucket');
      expect(bucket?.shortcode).toBe(':slop-machine-slop-bucket:');

      const daruma = await resolveSticker(providers, ':uchiage-daruma:');
      expect(daruma?.providerId).toBe('uchiage');
      expect(daruma?.id).toBe('daruma');
      expect(daruma?.shortcode).toBe(':uchiage-daruma:');

      // Un-namespaced bare id is rejected when multiple providers are active
      expect(await resolveSticker(providers, ':heart:')).toBeUndefined();
    });

    it('resolves dash-namespaced shortcodes against a pre-combined colon-namespaced provider', async () => {
      // Simulate `@pixerate/editor/stickers` combineStickerProviders where load() expects `provider:id`
      const editorCombined: StickerProvider = {
        id: 'stickers',
        name: 'Combined',
        namespaced: true,
        capabilities: { supportsSearch: true, supportsSvg: true, supportsRaster: false },
        list: () => ({ items: [], total: 0 }),
        search: () => ({ items: [], total: 0 }),
        describe: async ref => {
          if (ref === 'slop-machine:slop-bucket') {
            return slopMachinePack.describe('slop-bucket');
          }
          return undefined;
        },
        load: async (ref, opts) => {
          if (ref === 'slop-machine:slop-bucket') {
            return slopMachinePack.load('slop-bucket', opts);
          }
          throw new Error(`Unknown ref ${ref}`);
        }
      };

      const resolved = await resolveSticker(editorCombined, ':slop-machine-slop-bucket:', {
        includeDescription: true
      });
      expect(resolved).toBeDefined();
      expect(resolved?.providerId).toBe('slop-machine');
      expect(resolved?.id).toBe('slop-bucket');
      expect(resolved?.ref).toBe('slop-machine:slop-bucket');
      expect(resolved?.shortcode).toBe(':slop-machine-slop-bucket:');
    });

    it('combineMessageStickerProviders pages, searches, and namespaces multiple sets', async () => {
      const combined = combineMessageStickerProviders([pixeratePack, slopMachinePack, uchiagePack]);
      expect(combined.namespaced).toBe(true);

      const page1 = await combined.list({ limit: 2 });
      expect(page1.total).toBe(5);
      expect(page1.items.map(i => i.id)).toEqual(['pixerate-heart', 'pixerate-party-popper']);
      expect(page1.next).toBeDefined();

      const page2 = await combined.list({ limit: 2, after: page1.next });
      expect(page2.items.map(i => i.id)).toEqual([
        'slop-machine-slop-bucket',
        'slop-machine-slop-heart'
      ]);

      const searchHearts = await combined.search('heart');
      expect(searchHearts.items.map(i => i.id)).toEqual([
        'pixerate-heart',
        'slop-machine-slop-heart'
      ]);
    });
  });

  describe('resolveMessageStickers & ConversationManager integration', () => {
    it('harvests inline stickers on postMessage and resolves both inline and reaction stickers', async () => {
      const driver = new MemoryConversationDriver();
      const manager = new ConversationManager({
        driver,
        stickerProvider: [pixeratePack, slopMachinePack]
      });

      const convo = await manager.createConversation({
        entity: { id: 'task_stickers', type: 'task' }
      });

      const msg = await manager.postMessage({
        conversationId: convo.id,
        author: { type: 'agent', id: 'agent_1', name: 'Art Agent' },
        content: 'All done :pixerate-party-popper:!'
      });

      expect(msg.stickers).toEqual(['pixerate-party-popper']);

      const withReaction = await manager.addStickerReaction(
        msg.id,
        'slop-machine-slop-heart',
        'user_alice',
        convo.id
      );
      expect(withReaction.reactions).toHaveLength(1);
      expect(withReaction.reactions[0]).toMatchObject({
        emoji: ':slop-machine-slop-heart:',
        sticker: 'slop-machine-slop-heart',
        userId: 'user_alice'
      });

      const resolvedMap = await resolveMessageStickers(
        [pixeratePack, slopMachinePack],
        withReaction
      );
      expect(resolvedMap.get(':pixerate-party-popper:')?.id).toBe('party-popper');
      expect(resolvedMap.get('slop-machine-slop-heart')?.id).toBe('slop-heart');
    });
  });

  describe('createMessageStickerTools (agent tools)', () => {
    it('returns bare :id: shortcodes for single pack and :pack-id: shortcodes for multiple packs', async () => {
      const [singleFind, singleDescribe] = createMessageStickerTools({
        provider: () => pixeratePack
      });

      const singleRes = (await singleFind.handler({ query: 'heart' })) as any;
      expect(singleRes.namespaced).toBe(false);
      expect(singleRes.items[0]).toMatchObject({
        id: 'heart',
        shortcode: ':heart:'
      });

      const descSingle = (await singleDescribe.handler({ sticker: ':heart:' })) as any;
      expect(descSingle).toMatchObject({
        id: 'heart',
        shortcode: ':heart:',
        ref: 'pixerate:heart'
      });

      const [multiFind, multiDescribe] = createMessageStickerTools({
        provider: () => [pixeratePack, slopMachinePack]
      });

      const multiRes = (await multiFind.handler({ query: 'bucket' })) as any;
      expect(multiRes.namespaced).toBe(true);
      expect(multiRes.items[0]).toMatchObject({
        id: 'slop-machine-slop-bucket',
        shortcode: ':slop-machine-slop-bucket:'
      });

      const descMulti = (await multiDescribe.handler({
        sticker: ':slop-machine-slop-bucket:'
      })) as any;
      expect(descMulti).toMatchObject({
        id: 'slop-machine-slop-bucket',
        shortcode: ':slop-machine-slop-bucket:',
        ref: 'slop-machine:slop-bucket'
      });
    });
  });
});

describe('sticker review fixes', () => {
  const sticker = (id: string) => ({ id, name: id, category: 'test', tags: [] });
  const packA = () => createMockStickerPack('pixerate', 'Pixerate', [sticker('heart')]);
  const packB = () => createMockStickerPack('slop-machine', 'Slop', [sticker('heart')]);

  it('reports the owning pack when resolving against a combined provider', async () => {
    const combined = combineMessageStickerProviders([packA(), packB()]);
    const resolved = await resolveSticker(combined, ':slop-machine-heart:');
    expect(resolved).toMatchObject({
      id: 'heart',
      providerId: 'slop-machine',
      ref: 'slop-machine:heart',
      shortcode: ':slop-machine-heart:'
    });
    expect((await resolveSticker(combined, resolved!.ref))?.providerId).toBe('slop-machine');
  });

  it('does not key multi-pack results by bare id', async () => {
    const map = await resolveMessageStickers([packA(), packB()], {
      content: ':pixerate-heart: :slop-machine-heart:'
    });
    expect(map.has('heart')).toBe(false);
    expect(map.get('pixerate:heart')?.providerId).toBe('pixerate');
    expect(map.get(':slop-machine-heart:')?.providerId).toBe('slop-machine');
  });

  it('keeps bare id keys for a single pack', async () => {
    const map = await resolveMessageStickers(packA(), { content: ':heart:' });
    expect(map.get('heart')?.ref).toBe('pixerate:heart');
  });

  it('loads raster-only providers without requesting svg', async () => {
    const formats: unknown[] = [];
    const base = packA();
    const raster: StickerProvider = {
      ...base,
      capabilities: { ...base.capabilities, supportsSvg: false, supportsRaster: true },
      load: async (_id, options) => {
        formats.push(options?.format);
        if (options?.format === 'svg') throw new Error('svg unsupported');
        return { kind: 'image', url: 'https://example.test/a.png', width: 1, height: 1 };
      }
    };
    expect((await resolveSticker(raster, ':heart:'))?.asset.kind).toBe('image');
    expect(
      (await resolveSticker(combineMessageStickerProviders([raster, packB()]), ':pixerate-heart:'))
        ?.asset.kind
    ).toBe('image');
    expect(formats).toEqual(['png', 'png']);
  });

  it('separates real failures from unknown stickers', async () => {
    const failure = new Error('network down');
    const unknown = Object.assign(new Error('nope'), { code: 'unknown_sticker' });
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);

    const broken: StickerProvider = {
      ...packA(),
      load: async () => {
        throw failure;
      }
    };
    expect(await resolveSticker(broken, ':heart:', { onError })).toBeUndefined();
    expect(errors).toEqual([failure]);

    const missing: StickerProvider = {
      ...packA(),
      load: async () => {
        throw unknown;
      }
    };
    expect(await resolveSticker(missing, ':heart:', { onError })).toBeUndefined();
    expect(errors).toEqual([failure]);

    const [, describeTool] = createMessageStickerTools({ provider: () => broken });
    await expect(describeTool.handler({ sticker: ':heart:' })).rejects.toThrow(
      'Could not load sticker'
    );
  });

  it('keeps the asset when the description fails', async () => {
    const provider: StickerProvider = {
      ...packA(),
      describe: async () => {
        throw new Error('metadata down');
      }
    };
    const resolved = await resolveSticker(provider, ':heart:', { includeDescription: true });
    expect(resolved?.asset).toBeDefined();
    expect(resolved?.description).toBeUndefined();
  });

  it('routes a prefixed collection filter to the owning pack only', async () => {
    const seen: Array<[string, string | undefined]> = [];
    const spy = (pack: StickerProvider): StickerProvider => ({
      ...pack,
      list: async options => {
        seen.push([pack.id, options?.collection]);
        return { items: [], total: 0 };
      }
    });
    const combined = combineMessageStickerProviders([spy(packA()), spy(packB())]);
    await combined.list({ collection: 'slop-machine-animals' });
    expect(new Set(seen.map(([id]) => id))).toEqual(new Set(['slop-machine']));
    expect(seen.every(([, collection]) => collection === 'animals')).toBe(true);
  });

  it('parses back-to-back shortcodes and still ignores false positives', () => {
    expect(extractStickerTokensFromText(':heart::star: and :moon:')).toEqual([
      'heart',
      'star',
      'moon'
    ]);
    expect(parseMessageStickerSegments('a :heart::star: b')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'sticker', shortcode: ':heart:', id: 'heart' },
      { type: 'sticker', shortcode: ':star:', id: 'star' },
      { type: 'text', value: ' b' }
    ]);
    expect(extractStickerTokensFromText('std::vector::size ::foo:: a:b:c :a::b')).toEqual([]);
  });

  it('collapses the two spellings of a sticker in a single pack', () => {
    expect(formatStickerShortcode('pixerate-heart', packA())).toBe(':heart:');
    expect(formatStickerShortcode('slop-machine-heart', packA())).toBe(':slop-machine-heart:');
  });

  it('removes only the targeted reaction when emoji and sticker share a display emoji', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });
    const convo = await manager.createConversation({
      id: 'c1',
      entity: { type: 'doc', id: 'd1' }
    } as any);
    const msg = await manager.postMessage({
      conversationId: convo.id,
      author: { id: 'u', name: 'U' },
      content: 'hi'
    } as any);
    await manager.addReaction(msg.id, '❤️', 'u', convo.id);
    await manager.addReaction(msg.id, { emoji: '❤️', sticker: 'heart' }, 'u', convo.id);
    const removed = await manager.removeReaction(
      msg.id,
      { emoji: '❤️', sticker: 'heart' },
      'u',
      convo.id
    );
    expect(removed.reactions.map(r => r.sticker)).toEqual([undefined]);
  });
});
