import type { Conversation, Message, ThreadTreeNode } from '../types.js';
import { ThreadTree } from './ThreadTree.js';

export interface TranscriptOptions {
  includeMetadata?: boolean;
  indentString?: string;
  maxDepth?: number;
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
    const indent = options.indentString ?? '  ';
    const lines: string[] = [];

    lines.push(`# Conversation: ${conversation.entity.title || conversation.entity.id}`);
    lines.push(`**Target**: ${conversation.entity.type} (${conversation.entity.id})`);
    lines.push(`**Status**: ${conversation.status}`);
    lines.push(`**Total Messages**: ${messages.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    const tree = ThreadTree.buildTree(messages);

    function renderNode(node: ThreadTreeNode) {
      if (options.maxDepth !== undefined && node.depth > options.maxDepth) {
        return;
      }

      const prefix = indent.repeat(node.depth);
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

    return lines.join('\n').trim();
  }
}
