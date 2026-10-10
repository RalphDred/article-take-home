import { createReadCounter } from '../readCounter';

describe('createReadCounter (README, "Reading": once each time an article screen is opened)', () => {
  it('counts the first end of text on a screen, and nothing after it, a refresh included', () => {
    const reads: string[] = [];
    const screen = createReadCounter(id => reads.push(id));

    expect(screen('2')).toBe(true);
    // The reader pulls to refresh: the new document reports the end of the text again.
    expect(screen('2')).toBe(false);
    expect(reads).toEqual(['2']);
  });

  it('counts again on a new screen for the same article', () => {
    const reads: string[] = [];

    createReadCounter(id => reads.push(id))('2');
    createReadCounter(id => reads.push(id))('2');

    expect(reads).toEqual(['2', '2']);
  });

  it('counts nothing for a screen that never reaches the end', () => {
    const reads: string[] = [];
    createReadCounter(id => reads.push(id));

    expect(reads).toEqual([]);
  });
});
