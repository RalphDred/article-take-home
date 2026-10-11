# iOS test checklist

iOS has never run (NOTES.md: "iOS is not verified"). Work top to bottom: section 1 covers code that has **only** an
iOS path and has never executed. The rest repeats the Android pass. Write down anything that differs from Android,
because NOTES.md asks for it.

Keep the control panel open on the PC: **http://localhost:8787/control**. Press **Reset** between sections unless a
step says otherwise.

## 0. Setup

- [ ] Fixture server running (`node fixture/server.mjs`, port 8787).
- [ ] Metro running with the Wi-Fi address pinned:
      `REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.24 npx expo start` (this PC also has a 26.x VPN address an iPhone
      cannot reach).
- [ ] iPhone on the same Wi-Fi. Expo Go for **SDK 57** installed.
- [ ] Open `exp://192.168.1.24:8081` (Camera app on the QR code, or Expo Go, then "Enter URL manually").
- [ ] Allow Expo Go's **Local Network** prompt. If it was denied before: Settings → Expo Go → Local Network.
- [ ] Windows firewall allows Node on private networks (otherwise the bundle loads but port 8787 does not).
- [ ] Note the device model and iOS version: ____________________

## 1. iOS-only paths (never run)

**Globals at document start.** iOS uses `injectedJavaScriptBeforeContentLoaded` as is. Android writes the script into
the HTML instead.
- [ ] Article status box: the insets line shows **`at start: yes`**.
- [ ] The status box on both pages shows `appContext` with `os: ios` and `deviceType: phone`.
- [ ] When an article opens, its title sits just below the header on the first paint, with no jump.
- [ ] Control panel events show platform `ios` and carry the app context. That includes the **first** page view
      after consent.

**Pull to refresh** uses the web view's own refresh control on the article and a `RefreshControl` on the front page.
- [ ] Article: pull down at the top. The native loading state appears and the page reloads. The status box resets.
      The control panel gets one new screen view.
- [ ] Article: pulling down in the middle of the text only scrolls. It does not reload.
- [ ] The refresh spinner shows below the translucent header, not behind it.
- [ ] Front page: pull down. It reloads and shows the loading state again.
- [ ] After a refresh, the reloaded URL still has `#consent=…` (check it in the status box).

**Saved copies from `file://`** (`allowingReadAccessToURL`).
- [ ] Save an article, then open it. The status box shows `saved copy` and **every** photo and the map load.
- [ ] Set the server to Unreachable. The saved copy still opens with every image.

**Web content process killed** (`onContentProcessDidTerminate`). Hard to force on a phone, so this is optional.
- [ ] Open an article, scroll halfway, then background the app and open several heavy apps or games. Come back.
      Expected: the page reloads by itself (loading state, then the page). It does not stay blank and does not end
      on the error state. Write down what actually happened.

## 2. Front page screen

- [ ] Opens on the front page with a native loading state, then the page.
- [ ] Only the native scroll view scrolls. The web view never scrolls by itself, and there is no inner bounce or
      double scroll.
- [ ] The footer sits directly below the end of the page, with no gap and no clipping. Change the font size on an
      article, go back, and check again (the height changes).
- [ ] "Recently read" is hidden on a fresh install. After you read articles it lists up to five, the most recent
      first.
- [ ] "Jump to" links scroll the native view so that the section heading is at the top of the visible area, not
      under the header or the notch.
- [ ] Tapping a "Jump to" link does not show the loading state.
- [ ] The header's Saved button works, including while the front page shows its error state.

## 3. Article screen

- [ ] Opening a teaser pushes the article. The status box shows any query string (for example `?ref=…`).
- [ ] Header: back, font −/+, light/dark, star and save are all tappable. The page scrolls underneath the
      translucent header.
- [ ] The safe areas are right: nothing sits under the Dynamic Island or notch, and at the end the last line scrolls
      clear of the home indicator.
- [ ] Contents links and the "Jump" button put the heading **just below the header**.
- [ ] Links to other articles (related, "More from the newsroom") push a new article screen.
- [ ] External links open in Safari **once**. The web view stays on its page. Test a `target="_blank"` link too:
      iOS used to ask twice.
- [ ] Long-press a link: no link preview that navigates inside the web view.
- [ ] The **iOS edge swipe back** works, and the screen below does not reload: no spinner, and its status box counts
      stay the same.

## 4. App state

- [ ] Font −/+ applies on the article. Go back: the front page already shows it.
- [ ] Light/dark: the same on both pages. The native UI (header, strip, footer) matches.
- [ ] Each change reaches the page **once**: the status box counter goes up by exactly 1.
- [ ] Star in the header and star in the page: tapping either toggles it, and both agree. The front page marks
      the teaser.
