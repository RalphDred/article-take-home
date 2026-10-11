# Notes

Expo SDK 57 (Expo Go), React Native 0.86, `react-native-webview` 13.16, TypeScript, Zustand, Zod. Parts 1–3 built.

## How events reach the collector

App events (screen views, reads) and page messages share one pipeline (`src/tracking/tracking.ts`). **Before consent**
the SDK would drop web events, so the app buffers both kinds in order (the newest 500). Only a consent *string* creates
the tracker (not a failure, `null` or the timeout); the buffer is then flushed once. **Deliberate deviation:** only the
web tracker's commands reach the SDK, as the page's original strings, which keeps the `toString` bug below from blocking
its queue.

## Loading state and the consent rule

Each web view has one state (`waitingForConsent → loading → ready | error`, a pure reducer in `loadState.ts`), so "ready
and failed" cannot exist. Only the app starts loads, so `#hash` jumps show no spinner. No `ready` in 15 s of foreground
time, or a load error, shows the error state, which retries once back online.

Consent (`asking → timedOut | failed | none | given(value)`) is asked at launch and on each return to the foreground.
Pages wait for it at most 5 s; every load uses the newest value, and a late answer still counts. A document loaded
without a string reloads once when one arrives. **Why:** always waiting turns a hanging consent service into a blank
app; always loading at once gives nearly every cold start an empty ad slot, then a reload. Five seconds covers most
answers, so the reload is rare and hits a page barely started. A *changed* string waits: reloading mid-read costs more
than it gains.

## How the two page layouts share code

One `PageWebView` handles loading, injected globals, parsing, link routing and app state (a snapshot on `ready`, then
one event per change). Screens below stay mounted, so going back never reloads. **Front page:** a native `ScrollView`
holds the strip, a non-scrolling web view sized by `height` and the footer. **Article:** a self-scrolling web view under
a translucent header, with `appInsets` set before the page starts. **Protocol gap:** "Jump to" needs an injected script
to report offsets; a `scrollTo` message would do.

## Finding the end of the article text

An injected script watches the bottom edge of the last `p` in `.articlecomponent.text`, the web team's analytics anchor,
which excludes the ask box, related links and "More". The article is read once that edge has been between the header and
the bottom inset. **Ask the web team for** an `{ type: 'endOfText' }` message or a `data-article-text-end` marker.

## Part 3: saved copies (built)

`saved/` in the app's documents holds only complete copies, one per folder. A download fills its own folder in
`saved-tmp/`, writes its record (`.copy.json`) last, and one rename moves it to `saved/`. A failure, cancel or crash
leaves nothing there, and `saved-tmp/` is wiped at launch. **The truth is the file system:** a `saved/` folder with a
valid record is saved, nothing else. Updates download as a new copy; a banner offers "Show it".

## iOS and Android: what was verified

**Devices:** Galaxy S24 Ultra (Android 16) and iPad 5th gen (iPadOS 16.7.16) in Expo Go, plus a Pixel 8 emulator
(Android 16). Parts 1–3 passed every control-panel case on both (Android's five-copy limit only in unit tests).
**Differences:** Android's `injectedJavaScriptBeforeContentLoaded` ran after the page's inline scripts, so the app
fetches the page and puts the script first in `<head>`. Article pull to refresh is the web view's own on iOS, a wrapping
scroll view on Android. **Fixed after device runs:** iPad link previews, the loading state's theme, and Save pushed off
the header at the S24's largest font. **Assumed, not checked:** an iPhone; notched and bottom insets and
`deviceType: phone` ran only on Android.

## Content process killed in the background

Both screens reload their web view and resend app state; the navigation stack is untouched. Killing the renderer on the
emulator found a bug: Android starts no renderer while the app is hidden, so the 15 s timeout ran out; it now counts
foreground time only. **What should happen:** nothing visible. Today the article returns a third of a screen off and
counts a second screen view; it should restore by position in the text and not count one.

## Tests, and why these

Pure modules: the consent rule, the message parser (untrusted input), the buffer, app state sent once, one read per
screen, the double-opening teaser, and downloads against an in-memory disk with injected failures. These rules are hard
to see on screen and easy to break.

## What I left out, and known bugs

**SDK bugs (not fixed):** `command in WEB_VIEW_COMMANDS` lets `"toString"` through; the collector rejects it and the SDK
retries forever, blocking later events. Buffered events are timestamped at consent, and a tracker cannot be removed
after consent is withdrawn. **Fixture quirk:** the server shows unlabelled UTC times and the status box local time, so
on a UTC+2 device the same "end of text seen" is two hours apart. **Left out:** stopping tracking on withdrawal, exact
scroll restoration, and the rebuild on iOS.

## Where AI helped, and where it was corrected

I used Claude Code for speed: it wrote most of the code, tests and notes, while I made the decisions and corrected its
plan often. It planned to test only on my phone and iPad; I had it use an Android emulator first, which it could drive
itself so each check took minutes, with the devices as an extra pass that caught what the emulator missed. It was also
corrected where platforms differ from their docs (the injection race, `IntersectionObserver`), on an eviction rule the
README contradicts, and for calling the rebuild done untested.
