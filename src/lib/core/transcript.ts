import type { Conversation, ConversationStatus, Message, ThreadTreeNode } from '../types.js';
import { sortConversationsByAnchor } from './anchors.js';
import { ThreadTree } from './ThreadTree.js';

export interface TranscriptOptions {
  includeMetadata?: boolean;
  includeAnchorContext?: boolean;
  indentString?: string;
  maxDepth?: number;
}

export interface DocumentTranscriptThread {
  conversation: Conversation;
  messages: Message[];
}

export interface DocumentTranscriptOptions extends TranscriptOptions {
  title?: string;
  statusFilter?: ConversationStatus[];
  orphanedLast?: boolean;
}

function escapeSingleLine(text: string): string {
  return text.replace(/\n/g, '\\n');
}

function renderAnchorLines(
  conversation: Conversation,
  options: Pick<TranscriptOptions, 'includeAnchorContext'>
): string[] {
  const anchor = conversation.anchor;
  if (!anchor) return [];

  const lines: string[] = [];
  lines.push(`**Anchor**: ${anchor.start}..${anchor.end} (${anchor.state})`);
  lines.push(`**Quoted Text**: "${escapeSingleLine(anchor.quote.exact)}"`);
  if ((anchor.quote.prefix || anchor.quote.suffix) && options.includeAnchorContext !== false) {
    const prefix = escapeSingleLine(anchor.quote.prefix ?? '');
    const exact = escapeSingleLine(anchor.quote.exact);
    const suffix = escapeSingleLine(anchor.quote.suffix ?? '');
    lines.push(`**Anchor Context**: "${prefix}[${exact}]${suffix}"`);
  }
  return lines;
}

function renderMessageNodes(
  messages: Message[],
  options: TranscriptOptions,
  baseIndentLevel = 0
): string[] {
  const indent = options.indentString ?? '  ';
  const lines: string[] = [];
  const tree = ThreadTree.buildTree(messages);

  function renderNode(node: ThreadTreeNode) {
    if (options.maxDepth !== undefined && node.depth > options.maxDepth) {
      return;
    }

    const prefix = indent.repeat(baseIndentLevel + node.depth);
    const authorName = node.message.author.name || node.message.author.id;
    const authorRole = node.message.author.type ? ` (${node.message.author.type})` : '';
    const dateStr = new Date(node.message.createdAt).toISOString();

    lines.push(`${prefix}### ${authorName}${authorRole} - ${dateStr}`);

    const contentLines = node.message.content.split('\n');
    for (const line of contentLines) {
      lines.push(`${prefix}> ${line}`);
    }
    lines.push('');

    for (const child of node.children) {
      renderNode(child);
    }
  }

  for (const rootNode of tree) {
    renderNode(rootNode);
  }

  return lines;
}

export class ConversationTranscript {
  /**
   * Formats a conversation and its messages into clean Markdown for LLMs or export summaries.
   */
  public static formatAsMarkdown(
    conversation: Conversation,
    messages: Message[],
    options: TranscriptOptions = {}
  ): string {
    const lines: string[] = [];

    lines.push(`# Conversation: ${conversation.entity.title || conversation.entity.id}`);
    lines.push(`**Target**: ${conversation.entity.type} (${conversation.entity.id})`);
    lines.push(`**Status**: ${conversation.status}`);
    lines.push(`**Total Messages**: ${messages.length}`);
    lines.push(...renderAnchorLines(conversation, options));
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(...renderMessageNodes(messages, options));

    return lines.join('\n').trim();
  }

  /**
   * Formats multiple inline document comment threads in document anchor order for LLM/review context.
   */
  public static formatDocumentCommentsAsMarkdown(
    threads: DocumentTranscriptThread[],
    options: DocumentTranscriptOptions = {}
  ): string {
    const statusSet = options.statusFilter ? new Set(options.statusFilter) : null;
    const filtered = statusSet
      ? threads.filter(t => statusSet.has(t.conversation.status))
      : threads;

    const sortedConversations = sortConversationsByAnchor(
      filtered.map(t => t.conversation),
      { orphanedLast: options.orphanedLast }
    );
    const threadById = new Map(filtered.map(t => [t.conversation.id, t]));

    const firstEntity = sortedConversations[0]?.entity ?? threads[0]?.conversation.entity;
    const title = options.title || firstEntity?.title || firstEntity?.id || 'Document';

    const lines: string[] = [];
    lines.push(`# Document Comments: ${title}`);
    if (firstEntity) {
      lines.push(`**Target**: ${firstEntity.type} (${firstEntity.id})`);
    }
    lines.push(`**Threads**: ${sortedConversations.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const convo of sortedConversations) {
      const entry = threadById.get(convo.id)!;
      const anchorSummary = convo.anchor
        ? ` — ${convo.anchor.start}..${convo.anchor.end} (${convo.anchor.state})`
        : '';
      lines.push(`## [${convo.status}] Thread ${convo.id}${anchorSummary}`);
      lines.push(...renderAnchorLines(convo, options));
      lines.push('');
      lines.push(...renderMessageNodes(entry.messages, options));
    }

    return lines.join('\n').trim();
  }
}

export function formatThreadAsMarkdown(
  conversation: Conversation,
  messages: Message[],
  options?: TranscriptOptions
): string {
  return ConversationTranscript.formatAsMarkdown(conversation, messages, options);
}

export function formatDocumentThreadsAsMarkdown(
  threads: DocumentTranscriptThread[],
  options?: DocumentTranscriptOptions
): string {
  return ConversationTranscript.formatDocumentCommentsAsMarkdown(threads, options);
}
