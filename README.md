# Running the app

The app is in Expo (SDK 57) and runs in Expo Go, with no native build. Design notes are in [NOTES.md](NOTES.md), and
the screen recordings in [video/](video/): [Android](video/Android-recording.mp4) and [iPad](video/Ipad_recording.mp4).

You need Node 18 or newer, and Expo Go for SDK 57 on the device or emulator. If the store version of Expo Go has
moved on to a later SDK, install the SDK 57 build from https://expo.dev/go.

```sh
npm install
node fixture/server.mjs     # port 8787; open http://localhost:8787/control in a desktop browser
npx expo start              # in a second terminal
```

Then open the project in Expo Go. On a phone, scan the QR code that `expo start` prints (the phone must be on the same
Wi-Fi). On an Android emulator, press `a`. The app looks for the fixture server on port 8787 of the machine Metro
runs on, so nothing needs configuring. On Windows, allow Node through the firewall on private networks, or a phone
cannot reach port 8787. If the computer has more than one network address (a VPN, say) and the QR code points at one
the phone cannot reach, start Metro with `REACT_NATIVE_PACKAGER_HOSTNAME=<Wi-Fi address> npx expo start`. To use
another server, start Metro with `EXPO_PUBLIC_SERVER_URL=http://<host>:8787 npx expo start`.

```sh
npm test                    # Jest, pure modules
npm run typecheck           # tsc -b: the app, plus the vendor SDK as its own project
```

---

# Take-home: reading the news in the app

**Effort:** two working days. Please do not spend more than that; if you run out of time, tell us what you left out. You have until the date in your invitation, so spread the work however suits you.

**Tools:** use whatever you normally use, AI assistants included.

## The situation

You work on the NZZ app team. The front page and the articles are web pages that another team owns. The app shows them inside native UI, and the two sides talk over a small message protocol. Readers can also save articles and read them later without a connection.

The web team deploys its pages on its own schedule, and every installed version of the app loads the same pages.

The articles in this kit are real, free NZZ articles, frozen on 7 October 2026 and shortened. Their photos load from the NZZ image CDN.

## What you get

- `fixture/front.html` and `fixture/article.html` are the web team's pages. Treat them as code you cannot change.
- `sdk/tracker.ts` is the tracker SDK the newsroom uses (see part 2). Treat it as vendor code you cannot change.
- `fixture/server.mjs` serves the pages, the saved-copy downloads, the reader's consent and the tracker's collector. Run `node fixture/server.mjs` (Node 18 or newer, nothing to install). It prints the addresses to use and logs every request.
- A control panel at `/control` on the same server, for a desktop browser. It makes the server slow or unreachable, breaks downloads, decides what the consent service answers, publishes new versions of articles, and lists every tracking event that arrives.
- The protocol and the server's endpoints, described at the end of this file.

Each page has a **Page status** box. It shows where the page was loaded from, what it has received from the app, and how many times. Use it while you work. We will use it when we review.

If you think a page or the server has a bug, do not fix it. Tell us in NOTES.md.

## What to build

We expect a React Native app in TypeScript using `react-native-webview`, since that is what our app is written in. Bare React Native or Expo, and any other libraries, are your choice. If you work mainly in Flutter, a Flutter app is accepted as an alternative; tell us in NOTES.md why you chose it. Either way, it must work on both iOS and Android. Tell us which devices or simulators and OS versions you ran it on, and what behaved differently between the two.

Parts 1 and 2 are required. Part 3 is optional: build it if you have time, or describe in NOTES.md how you would. If you run short of time, finish what you have properly and tell us what you left out, rather than starting everything.

### Part 1: The front page and the article

The two pages are laid out differently in the app.

**Front page screen.** The app opens on it (`/front`). It is a single native vertical scroll view containing, from top to bottom:

1. A native "Recently read" strip: up to five articles the reader has read, the most recent first. Hidden while nothing has been read.
2. The front page, exactly as tall as its content. The page must not scroll by itself. The native scroll view does the scrolling.
3. A native footer (any content), sitting directly below the end of the page.

