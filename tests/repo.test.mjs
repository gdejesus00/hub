import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APP_VERSION } from '../config.js';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');

test('every file the service worker caches exists', () => {
  const list = /const APP_FILES = \[([\s\S]*?)\];/.exec(read('sw.js'))[1];
  const files = [...list.matchAll(/'([^']+)'/g)].map(match => match[1]).filter(file => file !== './');
  assert.ok(files.length >= 12);
  for (const file of files) assert.ok(existsSync(new URL(file, root)), `${file} is missing`);
});

test('every JavaScript module the app imports is cached for offline use', () => {
  const sw = read('sw.js');
  for (const file of ['app.js', 'config.js', 'content.js', 'drive.js', 'icons.js', 'routines.js', 'store.js', 'time.js']) {
    assert.ok(sw.includes(`'${file}'`), `${file} is not in APP_FILES`);
    for (const match of read(file).matchAll(/from '\.\/([\w.-]+)'/g)) assert.ok(sw.includes(`'${match[1]}'`), `${match[1]} is not in APP_FILES`);
  }
});

test('the cache name carries the app version', () => {
  assert.ok(read('sw.js').includes(`const CACHE = 'hub-v${APP_VERSION}';`));
});

test('the manifest is installable and its icons are the sizes they claim', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  for (const icon of manifest.icons.filter(entry => entry.type === 'image/png')) {
    const bytes = readFileSync(new URL(icon.src, root));
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes, icon.src);
  }
});
