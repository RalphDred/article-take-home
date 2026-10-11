# Notes

Expo SDK 57 (Expo Go), React Native 0.86, `react-native-webview` 13.16, strict TypeScript, Zustand, Zod. Parts 1–3
built. Recordings in [video/](video/) (Android, then iPad; 2:58 together).

## How events reach the collector

App events (a screen view per document's `ready`, `article_read` once per article screen) and page messages go
through one pipeline (`src/tracking/tracking.ts`), SDK unchanged. **Before consent** nothing reaches the SDK, whose
callback drops web events while no tracker exists, so the app buffers app and web events, in order, the newest 500.
Only a consent *string* creates the tracker (not a failure, `null` or the timeout), then the buffer is flushed once.
**Deliberate deviation:** the SDK gets only the web tracker's commands (the page's original string), not every
message. The app must recognise them to buffer them, and its check (the SDK's own, minus prototype keys) stops a
`{"command":"toString"}` from blocking the SDK's queue.

## Loading state and the consent rule

Each web view has one state, `waitingForConsent → loading → ready | error` (a pure reducer in `loadState.ts`), a union
so "ready and failed" cannot be written. Only the app starts loads, so a `#hash` jump never shows a spinner. The first
`ready` per load counts. No `ready` within 15 s of foreground time, or a load error, shows the error state, which
retries by itself when the device is back online.

Consent is `asking → timedOut | failed | none | given(value)`; `failed` and `none` act alike but are logged apart. It
is asked at launch and on every return to the foreground. Pages wait while `asking`, at most 5 s; every load uses the
newest value, and a late answer still counts. A document loaded without a string reloads once when one arrives, after
which it has one, so "never again" needs no flag. A later `null` counts as withdrawn: later loads carry none.
**Why:** always waiting turns a hanging consent service into a blank app. Always loading at once gives nearly every
cold start an empty ad slot and then a reload. Five seconds covers most answers, so most pages load once with consent,
and the one reload hits a page the reader has barely started. A *changed* string waits: reloading mid-read costs more
than it gains.

## How the two page layouts share code

One `PageWebView` handles loading, the injected globals, parsing, link routing and app state: a snapshot on `ready`,
then one event per change, nothing on mount. Screens below stay mounted, so going back shows a change with no reload.
**Front page:** a native `ScrollView` (strip, web view, footer); the web view does not scroll and is as tall as
`height` says, and identical heights are skipped so a resize cannot loop. **Article:** a self-scrolling web view under
a translucent header, with `appInsets` set before the page starts. **Protocol gap:** the front page cannot scroll, so
an injected script reports a "Jump to" target's offset (`app:anchor`) and the app scrolls. Proposal: a
`{ type: 'scrollTo', top }` message.

## Finding the end of the article text

An injected script watches the bottom edge of the last `p` in `.articlecomponent.text`, the web team's own analytics
anchor; the ask box, related links and "More" are outside it. The article is read once that edge has been between the
header and the bottom inset, checked on scroll, resize and `ResizeObserver(body)` (late content, font size), with an
error logged if there is no such paragraph. On Android it lands within 50 ms of the page's own "end of text seen".
**Ask the web team for** an `{ type: 'endOfText' }` message, or a `data-article-text-end` marker.

## Part 3: saved copies (built)

`saved/` in the app's documents holds complete copies only, one folder each. A download fills its own folder in
`saved-tmp/`, writes the record (`.copy.json`) last, and one rename moves it into `saved/`. A failure, cancel or crash
leaves nothing there, and `saved-tmp/` is wiped at launch. **The truth is the file system:** a folder in `saved/` with
a valid record is saved, nothing else is. The Saved screen measures both folders on disk. A sixth save evicts the copy
saved longest ago. An update downloads as a new copy, and a banner offers "Show it".

## iOS and Android: what was verified

**Devices:** Galaxy S24 Ultra (Android 16, One UI 8.5) and iPad 5th generation (iPadOS 16.7.16), both in Expo Go over
Wi-Fi, plus a Pixel 8 emulator (Android 16). On both platforms I checked Parts 1–3 against every control-panel case (on
Android, the limit of five in unit tests only). **Differences:** Android's `injectedJavaScriptBeforeContentLoaded`
lost the race against the page's inline scripts (`at start: no`), so Android fetches the document and writes the
script first in `<head>`. Article pull to refresh is the web view's own on iOS, a wrapping scroll view on Android. The
iPad reports `tablet` and rotates (Expo Go ignores `orientation` there). **Fixed after device runs:** iPad link
previews, a light loading state in dark mode, and on the S24 at the largest font, Save pushed off the header.
**Assumed, not checked:** an iPhone. The iPad has no notch or home indicator, so a notched top inset, the bottom inset
and `deviceType: phone` were only exercised on Android, and no iOS newer than 16 ran.

## Content process killed in the background

Both screens rebuild their web view: a new load and `ready`, the app state sent again, the old scroll position. The
stack and app state are untouched. Killing the renderer on the emulator (no real device ever killed one) found a bug:
Android starts no renderer while the app is hidden, so the 15 s timeout ran out. It now counts foreground time only.
**What should happen:** the reader should not notice. Today the article returns a third of a screen off (a pixel
offset), loses the page's own state, and counts a second screen view. It should restore by position in the text, not
count a view, and get its state back from a page message the app keeps.

## Tests, and why these

Pure modules: the consent rule (fake timers), the message parser (untrusted input), the buffer, app state sent once,
a read once per screen, the double-opening teaser, and downloads against an in-memory disk with injected failures.
These rules are hard to see on screen and easy to break.

## What I left out, and known bugs

**SDK bugs (not fixed):** `command in WEB_VIEW_COMMANDS` lets `"toString"` through; the collector rejects the batch
and the SDK retries it forever, blocking all later events. Buffered events are timestamped at consent, and a tracker
cannot be removed, so it keeps sending after consent is withdrawn. **Left out:** stopping tracking on withdrawal,
exact scroll restoration, and the rebuild on iOS. **Time:** built on 10 October, verified on devices on 11 October.

## Where AI helped, and where it was corrected

Claude Code wrote most of the code, tests and notes from my answers to its plan, and ran the emulator checks. It was
corrected where platforms differ from their docs (`injectedJavaScriptBeforeContentLoaded`, `IntersectionObserver`), on
an eviction rule the README contradicts, and on calling the rebuild done untested.