A native header above the scroll view has a button to the Saved screen, if you build part 3. It stays usable while the front page is on its error state. Pulling down on the scroll view reloads the front page.

**Article screen.** Opening an article pushes it on the navigation stack.

1. The article page fills the screen and scrolls itself.
2. A native header floats over the top of the page with a back button, font size − and + buttons, a light/dark switch, a bookmark star, and the save control if you build part 3. The page scrolls underneath it, and it may be translucent.
3. When the article opens, its title sits just below the header. At the end, the last line can be scrolled clear of the bottom edge of the screen.

Pulling down at the top of the article reloads it.

**Loading.** These rules apply to both pages.

- Show a native loading state until the page is ready to be read, then show the page.
- Navigation inside a page is not a load. Do not show the loading state for it.
- A reload is a load. Show the loading state again.
- If a page never becomes ready, the reader ends up on an error state with a way to retry, not on a spinner.
- A page that cannot be loaded because the server is unreachable ends on the same error state. When the device is back online, it retries by itself.

**App state on the pages.** Font scale, theme, the bookmarked articles and the read articles belong to the app. They apply to both pages and survive an app restart.

- Once a page is ready it shows the current values.
- Each later change reaches the page once. The status box counts.
- Change a setting on one screen and go back: the screen below already shows it. Going back never reloads the screen below.
- On an article, the bookmark star exists twice, once in the native header and once in the page. Tapping either one toggles the bookmark, and both always agree. The front page marks bookmarked teasers.
- The front page shows read teasers differently, and the Recently read strip lists them (see *Reading*).

**Reading.** The newsroom wants to know when an article has actually been read.

- An article is **read** when the last line of its text has been on screen, clear of the app's own chrome. What comes after the text does not count: the "Ask the newsroom" box, the related links and "More from the newsroom".
- At that moment the app tracks a read event through the tracker SDK (see part 2). It tracks it once each time an article screen is opened, and never twice for the same screen. Opening the article later and reading it again counts again.
- This holds for saved copies too.
- Opening an article without reaching the end of its text does not make it read.
- The article page does not tell you where its text ends or how far the reader has got.
- The status box's "end of text" line shows when the page itself first saw the last line on screen. The control panel lists that next to your read events. Use it to check your work, but your app must not read it.

**Links.**

