// The page <-> app message protocol, version 1 (README, "Protocol").
//
// Inbound messages are untrusted: the pages are deployed by another team on their own schedule, and other scripts
// (the web tracker, ads, third parties) share the channel. Every string is validated here, at the boundary, and the
// rest of the app only ever sees `InboundMessage`.

import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

export type PageKind = 'front' | 'article';
export type Theme = 'light' | 'dark';

/** CSS pixels covered by the app's own chrome at the top and bottom of an article. */
export type Insets = { top: number; bottom: number };

// ---------------------------------------------------------------------------------------------------------------
// Page -> app

const readyFront = z.object({
  type: z.literal('ready'),
  protocol: z.number().int(),
  page: z.literal('front'),
});

const readyArticle = z.object({
  type: z.literal('ready'),
  protocol: z.number().int(),
  page: z.literal('article'),
  articleId: z.string().min(1),
});

const pageMessageSchema = z.discriminatedUnion('type', [
  z.discriminatedUnion('page', [readyFront, readyArticle]),
  z.object({
    type: z.literal('height'),
    // The channel also carries `{ type: 'height', value: 'auto' }` from another script. Only real numbers count.
    value: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('toggleBookmark'),
    articleId: z.string().min(1),
  }),
  z.object({
    type: z.literal('openArticle'),
    // A path on the server, possibly with a query string. Where it leads is decided by the link router.
    path: z.string().startsWith('/'),
  }),
]);

export type PageMessage = z.infer<typeof pageMessageSchema>;
export type PageMessageType = PageMessage['type'];

const PAGE_MESSAGE_TYPES: ReadonlySet<string> = new Set<PageMessageType>([
  'ready',
  'height',
  'toggleBookmark',
  'openArticle',
]);

// The web tracker's messages carry `command` instead of `type`. Only the commands the SDK understands are kept, with
// the same shape checks the SDK makes, so a buffered command is exactly one the SDK would have tracked.
const trackerCommandSchema = z.object({
  command: z.enum(['trackScreenView', 'trackSelfDescribingEvent', 'trackPageView']),
  event: z.record(z.string(), z.unknown()),
  context: z.array(z.unknown()).optional(),
});

export type TrackerCommand = z.infer<typeof trackerCommandSchema>;

export type IgnoreReason =
  | 'not-json' // e.g. the plain string 'tp:heartbeat'
  | 'not-object'
  | 'no-type' // e.g. { event: 'metrics' }
  | 'unknown-type' // e.g. { type: 'ad:viewable' }
  | 'invalid-fields' // e.g. { type: 'height', value: 'auto' }
  | 'unknown-command';

export type InboundMessage =
  | { kind: 'page'; message: PageMessage }
  /** `raw` is kept because the SDK's web view callback wants the original string, unknown fields included. */
  | { kind: 'tracker'; raw: string; command: TrackerCommand }
  | { kind: 'ignored'; reason: IgnoreReason; raw: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Classifies one string from `onMessage`. Never throws. */
export function parseInbound(raw: string): InboundMessage {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: 'ignored', reason: 'not-json', raw };
  }

  if (!isRecord(json)) return { kind: 'ignored', reason: 'not-object', raw };

  if ('command' in json) {
    const command = trackerCommandSchema.safeParse(json);
    return command.success
      ? { kind: 'tracker', raw, command: command.data }
      : { kind: 'ignored', reason: 'unknown-command', raw };
  }

  const { type } = json;
  if (typeof type !== 'string') return { kind: 'ignored', reason: 'no-type', raw };
  if (!PAGE_MESSAGE_TYPES.has(type)) return { kind: 'ignored', reason: 'unknown-type', raw };

  const message = pageMessageSchema.safeParse(json);
  return message.success
    ? { kind: 'page', message: message.data }
    : { kind: 'ignored', reason: 'invalid-fields', raw };
}

// ---------------------------------------------------------------------------------------------------------------
// App -> page

/** Each event name bound to the shape of its `detail`. */
export type AppEvents = {
  'app:fontScale': { value: number };
  'app:theme': { value: Theme };
  'app:bookmarks': { ids: readonly string[] };
  'app:read': { ids: readonly string[] };
  'app:insets': Insets;
};

export type AppEventName = keyof AppEvents;

/** One event with its name and detail bound together, as a value that can be collected and sent later. */
export type AppEvent<K extends AppEventName = AppEventName> = { [N in K]: { name: N; detail: AppEvents[N] } }[K];

/** Which pages listen to which event. */
type EventAudience = {
  'app:fontScale': PageKind;
  'app:theme': PageKind;
  'app:bookmarks': PageKind;
  'app:read': 'front';
  'app:insets': 'article';
};

/** The events a given page understands: `app:read` only reaches the front page, `app:insets` only articles. */
export type EventsFor<P extends PageKind> = {
  [K in AppEventName as P extends EventAudience[K] ? K : never]: AppEvents[K];
};

/** The JavaScript that dispatches one event on the page's `window`. */
export function eventScript<K extends AppEventName>(name: K, detail: AppEvents[K]): string {
  // JSON is valid JavaScript (ES2019+), so the serialised values can be embedded as literals.
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(name)}, { detail: ${JSON.stringify(detail)} }));true;`;
}

/** `eventScript` for an event value. `AppEvent` already guarantees that the name and the detail belong together. */
export const appEventScript = (event: AppEvent): string => eventScript<AppEventName>(event.name, event.detail);

export type Dispatch<P extends PageKind> = <K extends keyof EventsFor<P> & AppEventName>(
  name: K,
  detail: AppEvents[K],
) => void;

/** A dispatcher for one page kind, on top of the web view's `injectJavaScript`. */
export function createDispatcher<P extends PageKind>(inject: (script: string) => void): Dispatch<P> {
  return (name, detail) => inject(eventScript(name, detail));
}
