import { describe, expect, it } from 'vitest';
import {
  ConversationSchema,
  DocumentAnchorSchema,
  TextAnchorSchema,
  createTextAnchor,
  filterConversationsByEntity,
  reconcileConversationAnchors,
  reconcileTextAnchor,
  sortConversationsByAnchor,
  type Conversation
} from '../index.js';

function makeConversation(
  id: string,
  entityId: string,
  entityType: string,
  createdAt: string,
  anchor?: Conversation['anchor']
): Conversation {
  return {
    id,
    entity: { id: entityId, type: entityType },
    ...(anchor ? { anchor } : {}),
    status: 'open',
    participantIds: [],
    messageCount: 0,
    createdAt,
    updatedAt: createdAt
  };
}

describe('TextAnchorSchema & DocumentAnchorSchema', () => {
  it('validates ranges and defaults state to attached', () => {
    const parsed = TextAnchorSchema.parse({
      start: 4,
      end: 10,
      quote: { exact: 'anchor' }
    });
    expect(parsed.state).toBe('attached');
    expect(DocumentAnchorSchema).toBe(TextAnchorSchema);

    expect(() =>
      TextAnchorSchema.parse({
        start: 10,
        end: 4,
        quote: { exact: 'bad' }
      })
    ).toThrow('end offset must be greater than or equal to start offset');
  });

  it('parses ConversationSchema with and without optional anchor', () => {
    const withoutAnchor = ConversationSchema.parse({
      id: 'c1',
      entity: { id: 'doc_1', type: 'document' },
      createdAt: '2026-11-24T12:00:00.000Z',
      updatedAt: '2026-11-24T12:00:00.000Z'
    });
    expect(withoutAnchor.anchor).toBeUndefined();

    const withAnchor = ConversationSchema.parse({
      id: 'c2',
      entity: { id: 'doc_1', type: 'document' },
      anchor: {
        start: 0,
        end: 5,
        quote: { exact: 'Hello', suffix: ' world' }
      },
      createdAt: '2026-11-24T12:00:00.000Z',
      updatedAt: '2026-11-24T12:00:00.000Z'
    });
    expect(withAnchor.anchor?.state).toBe('attached');
  });
});

describe('createTextAnchor & reconcileTextAnchor', () => {
  it('captures prefix/suffix context and preserves reference when unchanged', () => {
    const doc = 'Before text, target phrase, after text.';
    const start = doc.indexOf('target phrase');
    const end = start + 'target phrase'.length;

    const anchor = createTextAnchor(doc, start, end, { contextChars: 12 });
    expect(anchor).toEqual({
      start,
      end,
      quote: {
        exact: 'target phrase',
        prefix: 'efore text, ',
        suffix: ', after text'
      },
      state: 'attached'
    });

    // Exact same document returns the identical object reference
    const unchanged = reconcileTextAnchor(anchor, doc);
    expect(unchanged).toBe(anchor);
  });

  it('throws RangeError on invalid offsets', () => {
    expect(() => createTextAnchor('abc', -1, 2)).toThrow(RangeError);
    expect(() => createTextAnchor('abc', 2, 1)).toThrow(RangeError);
    expect(() => createTextAnchor('abc', 0, 5)).toThrow(RangeError);
  });

  it('tracks shifted offsets when text is inserted or deleted before the anchor', () => {
    const doc = 'Alpha target phrase omega';
    const start = doc.indexOf('target phrase');
    const anchor = createTextAnchor(doc, start, start + 'target phrase'.length);

    const inserted = 'Preamble. ' + doc + ' Epilogue.';
    const shifted = reconcileTextAnchor(anchor, inserted);
    expect(shifted.state).toBe('attached');
    expect(inserted.slice(shifted.start, shifted.end)).toBe('target phrase');
    expect(shifted.start).toBe(start + 'Preamble. '.length);
  });

  it('disambiguates duplicate quotes using prefix and suffix context', () => {
    const doc = 'First block: review me carefully.\nSecond block: review me immediately.';
    const secondStart = doc.lastIndexOf('review me');
    const anchor = createTextAnchor(doc, secondStart, secondStart + 'review me'.length);

    const edited = 'Intro.\n' + doc.replace('carefully', 'today');
    const reconciled = reconcileTextAnchor(anchor, edited);
    expect(reconciled.state).toBe('attached');
    expect(edited.slice(reconciled.start, reconciled.end)).toBe('review me');
    expect(edited.slice(reconciled.start - 14, reconciled.start)).toBe('Second block: ');
  });

  it('handles UTF-16 multi-code-unit emoji identically to NSString / NSRange', () => {
    const doc = 'Hello 👋🏽 world 👨‍👩‍👧 anchor target end';
    const start = doc.indexOf('anchor target');
    const end = start + 'anchor target'.length;
    const anchor = createTextAnchor(doc, start, end);

    const edited = 'Prefix ' + doc;
    const reconciled = reconcileTextAnchor(anchor, edited);
    expect(reconciled.state).toBe('attached');
    expect(reconciled.start).toBe(start + 'Prefix '.length);
    expect(edited.slice(reconciled.start, reconciled.end)).toBe('anchor target');
  });

  it('guards short quotes (< 4 chars) from jumping far away without context overlap', () => {
    const doc = 'The word is ok here and nothing else.';
    const start = doc.indexOf('ok');
    const anchor = createTextAnchor(doc, start, start + 2);

    const edited = `Rewritten paragraph ${'x'.repeat(100)}[ok]!`;
    const reconciled = reconcileTextAnchor(anchor, edited);
    expect(reconciled.state).toBe('orphaned');
  });

  it('re-attaches across whitespace reflows (e.g. wrapped Markdown lines)', () => {
    const doc = 'Intro paragraph.\nSecond section: note this immediately.';
    const start = doc.indexOf('note this');
    const anchor = createTextAnchor(doc, start, start + 'note this'.length);

    const wrapped = 'Intro paragraph.\nSecond section: note\n  this immediately.';
    const reconciled = reconcileTextAnchor(anchor, wrapped);
    expect(reconciled.state).toBe('attached');
    expect(wrapped.slice(reconciled.start, reconciled.end)).toBe('note\n  this');
  });

  it('re-attaches via context-framed fuzzy match on minor typo edits inside selection', () => {
    const doc = 'Alpha Beta Gamma Delta targetPhrase Epsilon Zeta Eta Theta';
    const start = doc.indexOf('targetPhrase');
    const anchor = createTextAnchor(doc, start, start + 'targetPhrase'.length, {
      contextChars: 12
    });

    const edited = 'Alpha Beta Gamma Delta targetPhraze Epsilon Zeta Eta Theta';
    const reconciled = reconcileTextAnchor(anchor, edited);
    expect(reconciled.state).toBe('attached');
    expect(edited.slice(reconciled.start, reconciled.end)).toBe('targetPhraze');
    expect(reconciled.quote.exact).toBe('targetPhrase');
  });

  it('marks deleted text orphaned while preserving offsets/quote, and re-attaches on undo', () => {
    const doc = 'Alpha Beta targetPhrase Gamma Delta';
    const start = doc.indexOf('targetPhrase');
    const anchor = createTextAnchor(doc, start, start + 'targetPhrase'.length, {
      contextChars: 8
    });

    const deleted = 'Alpha Beta  Gamma Delta';
    const orphaned = reconcileTextAnchor(anchor, deleted);
    expect(orphaned.state).toBe('orphaned');
    expect(orphaned.start).toBe(start);
    expect(orphaned.quote.exact).toBe('targetPhrase');

    // Re-running on same deleted doc preserves orphaned reference
    expect(reconcileTextAnchor(orphaned, deleted)).toBe(orphaned);

    // Undo restores exact text and re-attaches
    const restored = reconcileTextAnchor(orphaned, doc);
    expect(restored.state).toBe('attached');
    expect(restored.start).toBe(start);
  });

  it('handles degenerate empty-quote caret anchors', () => {
    const doc = 'BeforeAfter';
    const anchor = createTextAnchor(doc, 6, 6, { contextChars: 6 });
    expect(anchor.quote.exact).toBe('');

    const shifted = 'Intro ' + doc;
    const reconciled = reconcileTextAnchor(anchor, shifted);
    expect(reconciled.state).toBe('attached');
    expect(reconciled.start).toBe(12);
    expect(reconciled.end).toBe(12);
  });
});