- **The front page's "Jump to" links** scroll the native scroll view so that the section heading sits at the top of the visible area.
- **The article's contents links and "Jump" button** put the section heading just below the native header.
- **Links to an article**, from either page, push a new article screen. The query string travels with it (the new page's status box shows it).
- **Everything else** is handed to the operating system. A web view never leaves the page it was opened for.

### Part 2: Consent and tracking

#### The reader's consent

Both pages show ads, and ads may only load with the reader's consent. The reader makes that choice in a consent service outside the web pages, and the result is a consent string. A page reads it from its URL fragment, `#consent=<value>`, once, when the document starts. There is no other way to give it to the page. A page that started without it shows an empty ad slot until it is loaded again.

The app gets the consent string from `GET /consent`. It answers `{ "consent": "<value>" }`, or `{ "consent": null }` when the reader has not chosen yet. On a real phone this answer arrives after a delay you cannot predict, and it may also fail or never arrive. The server behaves like that: every answer comes after a random delay, and by default one now and then fails. The control panel can fix what it answers, so you can reproduce a case.

- The app asks for the consent string at launch and each time it comes back to the foreground.
- An online page does not start loading until the app knows the consent string, or knows there is none. If `/consent` fails, or has not answered after five seconds, load without one. An answer that comes later still counts: it is consent arriving later, and the rules below apply.
- Every load of an online page carries the newest consent string the app has.
- A consent string that arrives or changes while a page is open does not reload it. The reader keeps reading, and the new value applies to the next load.
- One exception: a page that was loaded with no consent string at all reloads once, as soon as one is available, so that its ads can load.
- Saved copies (part 3) do not use the consent string.

#### Tracking

The newsroom measures how the app is used with the tracker SDK in `sdk/tracker.ts`. Copy it into your app as it is; its comments describe what it does. The pages run the web team's own tracker. Inside the app it sends nothing itself: it hands its events to the app over the message channel, as JSON strings with a `command` field, next to the protocol messages.

- Create one tracker, with the namespace `news-app`, the server's address as its endpoint, your app's version and the platform.
- Like the ads, tracking needs the reader's choice. The tracker may only be created once `/consent` has answered with a consent string, and nothing may reach the collector before that. Events from before are not lost: they are sent once the tracker exists. While the reader has not chosen, nothing is sent.
- Hand every message from a page to the SDK's web view callback. It picks out the web tracker's events and ignores everything else.
- Before a page starts, set `window.appContext = { appVersion, appBuild, os, deviceType }`. The web tracker adds it to every event, saved copies included.
- The app tracks its own events through the SDK:
  - a screen view each time a page is shown: `{ name: 'front' }` or `{ name: 'article', id: '<article id>' }`. One per loaded document; a reload is a new one.
  - the read event from part 1: a self-describing event with the schema `iglu:com.example.news/article_read/jsonschema/1-0-0` and the data `{ "articleId": "<id>" }`.
- The control panel lists every event that reaches the collector, and marks the ones that break these rules.

### Part 3: Reading offline (optional)

Readers can save an article and read it later without a connection. A saved copy is the set of files listed in the article's manifest (see *Server endpoints*).

If you skip this part, describe in NOTES.md how you would build it: where the files would live, how a copy is saved completely or not at all, and how an update reaches the reader.

**Saving.**

- The article screen has a save control. Saving downloads every file in the article's manifest, including photos from the image CDN, so on a slow connection it takes a while. Until it is done, the control shows that the article is being saved and lets the reader cancel.
- A copy is saved completely or not at all. A partial copy is never shown and never left on disk.
- Tapping save on an article that is already being saved does not start a second download. Different articles can be saved at the same time.
- A failed download is retried a few times. If it still fails, the reader is told, and nothing of the attempt is left behind.
- At most five articles are saved. Saving a sixth removes the one saved longest ago.
- Downloads do not need to survive the app being killed, but they must not leave anything behind. After the next launch the article shows as not saved.

**Opening a saved article.**

- An article that is saved opens from its saved copy, whether the server can be reached or not. Everything from part 1 works the same there, including marking it read. The status box shows `saved copy`, and every image loads.
- When the server cannot be reached, the front page ends on its error state, but the Saved screen still lists the saved articles and opens them.

**Updates.**

- When a saved article is opened and the server can be reached, the app checks for a newer version. If there is one, it saves it in the background.
- The old copy stays readable until the new one is complete, and stays if the update fails.
- The reader is never switched to the new version under their eyes. Show that a newer version is ready, and let them switch to it.

**Saved screen.**

- Lists the saved articles with their version, size and when each was saved, and the downloads in progress. Each one can be deleted or cancelled, and there is a way to delete everything.
- Shows the number of files and the total bytes in your saved-articles folder, measured from the file system each time the screen is shown, not taken from your own records.

### Tests

Include the tests you think are worth having. We care more about what you chose to test, and why, than about how much.

### NOTES.md (two pages at most)

- How events reach the collector, and what happens to the ones from before the reader chose.
- How you modelled the loading state and the consent rule, and why. Why wait up to five seconds and then reload once, rather than always waiting or always loading at once?
- How the two page layouts share code, and where they differ.
- How your app finds the end of the article text, and what you would ask the web team for so that it would not have to.
- Part 3, built or not: where saved copies live on disk, how a copy is saved completely or not at all, and what your app treats as the truth for "this article is saved".
- What you verified on iOS and on Android, what behaved differently between them, and what you are assuming without having checked.
- What you left out, and any bugs you know about.
- The operating system may kill a web view's content process while the app is in the background. What happens to your screens when the reader comes back? What should happen? You do not need to build this.
- If you used AI tools: where they helped, and where you had to correct them.

### Screen recording

At most three minutes of the app running. No talking or editing needed; simulator and emulator recordings are fine. Show:

- an article read to the end, and shown as read on the front page;
- a page that loaded without consent getting its ad once consent arrives;
- a setting, such as dark mode, reaching both pages;
- the app running on both iOS and Android. The second platform can be short.

If you built part 3, also an article being saved and then read while the server is unreachable.

## Handing it in

A git repository (link or zip) with its history, instructions to run it, NOTES.md and the recording.

## Practical notes

- The server prints its addresses. On the iOS simulator use `localhost`, on the Android emulator `10.0.2.2`, and on a phone your computer's address on the same Wi-Fi.
- Android blocks plain `http` unless the app allows it. Make sure your build does.
- The articles' photos load from the NZZ image CDN, so the device needs an internet connection. The control panel's Unreachable switch does not affect the CDN.
- To make the server unreachable, use the control panel. To take the device itself offline, use airplane mode on an Android emulator or a phone. The iOS simulator has no airplane mode.
- The server keeps its state in memory. Restarting it resets versions, faults and the consent string.

## Protocol, version 1

### Page to app

The page calls `window.ReactNativeWebView.postMessage(string)`. In Flutter, give the page an object of that name, for example a JavaScript channel called `ReactNativeWebView`. Protocol messages are JSON objects with a `type`:

| `type` | Other fields | Sent by | Meaning |
| --- | --- | --- | --- |
| `ready` | `protocol: 1`, `page: 'front' \| 'article'`, `articleId` (article only) | both | The page has started listening for app state. |
| `height` | `value: number` | both | Height of the page content in CSS pixels. Sent when the page becomes ready and whenever the height changes. |
| `toggleBookmark` | `articleId: string` | article | The reader tapped the bookmark button in the page. |
| `openArticle` | `path: string` | both | The reader tapped a teaser. `path` is a path on the server and may carry a query string. |

Other scripts on the pages share this channel. One of them is the web tracker, whose messages carry a `command` instead of a `type` (see part 2).

### App to page

The app dispatches a `CustomEvent` on `window`:

| Event name | `detail` | Used by | Effect |
| --- | --- | --- | --- |
| `app:fontScale` | `{ value: number }` | both | Scales the text. `1` is the default size. |
| `app:theme` | `{ value: 'light' \| 'dark' }` | both | Switches the colour scheme. The pages start dark. |
| `app:bookmarks` | `{ ids: string[] }` | both | The complete list of bookmarked article ids. |
| `app:read` | `{ ids: string[] }` | front | The complete list of read article ids. |
| `app:insets` | `{ top: number, bottom: number }` | article | The space, in CSS pixels, that the app's own chrome covers at the top and bottom. |


### Before the page starts

| Global | Used by | Effect |
| --- | --- | --- |
| `window.appInsets = { top, bottom }` | article | If it is set before the page's own scripts run, the page reserves that space from its first paint. |
| `window.appContext = { appVersion, appBuild, os, deviceType }` | both | The web tracker adds it to every event. The status box shows it. |

### Page URLs

- The front page is `/front`, articles are `/article/<id>`, both on the server.
- A page reads its query string and its fragment once, when the document starts.
- Links to articles are paths like `/article/2?ref=related`, on both pages and in saved copies alike.

## Server endpoints

| Request | Answer |
| --- | --- |
| `GET /front` | The front page. |
| `GET /article/<id>` | The online article page. |
| `GET /bundle/<id>/manifest.json` | `{ "articleId", "title", "version", "files": [{ "path", "url", "bytes" }] }` |
| `GET <url from the manifest>` | One file of a saved copy. |
| `GET /consent` | `{ "consent": "<value>" }` or `{ "consent": null }` |
| `POST /collect` | The tracker SDK's collector. The SDK calls it; you do not. |

- `version` is opaque. A different value means the article changed.
- A file's `url` is either a path on the server or, for an article's photos, a full URL on the NZZ image CDN. A saved copy needs all of them.
- Store a saved copy's files at their `path`s, relative to one folder, and open `index.html` from it. The page refers to the other files relative to itself.
- File URLs contain the version, and files of earlier versions stay available, so a download is never a mix of two versions.
