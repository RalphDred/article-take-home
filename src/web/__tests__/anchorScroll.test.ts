import { anchorScrollY } from '../anchorScroll';

describe('anchorScrollY', () => {
  const layout = { pageTop: 140, contentHeight: 4000, viewportHeight: 700 };

  it('puts the heading at the top of the visible area, below the strip', () => {
    expect(anchorScrollY(900, layout)).toBe(1040);
  });

  it('counts from the top of the scroll view when the strip is hidden', () => {
    expect(anchorScrollY(900, { ...layout, pageTop: 0 })).toBe(900);
  });

  it('stops at the end of the scroll view for a heading near the bottom', () => {
    expect(anchorScrollY(3800, layout)).toBe(3300);
  });

  it('stays at the top when everything fits on the screen', () => {
    expect(anchorScrollY(300, { pageTop: 0, contentHeight: 500, viewportHeight: 700 })).toBe(0);
  });
});
