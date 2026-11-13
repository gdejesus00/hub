import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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

// ---------- security ----------
const MODULES = ['app.js', 'config.js', 'content.js', 'drive.js', 'icons.js', 'routines.js', 'store.js', 'time.js'];
const policy = () => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read('index.html'))?.[1] ?? '';
const directives = () => Object.fromEntries(
  policy().split(';').map(part => part.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...values]) => [name, values]),
);

test('the page security policy allows only the app itself and the hosts it needs', () => {
  const rules = directives();
  assert.deepEqual(rules['default-src'], ["'self'"]);
  assert.deepEqual(rules['object-src'], ["'none'"]);
  assert.deepEqual(rules['base-uri'], ["'self'"]);
  assert.deepEqual(rules['form-action'], ["'none'"]);
  assert.ok(!policy().includes('unsafe-'), 'the policy must not allow inline or eval code');
  assert.ok(!policy().includes('*'), 'the policy must not use wildcards');
  assert.ok(!/\bdata:|\bblob:|\bhttp:/.test(policy()));
  // Adding an outside host means changing this list on purpose.
  assert.deepEqual([...new Set(policy().match(/https:\/\/[^\s;]+/g))].sort(), [
    'https://accounts.google.com/gsi/',
    'https://accounts.google.com/gsi/client',
    'https://accounts.google.com/gsi/style',
    'https://accounts.google.com/o/oauth2/',
    'https://oauth2.googleapis.com',
    'https://www.googleapis.com',
  ]);
  // Disconnect revokes the sign-in at oauth2.googleapis.com. Google's library hands the
  // sign-in back through a hidden frame under accounts.google.com/o/oauth2/.
  assert.ok(directives()['connect-src'].includes('https://oauth2.googleapis.com'));
  assert.ok(directives()['frame-src'].includes('https://accounts.google.com/o/oauth2/'));
});

test('the policy allows every outside address the code uses', () => {
  const rules = directives();
  const drive = read('drive.js');
  const signIn = /const GSI = '([^']+)'/.exec(drive)[1];
  const api = /const API = '([^']+)'/.exec(drive)[1];
  assert.ok(rules['script-src'].includes(signIn), 'the sign-in library is not allowed to load');
  assert.ok(rules['connect-src'].includes(new URL(api).origin), 'Drive calls are not allowed');
  const outside = MODULES.flatMap(file => read(file).match(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}/g) ?? []);
  assert.deepEqual([...new Set(outside)].sort(), ['https://accounts.google.com', 'https://www.googleapis.com']);
});

test('nothing in the page needs inline styles or scripts, which the policy blocks', () => {
  const html = read('index.html');
  assert.ok(!/\sstyle=/.test(html), 'index.html has a style attribute');
  assert.ok(!/<style/i.test(html), 'index.html has a style block');
  assert.ok(!/<script(?![^>]*\ssrc=)/i.test(html), 'index.html has an inline script');
  assert.ok(!/\son[a-z]+=/i.test(html), 'index.html has an inline event handler');
  for (const file of MODULES) {
    const code = read(file);
    assert.ok(!/\sstyle="/.test(code), `${file} writes a style attribute; use data-css`);
    assert.ok(!/\son(click|load|error|input|change|submit)=/i.test(code), `${file} writes an inline event handler`);
    assert.ok(!/javascript:/i.test(code), `${file} has a javascript: link`);
    assert.ok(!/\beval\(|new Function\(/.test(code), `${file} runs text as code`);
  }
});

test('every render that can carry data-css applies it', () => {
  const app = read('app.js');
  const raw = [...app.matchAll(/^(.*)\.innerHTML = (.*)$/gm)].filter(match => !match[1].trim().startsWith('el'));
  // Plain innerHTML is fine only where the markup has no data-css: clearing the sheet, the tab bar, the home pill.
  assert.equal(raw.length, 3, raw.map(match => match[0].trim()).join('\n'));
  for (const match of raw) assert.ok(!match[2].includes('data-css'));
  assert.ok(app.includes('setHtml(view, PAGES[state.tab]())'));
});

test('test flags are read only when the app runs on this computer', () => {
  const app = read('app.js');
  assert.ok(app.includes("const flags = LOCAL ? location.search : '';"));
  assert.equal(app.match(/location\.search/g).length, 1, 'location.search is read somewhere else too');
  assert.ok(app.includes('initClock(flags);'));
  assert.ok(app.includes("new URLSearchParams(flags).get('demo')"));
});

test('links from content must be web links, and open without handing over the page', () => {
  assert.ok(read('content.js').includes(String.raw`/^https?:\/\//i.test(text(value))`));
  const app = read('app.js');
  for (const match of app.matchAll(/target="_blank"([^>]*)>/g)) assert.ok(match[0].includes('rel="noopener noreferrer"'), match[0]);
  assert.ok(app.match(/target="_blank"/g).length >= 3);
});

// Fails if personal data or a secret appears anywhere in this public repository.
// Generic patterns only. To block specific words too (names, places), list them one per line
// in a file named .private_terms in this folder. Git ignores it, so the words never get in.
test('no personal data or secrets in the repository', () => {
  const top = fileURLToPath(root);
  const skipFolders = new Set(['.git', 'node_modules', 'docs']);
  const skipFiles = new Set(['local-content.txt', '.private_terms']);
  const binary = /\.(png|jpg|jpeg|gif|webp|ico|woff2?)$/i;
  const patterns = {
    'an email address': /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    'a user folder path': /(\b[a-z]:[\\/]+users[\\/]+\w|\/home\/\w|\/Users\/\w)/i,
    'a phone number': /(?<!\d)\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?!\d)/,
    'a secret': /\b(password|passwd|secret|api[_-]?key|access[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"'<|]{8,}/i,
    'a long hex string': /(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])/,
    'a private key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  };
  const looksRandom = token => [/\d/g, /[A-Z]/g, /[a-z]/g].every(kind => (token.match(kind) ?? []).length >= 3);
  const termsFile = new URL('.private_terms', root);
  const terms = existsSync(termsFile)
    ? readFileSync(termsFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => line && !line.startsWith('#'))
    : [];

  const hits = [];
  const walk = (folder, prefix) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (!skipFolders.has(entry.name)) walk(`${folder}/${entry.name}`, `${path}/`);
      } else if (!skipFiles.has(entry.name) && !binary.test(entry.name)) {
        const body = readFileSync(`${folder}/${entry.name}`, 'utf8');
        for (const [label, pattern] of Object.entries(patterns)) if (pattern.test(body)) hits.push(`${path}: ${label}`);
        // A file ID or key looks like a long run of mixed letters and digits.
        if ((body.match(/[A-Za-z0-9]{24,}/g) ?? []).some(looksRandom)) hits.push(`${path}: a long random-looking string`);
        const lower = body.toLowerCase();
        for (const term of terms) if (lower.includes(term)) hits.push(`${path}: a word from .private_terms`);
      }
    }
  };
  walk(top.replace(/[\\/]$/, ''), '');
  assert.deepEqual(hits, []);
});

test('the private word list and real content stay out of git', () => {
  const ignored = read('.gitignore').split(/\r?\n/);
  for (const line of ['.private_terms', 'local-content.txt']) assert.ok(ignored.includes(line), `${line} is not ignored`);
});
