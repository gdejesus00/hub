import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APP_NAME } from '../config.js';
import { STATUS_LINE, installState, manualSteps, showOnToday } from '../install.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('the install status covers the installed app, a ready browser, and a browser with no install box', () => {
  assert.equal(installState({ standalone: true, prompt: true }), 'installed');
  assert.equal(installState({ standalone: true }), 'installed');
  assert.equal(installState({ prompt: true }), 'ready');
  // An offer from the browser wins over an old "installed" note: the app is no longer on the device.
  assert.equal(installState({ prompt: true, installedBefore: true }), 'ready');
  assert.equal(installState({ installedBefore: true }), 'likely');
  assert.equal(installState({}), 'manual');
  assert.equal(installState(), 'manual');
  for (const status of ['installed', 'ready', 'likely', 'manual']) assert.ok(STATUS_LINE[status], `${status} has no status line`);
});

test('the Install button shows on Today only in a browser tab, and can be hidden', () => {
  assert.equal(showOnToday('ready'), true);
  assert.equal(showOnToday('manual'), true);
  assert.equal(showOnToday('installed'), false);
  assert.equal(showOnToday('likely'), false);
  assert.equal(showOnToday('ready', true), false);
  assert.equal(showOnToday('manual', true), false);
});

test('there are by-hand steps for every kind of device', () => {
  const android = manualSteps('Mozilla/5.0 (Linux; Android 16; Pixel 10) Chrome/140.0 Mobile Safari/537.36');
  const iphone = manualSteps('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/604.1');
  const other = manualSteps('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36');
  assert.ok(android.some(step => step.includes('Add to Home screen')));
  assert.ok(iphone.some(step => step.includes('Share')));
  assert.ok(other.length >= 2 && manualSteps().length >= 2);
  for (const steps of [android, iphone, other]) for (const step of steps) assert.ok(!/https?:/.test(step), 'steps are plain text, not links');
});

test('the app keeps the install box, opens it from a tap, and never opens it twice', () => {
  const app = read('app.js');
  assert.ok(app.includes("addEventListener('beforeinstallprompt'"));
  assert.ok(app.includes("addEventListener('appinstalled'"));
  assert.ok(app.includes('event.preventDefault();'));
  assert.ok(app.includes('installBox = null; // a box can be opened only once'));
  assert.equal(app.match(/\.prompt\(\)/g).length, 1, 'the install box is opened in one place only');
  assert.ok(app.includes('data-action="install"'));
  assert.ok(app.includes('data-action="hide-install"'));
  assert.ok(app.includes('data-action="install-pref"'));
});

test('the installed app is named Hive everywhere a phone reads the name', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(APP_NAME, 'Hive');
  assert.equal(manifest.name, APP_NAME);
  assert.equal(manifest.short_name, APP_NAME);
  assert.ok(read('index.html').includes(`<title>${APP_NAME}</title>`));
  assert.ok(read('index.html').includes(`<meta name="apple-mobile-web-app-title" content="${APP_NAME}">`));
});
