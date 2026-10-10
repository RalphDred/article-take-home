import { MAX_PAGE_HEIGHT, nextPageHeight } from '../pageHeight';

describe('nextPageHeight', () => {
  it('applies every real change, small ones included', () => {
    expect(nextPageHeight(null, 2400)).toBe(2400);
    expect(nextPageHeight(2400, 2401)).toBe(2401);
    expect(nextPageHeight(2400, 1800)).toBe(1800);
  });

  it('skips the height already applied, so a resize cannot loop', () => {
    expect(nextPageHeight(2400, 2400)).toBeNull();
  });

  it('rounds up, so the last line is never cut off', () => {
    expect(nextPageHeight(null, 2400.2)).toBe(2401);
    expect(nextPageHeight(2401, 2400.2)).toBeNull();
  });

  it('caps a page that keeps growing, once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(nextPageHeight(2400, 80_000)).toBe(MAX_PAGE_HEIGHT);
    expect(nextPageHeight(MAX_PAGE_HEIGHT, 90_000)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it('keeps the previous height when the page reports zero', () => {
    expect(nextPageHeight(2400, 0)).toBeNull();
  });
});
