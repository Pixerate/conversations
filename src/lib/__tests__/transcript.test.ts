import { describe, it, expect } from 'vitest';
import {
  ConversationTranscript,
  formatDocumentThreadsAsMarkdown
} from '../core/transcript.js';
import type { Conversation, Message } from '../types.js';

describe('ConversationTranscript', () => {
  const mockConversation: Conversation = {
    id: 'c1',
    entity: { id: 'card-1', type: 'card', title: 'Design Review' },
    status: 'open',
    messageCount: 3,
    participantIds: ['u1', 'u2', 'bot-1'],
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:10:00.000Z'
  };

  const d1 = '2026-10-25T10:00:00.000Z';
  const d2 = '2026-10-25T10:05:00.000Z';
  const d3 = '2026-10-25T10:10:00.000Z';

  const messages: Message[] = [
    {
      id: 'm1',
      status: 'sent',
      conversationId: 'c1',
      parentId: null,
      author: { type: 'user', id: 'u1', name: 'Alice' },
      content: 'Top level proposal',
      mentions: [],
      attachments: [],
      reactions: [],
      createdAt: d1,
      updatedAt: d1
    },
    {
      id: 'm2',
      status: 'sent',
      conversationId: 'c1',
      parentId: 'm1',
      author: { type: 'user', id: 'u2', name: 'Bob' },
      content: 'Looks solid, @Alice.',
      mentions: ['u1'],
      attachments: [],
      reactions: [],
      createdAt: d2,
      updatedAt: d2
    },
    {
      id: 'm3',
      status: 'sent',
      conversationId: 'c1',
      parentId: 'm2',
      author: { type: 'agent', id: 'bot-1', name: 'Pixerate AI' },
      content: 'Automated check: passes validation.',
      mentions: [],
      attachments: [],
      reactions: [],
      createdAt: d3,
      updatedAt: d3
    }
  ];

  it('renders a formatted transcript with markdown indentations and metadata', () => {
    const transcript = ConversationTranscript.formatAsMarkdown(mockConversation, messages);

    expect(transcript).toContain('# Conversation: Design Review');
    expect(transcript).toContain('**Target**: card (card-1)');
    expect(transcript).toContain('### Alice (user)');
    expect(transcript).toContain('> Top level proposal');
    expect(transcript).toContain('  ### Bob (user)');
    expect(transcript).toContain('  > Looks solid, @Alice.');
    expect(transcript).toContain('    ### Pixerate AI (agent)');
    expect(transcript).toContain('    > Automated check: passes validation.');
  });

  it('respects maxDepth option', () => {
    const transcript = ConversationTranscript.formatAsMarkdown(mockConversation, messages, {
      maxDepth: 1
    });

    expect(transcript).toContain('### Alice');
    expect(transcript).toContain('### Bob');
    expect(transcript).not.toContain('Pixerate AI');
  });

  it('handles empty message list cleanly', () => {
    const transcript = ConversationTranscript.formatAsMarkdown(
      { ...mockConversation, messageCount: 0 },
      []
    );
    expect(transcript).toContain('**Total Messages**: 0');
  });

  it('includes anchor quote and context in single-thread markdown transcripts', () => {
    const anchoredConvo: Conversation = {
      ...mockConversation,
      entity: { id: 'doc-1', type: 'document', title: 'Architecture Spec' },
      anchor: {
        start: 10,
        end: 20,
        quote: {
          exact: 'rate limit',
          prefix: 'enforce ',
          suffix: ' per user'
        },
        state: 'attached'
      }
    };

    const transcript = ConversationTranscript.formatAsMarkdown(anchoredConvo, [messages[0]]);
    expect(transcript).toContain('**Anchor**: 10..20 (attached)');
    expect(transcript).toContain('**Quoted Text**: "rate limit"');
    expect(transcript).toContain('**Anchor Context**: "enforce [rate limit] per user"');

    const withoutContext = ConversationTranscript.formatAsMarkdown(anchoredConvo, [messages[0]], {
      includeAnchorContext: false
    });
    expect(withoutContext).not.toContain('**Anchor Context**');
  });

  it('formats document threads sorted by anchor with status filtering', () => {
    const openConvo: Conversation = {
      ...mockConversation,
      id: 'c_open',
      entity: { id: 'doc-1', type: 'document', title: 'Architecture Spec' },
      anchor: {
        start: 20,
        end: 30,
        quote: { exact: 'second spot' },
        state: 'attached'
      },
      status: 'open'
    };
    const resolvedConvo: Conversation = {
      ...mockConversation,
      id: 'c_resolved',
      entity: { id: 'doc-1', type: 'document', title: 'Architecture Spec' },
      anchor: {
        start: 2,
        end: 8,
        quote: { exact: 'first' },
        state: 'attached'
      },
      status: 'resolved'
    };
    const orphanedOpen: Conversation = {
      ...mockConversation,
      id: 'c_orphan',
      entity: { id: 'doc-1', type: 'document', title: 'Architecture Spec' },
      anchor: {
        start: 5,
        end: 9,
        quote: { exact: 'gone' },
        state: 'orphaned'
      },
      status: 'open'
    };

    const openOnly = formatDocumentThreadsAsMarkdown(
      [
        { conversation: openConvo, messages: [messages[0]] },
        { conversation: resolvedConvo, messages: [messages[1]] },
        { conversation: orphanedOpen, messages: [messages[2]] }
      ],
      { statusFilter: ['open'], orphanedLast: true }
    );

    expect(openOnly).toContain('# Document Comments: Architecture Spec');
    expect(openOnly).toContain('**Threads**: 2');
    expect(openOnly).not.toContain('c_resolved');
    expect(openOnly.indexOf('c_open')).toBeLessThan(openOnly.indexOf('c_orphan'));
  });
});
