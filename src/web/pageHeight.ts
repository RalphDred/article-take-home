// How tall the front page's web view is (README, "Front page screen"; PLAN Q4).
//
// The page reports the height of its content with `height` messages, and the web view is made exactly that tall so
// the native scroll view does all the scrolling. A resize can never feed back into itself: an identical height is
// skipped, so a page that posts its height again after the resize changes nothing. The cap is a safety net for a
// page that grows with its own viewport (`vh` units, a `100%`-tall body); it is far above any real front page.

/** No front page is anywhere near this tall. A page that reports more is growing with its own web view. */
export const MAX_PAGE_HEIGHT = 50_000;

/**
 * The web view height for a reported content height, or null when nothing should change: the same height as now,
 * or a height of zero (an empty page would hide the whole front page; the previous height stays).
 */
export function nextPageHeight(current: number | null, reported: number): number | null {
  const height = Math.min(Math.ceil(reported), MAX_PAGE_HEIGHT);
  if (height <= 0 || height === current) return null;

  if (height === MAX_PAGE_HEIGHT && reported > MAX_PAGE_HEIGHT) {
    console.warn(`[front] the page reported ${reported} px, capped at ${MAX_PAGE_HEIGHT}. Is it sized by its viewport?`);
  }

  return height;
}
