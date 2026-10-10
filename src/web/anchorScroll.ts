// Where the front page's native scroll view goes for an in-page anchor (README, "Links": the "Jump to" links put the
// section heading at the top of the visible area). The page cannot scroll itself, so it reports where the heading
// is (`app:anchor`, see `injected.ts`) and the app scrolls.

/** The front page's native layout, in points (one CSS pixel each: the page sets `width=device-width`). */
export type FrontLayout = {
  /** Where the web view starts inside the scroll view's content: below the Recently read strip. */
  pageTop: number;
  /** Everything the scroll view scrolls: strip, web view and footer. */
  contentHeight: number;
  /** The visible part of the scroll view. */
  viewportHeight: number;
};

/**
 * The scroll offset that puts an element `anchorTop` CSS pixels into the page at the top of the visible area. Never
 * past the end: a heading near the bottom (the front page's "Test pages") stops where the scroll view stops, instead of
 * leaving blank space below the footer on iOS.
 */
export function anchorScrollY(anchorTop: number, { pageTop, contentHeight, viewportHeight }: FrontLayout): number {
  const end = Math.max(0, contentHeight - viewportHeight);

  return Math.min(Math.max(0, pageTop + anchorTop), end);
}
