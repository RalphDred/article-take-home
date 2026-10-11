// Saved copies and their downloads (README, "Part 3: Reading offline").
//
// The truth for "this article is saved" is the file system: a folder in the saved-articles folder with a valid
// record (`.copy.json`). The store below is a view of it, built by scanning at launch and changed only after the
// file system has changed. A download writes into its own folder and becomes a copy with one rename, so a copy is
// complete or not there at all. Removing a copy deletes its record first (from then on it is not saved), then its
// folder, unless a screen is still showing it: that folder goes when the screen lets go of it.

import { createStore, type StoreApi } from 'zustand/vanilla';

import type { CopyRecord, Manifest, ManifestFile } from './manifest';
import type { FolderSizes, Job, SavedFs, ScannedFolder } from './savedFs';

/** At most this many articles are saved. Saving one more removes the one saved longest ago. */
export const SAVED_LIMIT = 5;
/** A failed file (or manifest) is tried again after each of these delays, then the download fails. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];
/** Files of one copy downloaded at the same time. */
export const DOWNLOAD_CONCURRENCY = 3;

export type SavedCopy = CopyRecord & { uri: string };

export type Download = {
  articleId: string;
  /** `save`: the reader saved the article. `update`: a newer version of a saved copy, in the background. */
  kind: 'save' | 'update';
  /** From the manifest, once it has arrived. */
  title: string | null;
  done: number;
  total: number;
};

export type SavedState = {
  /** The saved copy of each saved article. */
  copies: Readonly<Record<string, SavedCopy>>;
  /** At most one download per article. */
  downloads: Readonly<Record<string, Download>>;
  /**
   * Goes up each time a folder has left the saved-articles folder. A copy stops being saved before its files are
   * gone, so anything that measures the folder measures again when this changes.
   */
  folderRemovals: number;
};

export type LibraryDeps = {
  fs: SavedFs;
  fetchManifest: (articleId: string, signal: AbortSignal) => Promise<Manifest>;
  /** The reader saved an article and it could not be saved. (A failed update stays quiet: the old copy stays.) */
  onSaveFailed: (articleId: string, error: unknown) => void;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  retryDelaysMs?: readonly number[];
  concurrency?: number;
  limit?: number;
};

export type SavedLibrary = {
  store: StoreApi<SavedState>;
  /** At launch, before any screen: empties the downloads folder and reads the saved copies from disk. */
  hydrate: () => Promise<void>;
  /** Saves an article. Does nothing while it is being saved or is already saved. */
  save: (articleId: string) => void;
  /** Stops a download. Nothing of it is left behind. */
  cancel: (articleId: string) => void;
  /** Cancels any download of the article and removes its copy. */
  remove: (articleId: string) => Promise<void>;
  removeAll: () => Promise<void>;
  /** A saved copy was opened: when the server has a newer version, it is saved in the background. */
  checkForUpdate: (articleId: string) => Promise<void>;
  /** A screen shows this copy: its folder stays until the returned function is called, even if it is removed. */
  hold: (folderUri: string) => () => void;
  measure: () => Promise<FolderSizes>;
};

// ---------------------------------------------------------------------------------------------------------------
// Pure rules.

/** The articles to remove so that at most `limit` stay: the ones saved longest ago. */
export function articlesOverLimit(copies: readonly SavedCopy[], limit: number): string[] {
  return [...copies]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(limit)
    .map(copy => copy.articleId);
}

/**
 * What a scan at launch means: one copy per article (the newest download, if the app was killed between an update
 * and removing the version before it), at most `limit` of them, and every other entry is removed.
 */
export function reconcile(
  folders: readonly ScannedFolder[],
  limit: number,
): { copies: Record<string, SavedCopy>; remove: string[] } {
  const copies: Record<string, SavedCopy> = {};
  const remove: string[] = [];

  folders.forEach(({ uri, record }) => {
    if (record === null) {
      remove.push(uri);
      return;
    }
    const other = copies[record.articleId];
    if (other === undefined || record.downloadedAt > other.downloadedAt) {
      if (other) remove.push(other.uri);
      copies[record.articleId] = { ...record, uri };
    } else {
      remove.push(uri);
    }
  });

  articlesOverLimit(Object.values(copies), limit).forEach(articleId => {
    const copy = copies[articleId];
    if (copy) remove.push(copy.uri);
    delete copies[articleId];
  });

  return { copies, remove };
}