describe('reconcileConversationAnchors, filterConversationsByEntity & sortConversationsByAnchor', () => {
  it('preserves array reference when no conversation anchors change', () => {
    const doc = 'One two three four';
    const c1 = makeConversation(
      'c1',
      'doc_1',
      'document',
      '2026-11-24T10:00:00.000Z',
      createTextAnchor(doc, 4, 7)
    );
    const c2 = makeConversation('c2', 'doc_1', 'document', '2026-11-24T10:05:00.000Z');
    const list = [c1, c2];

    expect(reconcileConversationAnchors(list, doc)).toBe(list);

    const edited = 'Zero ' + doc;
    const updated = reconcileConversationAnchors(list, edited);
    expect(updated).not.toBe(list);
    expect(updated[0].anchor?.start).toBe(9);
    expect(updated[1]).toBe(c2);
  });

  it('filters by entity and sorts by anchor position with optional orphanedLast', () => {
    const cLate = makeConversation('c_late', 'doc_1', 'document', '2026-11-24T10:00:00.000Z', {
      start: 30,
      end: 40,
      quote: { exact: 'late' },
      state: 'attached'
    });
    const cOrphan = makeConversation('c_orphan', 'doc_1', 'document', '2026-11-24T10:01:00.000Z', {
      start: 5,
      end: 10,
      quote: { exact: 'gone' },
      state: 'orphaned'
    });
    const cEarly = makeConversation('c_early', 'doc_1', 'document', '2026-11-24T10:02:00.000Z', {
      start: 10,
      end: 20,
      quote: { exact: 'early' },
      state: 'attached'
    });
    const cUnanchored = makeConversation('c_general', 'doc_1', 'document', '2026-11-24T09:00:00.000Z');
    const cOtherType = makeConversation('c_task', 'doc_1', 'task', '2026-11-24T09:00:00.000Z');

    const docsOnly = filterConversationsByEntity(
      [cLate, cOrphan, cEarly, cUnanchored, cOtherType],
      'doc_1',
      'document'
    );
    expect(docsOnly.map(c => c.id)).toEqual(['c_late', 'c_orphan', 'c_early', 'c_general']);

    expect(sortConversationsByAnchor(docsOnly).map(c => c.id)).toEqual([
      'c_orphan',
      'c_early',
      'c_late',
      'c_general'
    ]);

    expect(sortConversationsByAnchor(docsOnly, { orphanedLast: true }).map(c => c.id)).toEqual([
      'c_early',
      'c_late',
      'c_orphan',
      'c_general'
    ]);
  });
});