- [ ] Kill the app (swipe it away in the app switcher) and relaunch. Font, theme, bookmarks and read articles
      survive.
- [ ] Also check the system appearance (Settings → Display → Dark). The pages follow the app's theme, not the
      system's.

## 5. Reading

- [ ] Scroll slowly to the end of the text. The read event fires when the last line is visible above the bottom
      edge. Compare it with "end of text" in the control panel: it should land within a moment of it.
- [ ] Scroll quickly with a fling. iOS momentum scrolling must still trigger the read (scroll events during
      deceleration).
- [ ] It does not fire when you stop just short of the last line, or when the last line is under the header.
- [ ] Only one read per screen, even after scrolling up and down again, and after pull to refresh.
- [ ] Go back and open the same article again, then read it: a second read event.
- [ ] The front page shows the article as read, and it is in "Recently read".
- [ ] At a larger font size the end of the text moves, and the read still fires at the real end.
- [ ] A saved copy also produces a read event.

## 6. Loading and errors

Use the control panel's network and consent modes.
- [ ] **Slow**: the loading state shows until the page is ready, never a half-loaded page.
- [ ] **Unreachable**, then launch or pull to refresh. It ends on the error state with Retry, not on a spinner.
- [ ] Back to **Normal**, then tap Retry. It loads.
- [ ] **Back online by itself**: with the error state showing, switch the iPhone's Wi-Fi off and on (or use airplane
      mode). It retries without a tap. Note: turning off Wi-Fi also disconnects Metro. The JS keeps running, but
      Expo Go may show a "disconnected" banner.
- [ ] **Ready timeout counts foreground time only**: start a load on Slow and background the app straight away.
      Wait more than 15 s and come back. It does not jump to the error state because of time spent in the
      background.

## 7. Consent and tracking

- [ ] Consent **given**: pages wait for it, and the ad slot fills.
- [ ] Consent **hang**: pages load after about 5 s without consent, and the ad slot is empty. Switch to **given**,
      then background and foreground the app (it asks again). The open page **reloads once** and the ad appears.
      Keep this for the recording.
- [ ] Consent **none** or **error**: nothing reaches the collector. Switch to **given** and foreground the app. The
      buffered events arrive, in order, with no "before the reader had chosen" warnings.
- [ ] **Change consent** while a page is open: no reload. The next load (pull to refresh) carries the new string.
- [ ] One screen view per loaded document, `{ name: 'front' }` or `{ name: 'article', id }`. A reload is a new one.
      Going back is not.
- [ ] The control panel flags **no** broken rules for the iOS events.

## 8. Saved articles (part 3)

- [ ] Save on **Slow**: the control shows that it is saving and lets you cancel. Cancel. The Saved screen's file
      count and bytes are back to where they were.
- [ ] Tap save twice quickly: only one download.
- [ ] Save two different articles at the same time: both finish.
- [ ] Fault **cut-always**: it retries, then tells you it failed, and leaves no files behind (check the Saved
      screen's file count).
- [ ] Save six: the oldest is evicted.
- [ ] Kill the app mid-download and relaunch. The article shows as not saved, and the file count has no leftovers.
- [ ] **Publish** a new version of a saved article, then open it while online. The new version downloads in the
      background, and a banner offers "Show it". The page does not change until you tap it.
- [ ] Publish, then make the update fail (cut-always). The old copy stays readable.
- [ ] Unreachable: the front page ends on its error state, the Saved screen still lists the articles, and they open.
- [ ] Saved screen: version, size and saved time are shown. Delete one, delete all, and cancel an active download.
      The file and byte totals change each time you open the screen.

## 9. Lifecycle

- [ ] Background and foreground the app: consent is asked again (the server logs `/consent`).
- [ ] Rotate the phone: the app stays in portrait.
- [ ] If you have an iPad, a quick look: `deviceType` should be `tablet`.

## 10. Recording (iOS part)

Screen Recording from Control Center works. The second platform "can be short", but iOS may be the main one.
- [ ] An article read to the end, then shown as read on the front page.
- [ ] A page loaded without consent (hang), then getting its ad once consent arrives.
- [ ] Dark mode reaching both pages.
- [ ] Saving an article, then reading it while the server is Unreachable.

## Afterwards: update NOTES.md

- [ ] Fill in the iOS row of the device table (model, iOS version, Expo Go).
- [ ] Replace "iOS is not verified" with what you checked.
- [ ] List every iOS/Android difference you saw (`at start`, pull to refresh, swipe back, read timing compared with
      Android's ~50 ms, external links).
- [ ] Remove "iOS verification" from "What I left out", or say which parts are still unchecked.
