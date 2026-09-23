import { pushRecent, mergePage, hasResults } from '../exploreLogic';

describe('pushRecent', () => {
  it('puts the newest first and drops case-only duplicates', () => {
    expect(pushRecent(['grace', 'sabbath'], 'Sabbath')).toEqual(['Sabbath', 'grace']);
  });
  it('trims, ignores tiny terms and caps the list', () => {
    expect(pushRecent(['a1'], '  hymn  ')).toEqual(['hymn', 'a1']);
    const list = ['x1'];
    expect(pushRecent(list, 'a')).toBe(list);
    expect(pushRecent(['b1', 'b2', 'b3'], 'new', 3)).toEqual(['new', 'b1', 'b2']);
  });
});

describe('mergePage', () => {
  it('appends only posts not already shown', () => {
    expect(mergePage([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(mergePage([{ id: 1 }], null)).toEqual([{ id: 1 }]);
  });
});

describe('hasResults', () => {
  it('is false for empty or missing answers', () => {
    expect(hasResults(null)).toBe(false);
    expect(hasResults({ users: [], posts: [] })).toBe(false);
    expect(hasResults({ hashtags: [{ tag: 'x' }] })).toBe(true);
  });
});

describe('hasResults with the music sections', () => {
  const { hasResults: has } = require('../exploreLogic');
  test('a top result alone, or any of the new sections, counts', () => {
    expect(has({ top: { kind: 'track', item: {} } })).toBe(true);
    for (const k of ['artists', 'albums', 'playlists', 'genres']) expect(has({ [k]: [{}] })).toBe(true);
    expect(has({ users: [], artists: [], top: null })).toBe(false);
  });
});
