/**
 * The most a native header label grows with the system font size. The header bar has a fixed height (the page
 * reserves it before it starts), so its labels cannot grow without limit like the text below them.
 */
export const HEADER_MAX_FONT_SCALE = 1.3;

/** Narrower than this (in dp), the article header shows only "‹" for Back, so its controls stay on screen. */
export const COMPACT_HEADER_WIDTH = 360;
