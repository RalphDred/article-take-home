# Notes

<!-- Draft. Sections are filled in as the phases land. At most two pages in the end. -->

## How events reach the collector

_To do (Phase 10)._

## Loading state and the consent rule

_To do (Phases 2 and 9)._

## How the two page layouts share code

_To do (Phases 5 and 7)._

## Finding the end of the article text

_To do (Phase 8)._

## Part 3: saved copies

_To do (Phase 11, or a description if it is cut)._

## iOS and Android: what was verified

**Stack:** Expo SDK 57 in Expo Go (no custom native build), React Native 0.86.3, `react-native-webview` 13.16.1.
The app reaches the fixture server over Wi-Fi at the dev machine's LAN address. A Windows PC served both Metro and
the fixture server.

| Platform | Device | OS | How it ran |
| --- | --- | --- | --- |
| Android | Samsung Galaxy S24 Ultra (SM-S928B), physical | Android 16, One UI 8.5 (build `BP4A.251205.006.S928BXXS6DZI1`) | Expo Go over Wi-Fi |
| iOS | iPad | _not yet verified_ | Expo Go over Wi-Fi (planned) |

**Verified so far on Android:** `/front` renders in the web view. The status box shows `ready sent ×1`, and
`window.appContext` is set before the page's scripts run (`app context 1.0.0 · 1 · android · phone`).

**Not yet verified on iOS.** This changes when the iPad runs the app.

**Differences between the platforms:** _to do._

## What I left out, and known bugs

- The tracker SDK (`sdk/tracker.ts`) does not compile under `noUncheckedIndexedAccess`
  (`WEB_VIEW_COMMANDS[command]` is `EventKind | undefined`). It is used unchanged: it builds as its own TypeScript
  project (`sdk/tsconfig.json`), and the app type-checks against its emitted declarations, so the app keeps the
  stricter flags. Run the type check with `npm run typecheck` (`tsc -b`).

## Content process killed in the background

_To do._

## Where AI helped, and where it was corrected

_To do._
