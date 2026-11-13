import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalize } from '../content.js';
import { parsePaper } from '../dispatch.js';

test('project details and links are cleaned', () => {
  const [p] = normalize({
    projects: [{
      name: 'A', detail: ['  one ', '', 'two'], links: [
        { label: 'Site', url: 'https://example.com/x' },
        { url: 'https://www.example.org/y' },
        { label: 'Bad', url: 'javascript:alert(1)' },
        { label: 'Local', url: '/etc/passwd' },
      ],
    }],
  }).projects;
  assert.deepEqual(p.detail, ['one', 'two']);
  assert.deepEqual(p.links, [{ label: 'Site', url: 'https://example.com/x' }, { label: 'example.org', url: 'https://www.example.org/y' }]);
});

test('detail can be one string and defaults to nothing', () => {
  const c = normalize({ projects: [{ name: 'A', detail: 'line one\nline two' }, { name: 'B' }], upcoming: [{ date: '2026-11-15', title: 'T', detail: ' hi ' }, { date: '2026-11-16', title: 'U' }], pages: [{ title: 'P', url: 'https://example.com', detail: 'More' }] });
  assert.deepEqual(c.projects[0].detail, ['line one', 'line two']);
  assert.deepEqual(c.projects[1].detail, []);
  assert.deepEqual(c.projects[1].links, []);
  assert.equal(c.upcoming[0].detail, 'hi');
  assert.equal(c.upcoming[1].detail, '');
  assert.deepEqual(c.pages[0].detail, ['More']);
});

test('the dispatch list keeps only named, safe addresses and adds the trailing slash', () => {
  const { dispatch } = normalize({
    dispatch: [
      { name: 'One', url: 'https://example.com/one' },
      { name: 'Two', url: './sample/two/' },
      { name: 'Bad', url: 'javascript:alert(1)' },
      { name: '', url: 'https://example.com/x/' },
      { name: 'Relative', url: '../up/' },
    ],
  });
  assert.deepEqual(dispatch, [{ name: 'One', url: 'https://example.com/one/' }, { name: 'Two', url: './sample/two/' }]);
  assert.deepEqual(normalize({}).dispatch, []);
});

test('an edition file is reduced to the headline, summary, bottom line and linked sources', () => {
  const paper = parsePaper({
    date: '2026-11-12',
    lead: { headline: ' Big news ', dek: 'More.', sources: [{ name: 'A', url: 'https://example.com/a' }, { name: 'B', url: 'javascript:x' }, { url: 'https://example.com/c' }] },
    bottom_line: 'The bottom line.',
    sections: ['ignored'],
  });
  assert.equal(paper.headline, 'Big news');
  assert.equal(paper.bottom, 'The bottom line.');
  assert.deepEqual(paper.sources, [{ name: 'A', url: 'https://example.com/a' }, { name: 'Source', url: 'https://example.com/c' }]);
  assert.equal(paper.date, '2026-11-12');
});

test('an edition without a headline is rejected', () => {
  assert.throws(() => parsePaper({ lead: {} }));
  assert.throws(() => parsePaper(null));
});

test('the demo content is made up: no real addresses of the owner', () => {
  const text = readFileSync(new URL('../sample-content.json', import.meta.url), 'utf8');
  assert.ok(!/gdejesus|drive\.google|docs\.google/i.test(text));
});
