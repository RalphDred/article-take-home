// What a saved copy is made of (README, "Part 3" and "Server endpoints").
//
// The manifest names every file of a copy: its `path` inside the copy's folder and the `url` to fetch it from (a
// path on our server, or a full URL on the image CDN). Both come from the network, and `path` becomes a file name on
// the device, so it is checked before anything is written: a relative path, no `..`, nothing outside the folder.

import { z } from 'zod';

import { pageUrl } from '../config';

/** The file inside each copy's folder that makes it a saved copy (`copyRecordSchema`). Never a manifest path. */
export const COPY_RECORD_FILE = '.copy.json';

/** Ids and versions become folder names, so they are kept to a safe alphabet. */
const NAME = /^[\w-]{1,64}$/;

/** A relative path of plain segments: `index.html`, `media/photo-1.jpg`. No `..`, no empty or hidden segments. */
const SEGMENT = /^[\w-][\w.-]*$/;

export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false;

  return path.split('/').every(segment => SEGMENT.test(segment) && segment !== '..');
}

export const isSafeName = (name: string): boolean => NAME.test(name);

export type ManifestFile = { path: string; url: string; bytes: number };

export type Manifest = { articleId: string; title: string; version: string; files: readonly ManifestFile[] };

const manifestSchema = z.object({
  articleId: z.string(),
  title: z.string(),
  version: z.string(),
  files: z.array(z.object({ path: z.string(), url: z.string().min(1), bytes: z.number().int().nonnegative() })),
});

/** A file's URL: a server path becomes a URL on our server. Only http(s) URLs are fetched. */
export function absoluteUrlOf(url: string): string | null {
  if (url.startsWith('/') && !url.startsWith('//')) return pageUrl(url);

  return /^https?:\/\/[^/]/i.test(url) ? url : null;
}

/**
 * The manifest of `articleId`, checked: it is for that article, names its version and files safely, has an
 * `index.html` to open, and lists each path once. Every URL is made absolute. Throws when anything is off, so a copy
 * is never saved from a manifest the app does not understand.
 */
export function parseManifest(json: unknown, articleId: string): Manifest {
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new Error(`the manifest of article ${articleId} is not a manifest`);

  const { title, version, files } = parsed.data;
  if (parsed.data.articleId !== articleId) {
    throw new Error(`asked for the manifest of article ${articleId}, got article ${parsed.data.articleId}`);
  }
  if (!isSafeName(version)) throw new Error(`article ${articleId}: unusable version ${JSON.stringify(version)}`);

  const paths = new Set<string>();
  const checked = files.map(file => {
    const url = absoluteUrlOf(file.url);
    if (!isSafeRelativePath(file.path) || paths.has(file.path) || url === null) {
      throw new Error(`article ${articleId}: unusable file ${JSON.stringify(file.path)} at ${file.url}`);
    }
    paths.add(file.path);

    return { path: file.path, url, bytes: file.bytes };
  });
  if (!paths.has('index.html')) throw new Error(`article ${articleId}: the manifest has no index.html`);

  return { articleId, title, version, files: checked };
}

// ---------------------------------------------------------------------------------------------------------------
// The copy's own record, written into its folder before the folder is moved into place. A folder under `saved/`
// with a valid record is a saved copy; nothing else is.

export const copyRecordSchema = z.object({
  articleId: z.string().regex(NAME),
  title: z.string(),
  version: z.string().regex(NAME),
  /** When the reader saved the article. An update keeps it: the limit removes the copy saved longest ago. */
  savedAt: z.number(),
  /** When this version was downloaded. Equal to `savedAt` until an update. */
  downloadedAt: z.number(),
});

export type CopyRecord = z.infer<typeof copyRecordSchema>;

export function parseCopyRecord(text: string): CopyRecord | null {
  try {
    const parsed = copyRecordSchema.safeParse(JSON.parse(text));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
