import { describe, it, expect } from 'vitest';
import { extractMentionIdsFromHtml, stripHtmlToPlainText } from '../core/mentionTokens.js';

describe('mentionTokens', () => {
  describe('extractMentionIdsFromHtml', () => {
    it('extracts unique data-id from standard mention spans', () => {
      const html = '<p>Hello <span data-type="mention" data-id="user-42">@Alice</span> and <span data-type="mention" data-id="user-99">@Bob</span>!</p>';
      const mentions = extractMentionIdsFromHtml(html);

      expect(mentions).toEqual(['user-42', 'user-99']);
    });

    it('handles spans with single quotes and data-mention-id', () => {
      const html = '<span class="mention" data-mention-id=\'team-core\'>@Team</span>';
      const mentions = extractMentionIdsFromHtml(html);

      expect(mentions).toEqual(['team-core']);
    });

    it('deduplicates mention IDs', () => {
      const html = '<span data-id="u1">@Jack</span> and later <span data-id="u1">@Jack</span>';
      const mentions = extractMentionIdsFromHtml(html);

      expect(mentions).toEqual(['u1']);
    });

    it('returns empty array when no mentions are present', () => {
      expect(extractMentionIdsFromHtml('<p>Just regular text</p>')).toEqual([]);
      expect(extractMentionIdsFromHtml('')).toEqual([]);
    });
  });

  describe('stripHtmlToPlainText', () => {
    it('strips tags while preserving text content', () => {
      const html = '<p>Hello <strong>World</strong>!</p>';
      expect(stripHtmlToPlainText(html)).toBe('Hello World !');
    });

    it('replaces common HTML entities and cleans spaces', () => {
      const html = '&amp; &lt; &gt; &quot; &#39; &nbsp;';
      expect(stripHtmlToPlainText(html)).toBe('& < > " \'');
    });

    it('handles multi-line text and collapses excessive spaces', () => {
      const html = '<p>Line 1</p>\n\n<p>Line   2</p>';
      expect(stripHtmlToPlainText(html)).toBe('Line 1 Line 2');
    });
  });
});
