// The content contract. The app reads one JSON object from a Google Doc, cleans up what
// Docs does to plain text, and fills in safe defaults so a missing key just hides its card.
import { dateStr, isWeekend, minutesOf } from './time.js';

export const KINDS = ['work', 'move', 'home', 'family', 'focus', 'free'];
export const STATES = ['blocked', 'waiting', 'on-track', 'done'];

// Docs adds a BOM, smart quotes and non-breaking spaces. Keep the text from the first { to the last }.
export function cleanText(text) {
  const cleaned = String(text ?? '')
    .replace(/^﻿/, '')
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/ /g, ' ');
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('No JSON object found in the content file.');
  return cleaned.slice(first, last + 1);
}

// Text to a plain object. Throws with a readable message when the JSON is broken.
export function parseRaw(text) {
  const cleaned = cleanText(text);
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (error) {
    try {
      // Some exports escape [ ] and _ with a backslash, which is never valid JSON, so undo it.
      data = JSON.parse(cleaned.replace(/\\([[\]_])/g, '$1'));
    } catch {
      throw new Error(`The content file isn't valid JSON. ${error.message}`);
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The content file must hold one JSON object.');
  return data;
}

const text = value => (typeof value === 'string' ? value.trim() : '');
const list = value => (Array.isArray(value) ? value : []);
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const link = value => (/^https?:\/\//i.test(text(value)) ? text(value) : '');
const kind = value => (KINDS.includes(value) ? value : 'free');
const days = value => (['every', 'weekdays', 'weekends'].includes(value) ? value : 'every');
const count = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

// "More details" text: one string or a list of strings, trimmed, empty ones dropped.
const lines = value => (typeof value === 'string' ? value.split(/\n+/) : list(value)).map(text).filter(Boolean).slice(0, 12);
// Labelled links shown when a card opens. Only http(s) links are kept.
const links = value => list(value)
  .map(item => ({ label: text(item?.label), url: link(item?.url) }))
  .filter(item => item.url)
  .map(item => ({ ...item, label: item.label || new URL(item.url).hostname.replace(/^www\./, '') }))
  .slice(0, 8);
// A paper's address: a full https:// address, or ./folder/ when the app is run from this PC.
const paperUrl = value => {
  const url = text(value);
  if (!/^(https?:\/\/|\.\/)/i.test(url)) return '';
  return url.endsWith('/') ? url : `${url}/`;
};

function block(raw) {
  const start = minutesOf(raw?.start);
  const end = minutesOf(raw?.end);
  if (start == null || end == null || end <= start) return null;
  return { start, end, title: text(raw.title) || 'Untitled', detail: text(raw.detail), kind: kind(raw.kind) };
}
const blocks = value => list(value).map(block).filter(Boolean).sort((a, b) => a.start - b.start);

function timed(raw) {
  const time = minutesOf(raw?.time);
  return time == null ? null : { label: text(raw.label), time, days: days(raw.days) };
}

// Any object in, a complete and safe content object out. Unknown keys are ignored.
export function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    version: Number(d.version) || 1,
    updated: text(d.updated),
    name: text(d.name),
    headline: text(d.headline),
    today: d.today && isDate(d.today.date)
      ? { date: d.today.date, blocks: blocks(d.today.blocks), headline: text(d.today.headline) }
      : null,
    weekday: blocks(d.weekday),
    weekend: blocks(d.weekend),
    countdown: timed(d.countdown),
    shutdown: timed(d.shutdown),
    cleaning: list(d.cleaning).map(text).filter(Boolean),
    home: { musicUrl: link(d.home?.musicUrl), checklist: list(d.home?.checklist).map(text).filter(Boolean) },
    boxes: { total: count(d.boxes?.total), perWeekend: count(d.boxes?.perWeekend) },
    upcoming: list(d.upcoming)
      .filter(item => item && isDate(item.date) && text(item.title))
      .map(item => ({
        date: item.date,
        end: isDate(item.end) && item.end >= item.date ? item.end : item.date,
        title: text(item.title),
        kind: kind(item.kind),
        detail: text(item.detail),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    projects: list(d.projects)
      .filter(item => item && text(item.name))
      .map(item => ({
        name: text(item.name),
        state: STATES.includes(item.state) ? item.state : 'on-track',
        status: text(item.status),
        next: text(item.next),
        due: isDate(item.due) ? item.due : '',
        progress: typeof item.progress === 'number' ? Math.max(0, Math.min(1, item.progress)) : null,
        link: link(item.link),
        detail: lines(item.detail),
        links: links(item.links),
      })),
    pages: list(d.pages)
      .filter(item => item && text(item.title) && link(item.url))
      .map(item => ({
        group: text(item.group) || 'Other',
        title: text(item.title),
        desc: text(item.desc),
        url: link(item.url),
        icon: text(item.icon).toLowerCase(),
        detail: lines(item.detail),
      })),
    // The Dispatch papers shown on Today: { name, url }. The app reads <url>data/latest.json.
    dispatch: list(d.dispatch)
      .map(item => ({ name: text(item?.name), url: paperUrl(item?.url) }))
      .filter(item => item.name && item.url)
      .slice(0, 4),
  };
}

// Which blocks apply on a date: the one-day override if its date matches, else weekday or weekend.
export function dayPlan(content, date) {
  if (content.today && content.today.date === dateStr(date)) {
    return { blocks: content.today.blocks, headline: content.today.headline || content.headline };
  }
  return { blocks: isWeekend(date) ? content.weekend : content.weekday, headline: content.headline };
}
