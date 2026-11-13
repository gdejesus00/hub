// The Dispatch line on Today. The papers are public web pages; each one publishes its latest
// edition as data/latest.json. The list of papers comes from the content file, so no address
// is built into this app. Nothing here signs in: it only reads public files.
import * as store from './store.js';

const clean = value => (typeof value === 'string' ? value.trim() : '');
const web = value => (/^https?:\/\//i.test(clean(value)) ? clean(value) : '');
const TIMEOUT_MS = 8000;

// One edition file to the few fields the app shows. Throws when there is no headline.
export function parsePaper(data) {
  const lead = data && typeof data === 'object' ? data.lead : null;
  const headline = clean(lead?.headline);
  if (!headline) throw new Error('No headline in this edition.');
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(clean(data.date)) ? clean(data.date) : '',
    headline,
    dek: clean(lead.dek),
    bottom: clean(data.bottom_line),
    sources: (Array.isArray(lead.sources) ? lead.sources : [])
      .map(source => ({ name: clean(source?.name) || 'Source', url: web(source?.url) }))
      .filter(source => source.url)
      .slice(0, 8),
  };
}

// Where a paper lives as a full address (a ./folder/ from the content file is resolved here).
export const paperPage = (entry, base = globalThis.location?.href) => new URL(entry.url, base).href;

async function fetchPaper(entry) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(new URL('data/latest.json', paperPage(entry)), { cache: 'no-cache', signal: control.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parsePaper(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

const saved = () => store.read('dispatch', {});

// What the phone remembers from the last good read, in the order the content file lists the papers.
export function cached(entries) {
  const memory = saved();
  return entries.map(entry => ({ entry, paper: memory[entry.url]?.paper ?? null, fetchedAt: memory[entry.url]?.fetchedAt ?? 0, failed: false }));
}

// Reads every paper. A paper that can't be read keeps its last good copy and is marked failed.
export async function loadAll(entries) {
  const memory = saved();
  const results = await Promise.allSettled(entries.map(fetchPaper));
  const next = {};
  const out = entries.map((entry, i) => {
    const before = memory[entry.url];
    if (results[i].status === 'fulfilled') {
      next[entry.url] = { paper: results[i].value, fetchedAt: Date.now() };
      return { entry, ...next[entry.url], failed: false };
    }
    if (before) next[entry.url] = before;
    return { entry, paper: before?.paper ?? null, fetchedAt: before?.fetchedAt ?? 0, failed: true };
  });
  store.write('dispatch', next);
  return out;
}
