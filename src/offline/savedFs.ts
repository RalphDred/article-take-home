import type { CopyRecord } from './manifest';

/** A folder found in the saved-articles folder: a saved copy when its record is valid, junk to remove otherwise. */
export type ScannedFolder = { uri: string; record: CopyRecord | null };

/** One download's own folder, outside the saved-articles folder until it is complete. */
export type Job = { readonly uri: string };

export type FolderSizes = { files: number; bytes: number; byFolder: Readonly<Record<string, number>> };

/**
 * The file operations behind saved copies (`expoSavedFs.ts` on a device, a fake in the tests).
 *
 * Two folders: `saved/`, which only ever holds complete copies, one folder each, and `saved-tmp/`, where downloads
 * happen. A copy is written completely in `saved-tmp/`, its record last, and then moved into `saved/` with one
 * rename (`commit`). Nothing partial is ever in `saved/`, and `saved-tmp/` is emptied at every launch.
 */
export type SavedFs = {
  /** Every entry of the saved-articles folder. */
  scan: () => Promise<ScannedFolder[]>;
  /** Removes whatever downloads left behind (the app was killed during one). */
  clearTmp: () => Promise<void>;
  /** A new, empty folder for one download of `articleId`. */
  createJob: (articleId: string, version: string) => Promise<Job>;
  /** Downloads `url` to `path` inside the job's folder. Resolves with the bytes written; rejects on any failure. */
  download: (url: string, job: Job, path: string, signal: AbortSignal) => Promise<number>;
  writeRecord: (job: Job, record: CopyRecord) => Promise<void>;
  /** Moves the finished job into the saved-articles folder in one rename. Resolves with the copy's folder. */
  commit: (job: Job) => Promise<string>;
  discard: (job: Job) => Promise<void>;
  /** Deletes a copy's record: from then on it is not a saved copy, even though its files are still there. */
  unmark: (folderUri: string) => Promise<void>;
  /** Deletes a folder (or a stray file) in the saved-articles folder. */
  remove: (folderUri: string) => Promise<void>;
  /** Files and bytes in the saved-articles folder, counted on disk, in total and per folder. */
  measure: () => Promise<FolderSizes>;
};

/** The page a copy opens with. The page refers to every other file relative to itself. */
export const indexUrlOf = (folderUri: string): string => `${folderUri.replace(/\/+$/, '')}/index.html`;
