/**
 * Caption tokenising. These cases mirror the server's tests in
 * songs/tests/test_post_features.py — if the two disagree, a tag the author
 * saw highlighted would silently fail to link (or vice versa).
 */
import { parseRichText, activeToken, applySuggestion } from '../richText';

const tokens = (text) => parseRichText(text).filter((s) => s.type !== 'text').map((s) => `${s.type}:${s.value}`);

describe('parseRichText', () => {
  it('finds hashtags like the server does', () => {
    expect(tokens('Praise #Sabbath and #sabbath, #Mungu_Mwema #2024 a#b ##x')).toEqual([
      'hashtag:sabbath', 'hashtag:sabbath', 'hashtag:mungu_mwema',
    ]);
  });

  it('finds mentions and drops trailing punctuation', () => {
    expect(tokens('thanks @john. and @Mary-Ann, email a@b.com')).toEqual([
      'mention:john', 'mention:Mary-Ann',
    ]);
  });

  it('keeps every character of the original text', () => {
    const text = 'Hi @amy! #Joy... see a@b.c #1';
    expect(parseRichText(text).map((s) => s.text).join('')).toBe(text);
  });

  it('handles non-Latin scripts', () => {
    expect(tokens('#café #ምስጋና')).toEqual(['hashtag:café', 'hashtag:ምስጋና']);
  });
});

describe('activeToken', () => {
  it('detects a tag or mention being typed', () => {
    expect(activeToken('hello #wor')).toEqual({ trigger: '#', query: 'wor', start: 6, end: 10 });
    expect(activeToken('hi @')).toEqual({ trigger: '@', query: '', start: 3, end: 4 });
  });

  it('ignores triggers glued to a word', () => {
    expect(activeToken('email a@b')).toBeNull();
    expect(activeToken('plain text')).toBeNull();
  });

  it('uses the cursor, not the end of the text', () => {
    const text = 'a #so and more';
    expect(activeToken(text, 5)).toMatchObject({ trigger: '#', query: 'so' });
  });
});

describe('applySuggestion', () => {
  it('replaces the token and places the cursor after a space', () => {
    const text = 'Sunday #wor';
    const out = applySuggestion(text, activeToken(text), 'worship');
    expect(out).toEqual({ text: 'Sunday #worship ', cursor: 16 });
  });

  it('works mid-text and swallows the rest of the word', () => {
    const text = 'hi @jo there';
    const out = applySuggestion(text, activeToken(text, 6), 'john');
    expect(out.text).toBe('hi @john there');
  });
});
