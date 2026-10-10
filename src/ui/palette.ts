import type { Theme } from '../web/protocol';

/** The native parts of a screen follow the app's theme, in the pages' own colours, so page and app read as one. */
export type Palette = {
  background: string;
  text: string;
  muted: string;
  rule: string;
  tint: string;
};

// The values of `body` and `body.dark` in the web team's pages.
const PALETTES: Record<Theme, Palette> = {
  light: {
    background: '#ffffff',
    text: 'rgb(18, 18, 18)',
    muted: 'rgba(5, 5, 5, 0.57)',
    rule: 'rgb(222, 222, 222)',
    tint: 'rgb(245, 245, 245)',
  },
  dark: {
    background: '#000000',
    text: 'rgb(245, 245, 245)',
    muted: 'rgba(255, 255, 255, 0.57)',
    rule: 'rgba(250, 250, 250, 0.21)',
    tint: 'rgba(250, 250, 250, 0.09)',
  },
};

export const paletteOf = (theme: Theme): Palette => PALETTES[theme];