// ---------------------------------------------------------------------------------------------------------------

const abortableWait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', stop, { once: true });
  });

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record;

  return rest;
};

type Running = { controller: AbortController; cancelled: boolean };

export function createSavedLibrary({
  fs,
  fetchManifest,
  onSaveFailed,
  now = Date.now,
  wait = abortableWait,
  retryDelaysMs = RETRY_DELAYS_MS,
  concurrency = DOWNLOAD_CONCURRENCY,
  limit = SAVED_LIMIT,
}: LibraryDeps): SavedLibrary {
  const store = createStore<SavedState>(() => ({ copies: {}, downloads: {}, folderRemovals: 0 }));
  const running = new Map<string, Running>();
  const holds = new Map<string, number>();
  /** Removed copies whose folders a screen still shows. */
  const retired = new Set<string>();

  const setDownload = (articleId: string, change: Partial<Download>) =>
    store.setState(state => {
      const current = state.downloads[articleId];
      return current ? { downloads: { ...state.downloads, [articleId]: { ...current, ...change } } } : state;
    });

  const removeFolder = (uri: string) =>
    fs
      .remove(uri)
      .catch((error: unknown) => console.warn(`[saved] could not remove ${uri}`, error))
      .finally(() => store.setState(state => ({ folderRemovals: state.folderRemovals + 1 })));

  /** No longer a saved copy, at once. Its files go now, or when the last screen showing them closes. */
  async function retire(uri: string): Promise<void> {
    await fs.unmark(uri).catch((error: unknown) => console.warn(`[saved] could not unmark ${uri}`, error));
    if ((holds.get(uri) ?? 0) > 0) retired.add(uri);
    else await removeFolder(uri);
  }

  async function withRetries<T>(attempt: () => Promise<T>, signal: AbortSignal): Promise<T> {
    for (let failures = 0; ; failures += 1) {
      try {
        return await attempt();
      } catch (error) {
        const delay = retryDelaysMs[failures];
        if (signal.aborted || delay === undefined) throw error;
        console.warn(`[saved] attempt ${failures + 1} failed, trying again in ${delay} ms`, error);
        await wait(delay, signal);
      }
    }
  }

  /** Every file, a few at a time. The first file that still fails after its retries stops the others. */
  async function downloadFiles(articleId: string, files: readonly ManifestFile[], job: Job, run: Running) {
    const { signal } = run.controller;
    let next = 0;
    let done = 0;
    const errors: unknown[] = [];

    const worker = async () => {
      while (errors.length === 0 && !signal.aborted) {
        const file = files[next];
        if (file === undefined) return;
        next += 1;
        try {
          const bytes = await withRetries(() => fs.download(file.url, job, file.path, signal), signal);
          if (bytes !== file.bytes) console.warn(`[saved] ${file.path}: ${bytes} bytes, the manifest says ${file.bytes}`);
          done += 1;
          setDownload(articleId, { done });
        } catch (error) {
          errors.push(error);
          run.controller.abort();
        }
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, worker));
    if (errors.length > 0) throw errors[0];
    if (signal.aborted) throw new Error('cancelled');
  }

  async function download(articleId: string, kind: Download['kind'], base: SavedCopy | null, known?: Manifest) {
    const run: Running = { controller: new AbortController(), cancelled: false };
    const { signal } = run.controller;
    running.set(articleId, run);
    store.setState(state => ({
      downloads: { ...state.downloads, [articleId]: { articleId, kind, title: known?.title ?? null, done: 0, total: 0 } },
    }));

    let job: Job | null = null;
    try {
      const manifest = known ?? (await withRetries(() => fetchManifest(articleId, signal), signal));
      setDownload(articleId, { title: manifest.title, total: manifest.files.length });

      job = await fs.createJob(articleId, manifest.version);
      await downloadFiles(articleId, manifest.files, job, run);

      const at = now();
      const record: CopyRecord = {
        articleId,
        title: manifest.title,
        version: manifest.version,
        savedAt: base?.savedAt ?? at,
        downloadedAt: at,
      };
      // The record goes in last: a folder with a record is complete.
      await fs.writeRecord(job, record);
      if (signal.aborted) throw new Error('cancelled');

      const uri = await fs.commit(job);
      job = null;

      // Cancelled while the rename ran: it is on disk now, so it is removed like any copy.
      if (run.cancelled) {
        await retire(uri);
        return;
      }

      const previous = store.getState().copies[articleId];
      store.setState(state => ({ copies: { ...state.copies, [articleId]: { ...record, uri } } }));
      if (previous && previous.uri !== uri) await retire(previous.uri);

      for (const evicted of articlesOverLimit(Object.values(store.getState().copies), limit)) {
        console.info(`[saved] more than ${limit} saved, removing article ${evicted}, saved longest ago`);
        await remove(evicted);
      }
    } catch (error) {
      if (job !== null) {
        await fs.discard(job).catch((discardError: unknown) => console.warn('[saved] could not discard a download', discardError));
      }
      if (run.cancelled) console.info(`[saved] ${kind} of article ${articleId} cancelled`);
      else if (kind === 'save') onSaveFailed(articleId, error);
      else console.warn(`[saved] update of article ${articleId} failed, the saved copy stays`, error);
    } finally {
      if (running.get(articleId) === run) running.delete(articleId);
      store.setState(state =>
        state.downloads[articleId] ? { downloads: without(state.downloads, articleId) } : state,
      );
    }
  }

  function cancel(articleId: string) {
    const run = running.get(articleId);
    if (!run) return;

    run.cancelled = true;
    run.controller.abort();
  }

  async function remove(articleId: string) {
    cancel(articleId);

    const copy = store.getState().copies[articleId];
    if (!copy) return;

    store.setState(state => ({ copies: without(state.copies, articleId) }));
    await retire(copy.uri);
  }

  return {
    store,

    async hydrate() {
      await fs.clearTmp().catch((error: unknown) => console.warn('[saved] could not empty the downloads folder', error));

      let folders: ScannedFolder[] = [];
      try {
        folders = await fs.scan();
      } catch (error) {
        console.warn('[saved] could not read the saved-articles folder', error);
      }

      const { copies, remove: leftovers } = reconcile(folders, limit);
      store.setState({ copies });
      await Promise.all(leftovers.map(removeFolder));
    },

    save(articleId) {
      if (running.has(articleId) || store.getState().copies[articleId]) return;

      void download(articleId, 'save', null);
    },

    cancel,
    remove,

    async removeAll() {
      const { copies, downloads } = store.getState();
      await Promise.all([...new Set([...Object.keys(copies), ...Object.keys(downloads)])].map(remove));
    },

    async checkForUpdate(articleId) {
      const copy = store.getState().copies[articleId];
      if (!copy || running.has(articleId)) return;

      let manifest: Manifest;
      try {
        manifest = await fetchManifest(articleId, new AbortController().signal);
      } catch (error) {
        // Offline, or the server is unreachable: the saved copy is all there is, and that is fine.
        console.info(`[saved] no update check for article ${articleId}`, error);
        return;
      }

      // The copy may have changed while the manifest was on its way.
      const current = store.getState().copies[articleId];
      if (!current || current.uri !== copy.uri || running.has(articleId)) return;
      if (manifest.version === current.version) return;

      console.info(`[saved] article ${articleId}: version ${manifest.version} replaces ${current.version}`);
      await download(articleId, 'update', current, manifest);
    },

    hold(folderUri) {
      holds.set(folderUri, (holds.get(folderUri) ?? 0) + 1);
      let released = false;

      return () => {
        if (released) return;
        released = true;

        const count = (holds.get(folderUri) ?? 1) - 1;
        if (count > 0) {
          holds.set(folderUri, count);
          return;
        }
        holds.delete(folderUri);
        if (retired.delete(folderUri)) void removeFolder(folderUri);
      };
    },

    measure: () => fs.measure(),
  };
}
