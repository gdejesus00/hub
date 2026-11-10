import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cleanText, dayPlan, normalize, parseRaw } from '../content.js';

const sample = readFileSync(new URL('../sample-content.json', import.meta.url), 'utf8');

test('cleanText strips the BOM, smart quotes and anything outside the braces', () => {
  const messy = '﻿HUB\n\n{“name”: “Sam’s hub”}\n\nend';
  assert.equal(cleanText(messy), '{"name": "Sam\'s hub"}');
});

test('parseRaw reads JSON with the blank lines Docs adds between lines', () => {
  const spaced = '{\r\n\r\n  "version": 1,\r\n\r\n  "name": "Sam"\r\n\r\n}\r\n';
  assert.deepEqual(parseRaw(spaced), { version: 1, name: 'Sam' });
});

test('parseRaw undoes backslash-escaped brackets and underscores', () => {
  assert.deepEqual(parseRaw('{"cleaning": \\["Dishes"\\], "url": "https://x.test/a\\_b"}'), {
    cleaning: ['Dishes'],
    url: 'https://x.test/a_b',
  });
});

test('parseRaw throws a readable error for broken JSON and for no JSON at all', () => {
  assert.throws(() => parseRaw('{"version": 1,, }'), /isn't valid JSON/);
  assert.throws(() => parseRaw('nothing here'), /No JSON object/);
  assert.throws(() => parseRaw(''), /No JSON object/);
});

test('normalize turns an empty object into safe, empty content', () => {
  const c = normalize({});
  assert.equal(c.name, '');
  assert.equal(c.today, null);
  assert.equal(c.countdown, null);
  assert.equal(c.shutdown, null);
  assert.deepEqual([c.weekday, c.weekend, c.cleaning, c.upcoming, c.projects, c.pages], [[], [], [], [], [], []]);
  assert.deepEqual(c.home, { musicUrl: '', checklist: [] });
  assert.deepEqual(c.boxes, { total: 0, perWeekend: 0 });
  assert.deepEqual(normalize(null), c);
});

test('normalize sorts blocks, drops bad ones and ignores unknown keys', () => {
  const c = normalize({
    surprise: true,
    weekday: [
      { start: '15:00', end: '16:30', title: 'Run', kind: 'move' },
      { start: '07:00', end: '14:45', title: 'Work', kind: 'work' },
      { start: 'late', end: '16:30', title: 'Bad start' },
      { start: '18:00', end: '17:00', title: 'Ends before it starts' },
      { start: '20:00', end: '21:00', kind: 'mystery' },
    ],
  });
  assert.deepEqual(c.weekday.map(b => b.title), ['Work', 'Run', 'Untitled']);
  assert.deepEqual(c.weekday[0], { start: 420, end: 885, title: 'Work', detail: '', kind: 'work' });
  assert.equal(c.weekday[2].kind, 'free');
  assert.equal('surprise' in c, false);
});

test('normalize only keeps http and https links', () => {
  const c = normalize({
    home: { musicUrl: 'javascript:alert(1)' },
    projects: [{ name: 'A', link: 'ftp://x.test' }, { name: 'B', link: 'https://x.test' }],
    pages: [{ title: 'Bad', url: 'javascript:alert(1)' }, { title: 'Good', url: 'https://x.test', icon: 'Food' }],
  });
  assert.equal(c.home.musicUrl, '');
  assert.deepEqual(c.projects.map(p => p.link), ['', 'https://x.test']);
  assert.deepEqual(c.pages.map(p => p.title), ['Good']);
  assert.equal(c.pages[0].icon, 'food');
});

test('dayPlan uses the override only on its own date, else weekday or weekend', () => {
  const c = normalize({
    headline: 'Usual',
    today: { date: '2026-11-10', headline: 'Special', blocks: [{ start: '09:00', end: '10:00', title: 'Override' }] },
    weekday: [{ start: '07:00', end: '14:45', title: 'Work' }],
    weekend: [{ start: '08:00', end: '10:00', title: 'Boxes' }],
  });
  assert.deepEqual(dayPlan(c, new Date(2026, 10, 10, 12)).blocks.map(b => b.title), ['Override']);
  assert.equal(dayPlan(c, new Date(2026, 10, 10, 12)).headline, 'Special');
  assert.deepEqual(dayPlan(c, new Date(2026, 10, 11, 12)).blocks.map(b => b.title), ['Work']);
  assert.equal(dayPlan(c, new Date(2026, 10, 11, 12)).headline, 'Usual');
  assert.deepEqual(dayPlan(c, new Date(2026, 10, 14, 12)).blocks.map(b => b.title), ['Boxes']);
});

test('the demo content parses and fills every section', () => {
  const c = normalize(parseRaw(sample));
  assert.equal(c.weekday.length, 7);
  assert.equal(c.weekend.length, 3);
  assert.equal(c.cleaning.length, 4);
  assert.equal(c.upcoming.length, 6);
  assert.equal(c.projects.length, 5);
  assert.equal(c.pages.length, 9);
  assert.equal(c.countdown.time, 18 * 60);
  assert.equal(c.shutdown.days, 'weekdays');
});
