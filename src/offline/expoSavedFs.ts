import { Directory, File, Paths } from 'expo-file-system';

import { COPY_RECORD_FILE, parseCopyRecord } from './manifest';
import type { FolderSizes, Job, SavedFs, ScannedFolder } from './savedFs';

// Both in the app's documents, on one volume, so moving a finished download into `saved/` is a rename.
const savedRoot = new Directory(Paths.document, 'saved');
const tmpRoot = new Directory(Paths.document, 'saved-tmp');

/** Folder URIs without a trailing slash, so one folder is always the same string. */
const normalized = (uri: string) => uri.replace(/\/+$/, '');

/** The folder saved copies live in. A saved copy's page may read files below it (and nothing else). */
export const SAVED_ROOT_URI = normalized(savedRoot.uri);

const uniqueName = (articleId: string, version: string) =>
  `${articleId}-${version}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function deleteEntry(uri: string) {
  const info = Paths.info(uri);
  if (!info.exists) return;

  if (info.isDirectory) new Directory(uri).delete();
  else new File(uri).delete();
}

/** Every file below `directory`, with its size. */
function walk(directory: Directory, visit: (file: File) => void) {
  directory.list().forEach(entry => {
    if (entry instanceof Directory) walk(entry, visit);
    else visit(entry);
  });
}

export const expoSavedFs: SavedFs = {
  async scan() {
    if (!savedRoot.exists) return [];

    return Promise.all(
      savedRoot.list().map(async (entry): Promise<ScannedFolder> => {
        if (!(entry instanceof Directory)) return { uri: normalized(entry.uri), record: null };

        const recordFile = new File(entry, COPY_RECORD_FILE);
        const record = recordFile.exists ? parseCopyRecord(await recordFile.text()) : null;

        return { uri: normalized(entry.uri), record };
      }),
    );
  },

  async clearTmp() {
    if (tmpRoot.exists) tmpRoot.delete();
  },

  async createJob(articleId, version) {
    const folder = new Directory(tmpRoot, uniqueName(articleId, version));
    folder.create({ intermediates: true });

    return { uri: normalized(folder.uri) };
  },

  async download(url, job, path, signal) {
    const target = new File(new Directory(job.uri), ...path.split('/'));
    target.parentDirectory.create({ intermediates: true, idempotent: true });

    // Rejects on a non-2xx answer and on a connection cut midway. A retry overwrites what an attempt left.
    const file = await File.downloadFileAsync(url, target, { idempotent: true, signal });

    return file.size;
  },

  async writeRecord(job, record) {
    const file = new File(new Directory(job.uri), COPY_RECORD_FILE);
    file.create({ overwrite: true });
    file.write(JSON.stringify(record));
  },

  async commit(job: Job) {
    savedRoot.create({ intermediates: true, idempotent: true });
    const folder = new Directory(job.uri);
    // Into the existing `saved/` folder, keeping its unique name: one rename, so the copy appears complete.
    await folder.move(savedRoot);

    return normalized(folder.uri);
  },

  async discard(job) {
    deleteEntry(job.uri);
  },

  async unmark(folderUri) {
    const record = new File(new Directory(folderUri), COPY_RECORD_FILE);
    if (record.exists) record.delete();
  },

  async remove(folderUri) {
    deleteEntry(folderUri);
  },

  async measure(): Promise<FolderSizes> {
    const byFolder: Record<string, number> = {};
    let files = 0;
    let bytes = 0;
    if (!savedRoot.exists) return { files, bytes, byFolder };

    savedRoot.list().forEach(entry => {
      let folderBytes = 0;
      const count = (file: File) => {
        files += 1;
        folderBytes += file.size;
      };
      if (entry instanceof Directory) walk(entry, count);
      else count(entry);
      bytes += folderBytes;
      byFolder[normalized(entry.uri)] = folderBytes;
    });

    return { files, bytes, byFolder };
  },
};
