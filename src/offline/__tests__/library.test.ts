// Saved copies (README, "Part 3"). The rules here are invisible on screen when they break: a partial copy left on
// disk, a second download of the same article, a sixth copy, an update that replaces the copy being read. So they
// run against an in-memory file system that records exactly what is on "disk".

import { createSavedLibrary, type LibraryDeps, reconcile, SAVED_LIMIT } from '../library';
import type { CopyRecord, Manifest } from '../manifest';
import type { Job, SavedFs, ScannedFolder } from '../savedFs';

beforeEach(() => {
  // Retries, cancels and failed updates are logged on purpose; the assertions below check what they did.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

type Folder = { files: Map<string, number>; record: CopyRecord | null };

/** Two folders, like the device: `tmp` for downloads, `saved` for complete copies. */
function memoryFs(respond: (url: string, signal: AbortSignal) => Promise<number>) {
  const tmp = new Map<string, Folder>();
  const saved = new Map<string, Folder>();
  let serial = 0;

  const fs: SavedFs = {
    scan: async () => [...saved].map(([uri, folder]): ScannedFolder => ({ uri, record: folder.record })),
    clearTmp: async () => tmp.clear(),
    createJob: async (articleId, version) => {
      serial += 1;
      const uri = `${articleId}-${version}-${serial}`;
      tmp.set(uri, { files: new Map(), record: null });
      return { uri };
    },
    download: async (url, job, path, signal) => {
      const bytes = await respond(url, signal);
      const folder = tmp.get(job.uri);
      if (!folder) throw new Error('the job folder is gone');
      folder.files.set(path, bytes);
      return bytes;
    },
    writeRecord: async (job, record) => {
      const folder = tmp.get(job.uri);
      if (folder) folder.record = record;
    },
    commit: async (job: Job) => {
      const folder = tmp.get(job.uri);
      if (!folder) throw new Error('nothing to commit');
      tmp.delete(job.uri);
      saved.set(job.uri, folder);
      return job.uri;
    },
    discard: async job => void tmp.delete(job.uri),
    unmark: async uri => {
      const folder = saved.get(uri);
      if (folder) folder.record = null;
    },
    remove: async uri => void saved.delete(uri),
    measure: async () => {
      const byFolder: Record<string, number> = {};
      let files = 0;
      saved.forEach((folder, uri) => {
        files += folder.files.size;
        byFolder[uri] = [...folder.files.values()].reduce((sum, bytes) => sum + bytes, 0);
      });
      return { files, bytes: Object.values(byFolder).reduce((sum, bytes) => sum + bytes, 0), byFolder };
    },
  };

  return { fs, tmp, saved };
}

const manifestOf = (articleId: string, version = 'v1'): Manifest => ({
  articleId,
  title: `Article ${articleId}`,
  version,
  files: [
    { path: 'index.html', url: `http://server/bundle/${articleId}/v/${version}/index.html`, bytes: 100 },
    { path: 'media/photo-1.jpg', url: `https://cdn/${articleId}.jpg`, bytes: 1000 },
    { path: 'media/map.svg', url: `http://server/bundle/${articleId}/v/${version}/media/map.svg`, bytes: 500 },
  ],
});

const bytesOf = (url: string) => (url.endsWith('index.html') ? 100 : url.endsWith('.jpg') ? 1000 : 500);

/** Resolves like a server: every file arrives, with the manifest's size. */
const answer = (url: string) => Promise.resolve(bytesOf(url));

/** Never answers, until the download is cancelled, like a stalled transfer. */
const stall = (_url: string, signal: AbortSignal) =>
  new Promise<number>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

/** Lets every pending promise and timer run. */
const settle = async () => {
  for (let round = 0; round < 30; round += 1) await new Promise(resolve => setTimeout(resolve, 0));
};

function setup(respond: (url: string, signal: AbortSignal) => Promise<number> = answer, overrides: Partial<LibraryDeps> = {}) {
  const disk = memoryFs(respond);
  const versions: Record<string, string> = {};
  const fetchManifest = jest.fn(async (articleId: string) => manifestOf(articleId, versions[articleId] ?? 'v1'));
  const onSaveFailed = jest.fn();
  let clock = 1_000;

  const library = createSavedLibrary({
    fs: disk.fs,
    fetchManifest,
    onSaveFailed,
    now: () => (clock += 1),
    wait: () => Promise.resolve(),
    ...overrides,
  });

  return { library, ...disk, fetchManifest, onSaveFailed, versions };
}

const copyIds = (library: ReturnType<typeof setup>['library']) => Object.keys(library.store.getState().copies).sort();

describe('saving', () => {
  it('downloads every file into its own folder, then moves the complete copy into place', async () => {
    const { library, tmp, saved } = setup();

    library.save('1');
    expect(library.store.getState().downloads['1']).toMatchObject({ kind: 'save' });
    await settle();

    expect(tmp.size).toBe(0);
    expect(saved.size).toBe(1);
    const [folder] = [...saved.values()];
    expect([...(folder?.files.keys() ?? [])].sort()).toEqual(['index.html', 'media/map.svg', 'media/photo-1.jpg']);
    expect(folder?.record).toMatchObject({ articleId: '1', version: 'v1' });
    expect(library.store.getState()).toMatchObject({ copies: { '1': { version: 'v1' } }, downloads: {} });
  });

  it('starts one download for an article however often save is tapped, and saves different articles at once', async () => {
    const { library, fetchManifest } = setup();

    library.save('1');
    library.save('1');
    library.save('2');
    await settle();
    library.save('1');
    await settle();

    expect(fetchManifest.mock.calls.map(([id]) => id)).toEqual(['1', '2']);
    expect(copyIds(library)).toEqual(['1', '2']);
  });

  it('leaves nothing behind when cancelled, and tells the reader nothing', async () => {
    const { library, tmp, saved, onSaveFailed } = setup(stall);

    library.save('1');
    await settle();
    expect(tmp.size).toBe(1);

    library.cancel('1');
    await settle();

    expect(tmp.size).toBe(0);
    expect(saved.size).toBe(0);
    expect(library.store.getState()).toEqual({ copies: {}, downloads: {}, folderRemovals: 0 });
    expect(onSaveFailed).not.toHaveBeenCalled();
  });

  it('tries a failing file again and saves when it arrives', async () => {
    let cuts = 1;
    const { library, onSaveFailed } = setup(url =>
      url.endsWith('map.svg') && cuts-- > 0 ? Promise.reject(new Error('cut midway')) : answer(url),
    );

    library.save('1');
    await settle();

    expect(copyIds(library)).toEqual(['1']);
    expect(onSaveFailed).not.toHaveBeenCalled();
  });

  it('gives up after a few tries, tells the reader once, and leaves nothing behind', async () => {
    let attempts = 0;
    const { library, tmp, saved, onSaveFailed } = setup(url => {
      if (!url.endsWith('map.svg')) return answer(url);
      attempts += 1;
      return Promise.reject(new Error('cut midway'));
    });

    library.save('1');
    await settle();

    expect(attempts).toBe(3);
    expect(onSaveFailed).toHaveBeenCalledTimes(1);
    expect(tmp.size).toBe(0);
    expect(saved.size).toBe(0);
    expect(library.store.getState()).toEqual({ copies: {}, downloads: {}, folderRemovals: 0 });
  });
});

describe('the limit', () => {
  it(`keeps ${SAVED_LIMIT}: saving one more removes the one saved longest ago`, async () => {
    const { library, saved } = setup();

    for (const id of ['1', '2', '3', '4', '5', '6']) {
      library.save(id);
      await settle();
    }

    expect(copyIds(library)).toEqual(['2', '3', '4', '5', '6']);
    expect(saved.size).toBe(SAVED_LIMIT);
  });

  it('counts from when the reader saved, not from an update', async () => {
    const { library, versions } = setup();
    for (const id of ['1', '2', '3', '4', '5']) {
      library.save(id);
      await settle();
    }

    versions['1'] = 'v2';
    await library.checkForUpdate('1');
    library.save('6');
    await settle();

    expect(copyIds(library)).toEqual(['2', '3', '4', '5', '6']);
  });
});

describe('updates', () => {
  it('saves a newer version in the background and keeps the old copy until it is complete', async () => {
    const gate = { open: () => {} };
    const opened = new Promise<void>(resolve => {
      gate.open = resolve;
    });
    let updating = false;
    const { library, saved, versions } = setup(async url => {
      if (updating && url.endsWith('map.svg')) await opened;
      return answer(url);
    });
    library.save('1');
    await settle();
    const oldUri = library.store.getState().copies['1']?.uri;

    updating = true;
    versions['1'] = 'v2';
    const update = library.checkForUpdate('1');
    await settle();

    // Mid-download: the reader still has version 1, complete.
    expect(library.store.getState().copies['1']).toMatchObject({ version: 'v1', uri: oldUri });
    expect(library.store.getState().downloads['1']).toMatchObject({ kind: 'update' });
    expect(saved.get(oldUri ?? '')?.record).not.toBeNull();

    gate.open();
    await update;

    expect(library.store.getState().copies['1']).toMatchObject({ version: 'v2' });
    expect(saved.has(oldUri ?? '')).toBe(false);
    expect(saved.size).toBe(1);
  });

  it('does nothing when the version is the same, and keeps the old copy when the update fails', async () => {
    let failing = false;
    const { library, onSaveFailed, versions, fetchManifest } = setup(url =>
      failing ? Promise.reject(new Error('unreachable')) : answer(url),
    );
    library.save('1');
    await settle();

    await library.checkForUpdate('1');
    expect(fetchManifest).toHaveBeenCalledTimes(2);
    expect(library.store.getState().downloads).toEqual({});

    failing = true;
    versions['1'] = 'v2';
    await library.checkForUpdate('1');

    expect(library.store.getState().copies['1']).toMatchObject({ version: 'v1' });
    expect(onSaveFailed).not.toHaveBeenCalled();
  });

  it('keeps the files of a copy on screen until the screen lets go, though it is no longer saved', async () => {
    const { library, saved, versions } = setup();
    library.save('1');
    await settle();
    const oldUri = library.store.getState().copies['1']?.uri ?? '';
    const release = library.hold(oldUri);

    versions['1'] = 'v2';
    await library.checkForUpdate('1');

    // Not a saved copy any more (no record), but its files are still there for the screen showing them.
    expect(saved.get(oldUri)).toMatchObject({ record: null });
    expect(saved.get(oldUri)?.files.size).toBe(3);

    release();
    await settle();
    expect(saved.has(oldUri)).toBe(false);
  });
});

describe('removing', () => {
  it('removes one copy, or every copy and download', async () => {
    const { library, saved, tmp } = setup();
    library.save('1');
    library.save('2');
    await settle();

    await library.remove('1');
    expect(copyIds(library)).toEqual(['2']);

    const stalled = setup(stall);
    stalled.library.save('3');
    await settle();
    await stalled.library.removeAll();
    await settle();
    expect(stalled.tmp.size).toBe(0);
    expect(stalled.library.store.getState()).toEqual({ copies: {}, downloads: {}, folderRemovals: 0 });

    await library.removeAll();
    expect(saved.size).toBe(0);
    expect(tmp.size).toBe(0);
  });

  it('counts a removal once its files are gone, so the Saved screen measures the folder without them', async () => {
    const { library, saved } = setup();
    library.save('1');
    library.save('2');
    await settle();

    const foldersWhenCounted: number[] = [];
    library.store.subscribe((state, previous) => {
      if (state.folderRemovals !== previous.folderRemovals) foldersWhenCounted.push(saved.size);
    });
    await library.remove('1');
    await library.remove('2');

    expect(foldersWhenCounted).toEqual([1, 0]);
  });
});

describe('at launch', () => {
  const record = (articleId: string, savedAt: number, downloadedAt = savedAt): CopyRecord => ({
    articleId,
    title: articleId,
    version: `v${downloadedAt}`,
    savedAt,
    downloadedAt,
  });

  it('keeps one copy per article, at most the limit, and removes everything else', () => {
    const folders: ScannedFolder[] = [
      { uri: 'a-old', record: record('a', 1, 1) },
      { uri: 'a-new', record: record('a', 1, 9) },
      { uri: 'junk', record: null },
      ...['b', 'c', 'd', 'e', 'f'].map((id, index) => ({ uri: id, record: record(id, 2 + index) })),
    ];

    const { copies, remove } = reconcile(folders, SAVED_LIMIT);

    expect(Object.keys(copies).sort()).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(remove.sort()).toEqual(['a-new', 'a-old', 'junk']);
  });

  it('empties the downloads folder and reads the copies from disk', async () => {
    const { library, fs, saved, tmp } = setup();
    await fs.createJob('9', 'v1');
    saved.set('copy-1', { files: new Map([['index.html', 100]]), record: record('1', 5) });
    saved.set('half', { files: new Map([['index.html', 100]]), record: null });

    await library.hydrate();

    expect(tmp.size).toBe(0);
    expect([...saved.keys()]).toEqual(['copy-1']);
    expect(copyIds(library)).toEqual(['1']);
  });
});
