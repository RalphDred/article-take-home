// The manifest comes from the network and its paths become file names on the device: a bad one must never be saved.

import { pageUrl } from '../../config';
import { isSafeRelativePath, parseCopyRecord, parseManifest } from '../manifest';

const manifest = (files: unknown[], extra: object = {}) => ({
  articleId: '1',
  title: 'Title',
  version: 'a6685f3b',
  files,
  ...extra,
});

const INDEX = { path: 'index.html', url: '/bundle/1/v/a6685f3b/index.html', bytes: 40087 };
const PHOTO = { path: 'media/photo-1.jpg', url: 'https://img.example/1.jpg?width=960', bytes: 256534 };

describe('parseManifest', () => {
  it('makes server paths absolute and keeps CDN URLs', () => {
    const parsed = parseManifest(manifest([INDEX, PHOTO]), '1');

    expect(parsed.files).toEqual([
      { path: 'index.html', url: pageUrl('/bundle/1/v/a6685f3b/index.html'), bytes: 40087 },
      PHOTO,
    ]);
  });

  it.each([
    ['a path out of the folder', { ...PHOTO, path: '../escape.jpg' }],
    ['an absolute path', { ...PHOTO, path: '/etc/passwd' }],
    ['the copy record', { ...PHOTO, path: '.copy.json' }],
    ['a path twice', INDEX],
    ['a non-http URL', { ...PHOTO, url: 'file:///data/x.jpg' }],
    ['a protocol-relative URL', { ...PHOTO, url: '//elsewhere.example/x.jpg' }],
  ])('rejects %s', (_case, file) => {
    expect(() => parseManifest(manifest([INDEX, file]), '1')).toThrow();
  });

  it('rejects a manifest for another article, without index.html, or with an unsafe version', () => {
    expect(() => parseManifest(manifest([INDEX], { articleId: '2' }), '1')).toThrow();
    expect(() => parseManifest(manifest([PHOTO]), '1')).toThrow();
    expect(() => parseManifest(manifest([INDEX], { version: '../v' }), '1')).toThrow();
    expect(() => parseManifest({ files: 'nope' }, '1')).toThrow();
  });
});

describe('isSafeRelativePath', () => {
  it('accepts plain relative paths only', () => {
    expect(isSafeRelativePath('media/map.svg')).toBe(true);
    expect(isSafeRelativePath('media//map.svg')).toBe(false);
    expect(isSafeRelativePath('media/../map.svg')).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
  });
});

describe('parseCopyRecord', () => {
  it('reads a valid record and nothing else', () => {
    const record = { articleId: '1', title: 'T', version: 'abc', savedAt: 1, downloadedAt: 2 };

    expect(parseCopyRecord(JSON.stringify(record))).toEqual(record);
    expect(parseCopyRecord('{"articleId":"1"}')).toBeNull();
    expect(parseCopyRecord('not json')).toBeNull();
  });
});
