// Startup, the four pages, the sheets and every tap. Rendering is plain template strings:
// each page is rebuilt from the saved content plus what's stored on the phone.
import { APP_VERSION, WHATS_NEW } from './config.js';
import { dayPlan, normalize, parseRaw } from './content.js';
import * as drive from './drive.js';
import { icon, tileIcon } from './icons.js';
import * as r from './routines.js';
import * as store from './store.js';
import { DAYS, MONTHS, dateStr, daysBetween, fmtTime, initClock, longDate, now, nowMinutes, parseDate } from './time.js';

// Dev flags: ?demo=1 loads made-up content, ?demo=broken breaks it on purpose,
// ?demo=local reads a private file from the dev server. ?now=YYYY-MM-DDTHH:MM fakes the clock.
// They work only when the app is served from this computer, never on the published site.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const flags = LOCAL ? location.search : '';
initClock(flags);
const demo = new URLSearchParams(flags).get('demo');

const $ = (selector, root = document) => root.querySelector(selector);

// The page's security policy blocks inline style attributes in HTML. Sizes, positions and colour
// variables travel as data-css instead and are set here, by script, right after each render.
function applyCss(root) {
  for (const el of root.querySelectorAll('[data-css]')) {
    for (const rule of el.dataset.css.split(';')) {
      const at = rule.indexOf(':');
      if (at > 0) el.style.setProperty(rule.slice(0, at).trim(), rule.slice(at + 1).trim());
    }
  }
}
const setHtml = (el, html) => {
  el.innerHTML = html;
  applyCss(el);
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  tab: 'today',
  content: normalize({}),
  hasContent: false,
  fetchedAt: 0,
  error: '',
  syncing: false,
  filter: 'all',
  query: '',
  sheet: '',
  popped: '',
  confirm: '',
  pendingBoxes: null,
};

// ---------- what's stored on the phone ----------
const today = () => dateStr(now());
const getChecks = () => store.read(`checks:${today()}`, {});
const getWorkouts = () => store.read('workouts', []);
const getBoxes = () => Math.max(0, Math.floor(Number(store.read('boxes', 0)) || 0));
const getPrefs = () => store.read('prefs', {});
function getTop3(day = today()) {
  const saved = store.read(`top3:${day}`, null);
  return { lines: [0, 1, 2].map(i => saved?.lines?.[i] ?? ''), ticks: [0, 1, 2].map(i => Boolean(saved?.ticks?.[i])) };
}
function musicUrl() {
  const own = (getPrefs().musicUrl || '').trim();
  const url = own || state.content.home.musicUrl;
  return /^https?:\/\//i.test(url) ? url : '';
}

function loadSaved() {
  const saved = store.read('content', null);
  if (saved?.data) {
    state.content = normalize(saved.data);
    state.hasContent = true;
    state.fetchedAt = saved.fetchedAt || 0;
  }
  state.error = saved?.error || '';
}

// New text from Drive. Good text replaces the saved copy. Broken text keeps the last good copy
// on screen and records the error for the amber chip and Settings.
function applyText(text) {
  try {
    const data = parseRaw(text);
    state.content = normalize(data);
    state.hasContent = true;
    state.fetchedAt = Date.now();
    state.error = '';
    store.write('content', { data, fetchedAt: state.fetchedAt, error: '' });
  } catch (error) {
    state.error = error.message;
    store.write('content', { ...(store.read('content', null) ?? {}), error: error.message });
  }
}

// ---------- today ----------
function syncChip() {
  const fresh = state.hasContent && !state.error && (demo ||dateStr(new Date(state.fetchedAt)) === dateStr(new Date()));
  const [cls, label] = state.syncing ? ['is-sync', 'Syncing']
    : !navigator.onLine ? ['is-off', 'Offline']
    : fresh ? ['is-fresh', 'Up to date']
    : ['is-stale', 'Tap to sync'];
  return `<button class="chip ${cls}" data-action="sync" aria-label="Sync with Google Drive. ${label}."><i class="dot"></i>${label}</button>`;
}

function todayHeader(d) {
  const part = d.getHours() < 12 ? 'morning' : d.getHours() < 17 ? 'afternoon' : 'evening';
  const name = state.content.name ? `, ${esc(state.content.name)}` : '';
  return `<header class="head"><div><p class="caps">${esc(longDate(d))}</p><h1>Good ${part}${name}</h1></div>${syncChip()}</header>`;
}

function countdownHtml(blocks, d) {
  const countdown = state.content.countdown;
  const cd = r.countdownState(countdown, blocks, d);
  if (!cd) return '';
  return `<div class="cd${cd.mode === 'now' ? ' is-now' : ''}"><b data-cd>${cd.mode === 'now' ? 'Now' : r.fmtCountdown(cd.seconds)}</b><span>${esc(countdown.label)}</span></div>`;
}

function welcomeCard() {
  return `<section class="now kind-home">
    <p class="caps"><i class="pip"></i>Welcome</p>
    <h2>Less in your head. More on the page.</h2>
    <p class="tag">Connect Google Drive to load your hub.</p>
    <button class="btn primary wide" data-action="sync">Connect Google Drive</button>
  </section>`;
}

function nowCard(blocks, d, m) {
  const { current, next, done } = r.nowState(blocks, m);
  const cd = countdownHtml(blocks, d);
  if (current) {
    const fraction = (m - current.start) / (current.end - current.start);
    return `<section class="now kind-${current.kind}" aria-label="Happening now">
      <p class="caps"><i class="pip"></i>Now</p>
      <h2>${esc(current.title)}</h2>
      ${current.detail ? `<p>${esc(current.detail)}</p>` : ''}
      <div class="bar"><i data-css="width:${(fraction * 100).toFixed(1)}%"></i></div>
      <div class="now-row"><span>${r.fmtDur(current.end - m)} left</span><span>${next ? `Next: ${esc(next.title)} ${fmtTime(next.start)}` : 'Last block today'}</span></div>
      ${cd}
    </section>`;
  }
  if (next) {
    return `<section class="now kind-${next.kind}" aria-label="Coming next">
      <p class="caps"><i class="pip"></i>Next</p>
      <h2>${esc(next.title)}</h2>
      ${next.detail ? `<p>${esc(next.detail)}</p>` : ''}
      <div class="now-row"><span>Starts in ${r.fmtDur(next.start - m)}</span><span>${fmtTime(next.start)} to ${fmtTime(next.end)}</span></div>
      ${cd}
    </section>`;
  }
  const tomorrow = dayPlan(state.content, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)).blocks[0];
  return `<section class="now kind-free" aria-label="Day summary">
    <p class="caps"><i class="pip"></i>${done ? 'Today' : 'Open day'}</p>
    <h2>${done ? "Day's done" : 'Nothing scheduled'}</h2>
    ${tomorrow ? `<p>Tomorrow starts with ${esc(tomorrow.title)} at ${fmtTime(tomorrow.start)}.</p>` : ''}
    ${cd}
  </section>`;
}

function timeline(blocks, m) {
  if (!blocks.length) return '';
  const start = Math.min(300, blocks[0].start);
  const end = Math.max(1320, ...blocks.map(b => b.end));
  const pct = value => (((value - start) / (end - start)) * 100).toFixed(2);
  const segments = blocks.map((b, i) =>
    `<button class="tl-seg kind-${b.kind}${b.end <= m ? ' is-past' : ''}" data-css="left:${pct(b.start)}%;width:${(((b.end - b.start) / (end - start)) * 100).toFixed(2)}%" data-action="goto" data-target="blk-${i}" aria-label="${esc(b.title)}, ${fmtTime(b.start)} to ${fmtTime(b.end)}"></button>`).join('');
  const ticks = [[360, '6a'], [540, '9a'], [720, '12p'], [900, '3p'], [1080, '6p'], [1260, '9p']]
    .filter(([at]) => at > start && at < end)
    .map(([at, label]) => `<span data-css="left:${pct(at)}%">${label}</span>`).join('');
  const marker = m >= start && m <= end ? `<i class="tl-now" data-css="left:${pct(m)}%"></i>` : '';
  return `<section class="tl" aria-label="Day timeline"><div class="tl-track">${segments}${marker}</div><div class="tl-ticks" aria-hidden="true">${ticks}</div></section>`;
}

const RING = 2 * Math.PI * 36;
function ring(fraction, color, center, label) {
  const off = RING * (1 - Math.max(0, Math.min(1, fraction)));
  return `<div class="ringwrap" data-css="--rc:var(--${color})">
    <svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${esc(label)}"><circle class="ring-bg" cx="42" cy="42" r="36"/><circle class="ring-fg" cx="42" cy="42" r="36" transform="rotate(-90 42 42)" stroke-dasharray="${RING.toFixed(1)}" data-css="--off:${off.toFixed(1)}"/></svg>
    <div class="ring-center" aria-hidden="true">${center}</div>
  </div>`;
}

function rings(d) {
  const c = state.content;
  const ticks = getChecks().reset ?? {};
  const total = c.cleaning.length;
  const done = c.cleaning.filter(item => ticks[item]).length;
  const workouts = getWorkouts();
  const logged = workouts.includes(today());
  const streak = r.streak(workouts, d);
  const week = r.weekCount(workouts, d);
  const boxTotal = c.boxes.total;
  const sorted = boxTotal ? Math.min(getBoxes(), boxTotal) : getBoxes();
  const allSorted = boxTotal > 0 && sorted >= boxTotal;
  const estimate = r.boxEstimate(sorted, boxTotal, c.boxes.perWeekend, d);
  return `<section class="rings" aria-label="Progress">
    <div class="ringcard">
      ${ring(total ? done / total : 0, total && done === total ? 'ok' : 'home', `<b>${total ? `${done}/${total}` : '0'}</b><small>reset</small>`, `15-minute reset: ${done} of ${total} done`)}
      <button class="mini" data-action="goto" data-target="reset-list">${total && done === total ? 'All done' : 'Open list'}</button>
      <p class="sub">${total ? (done === total ? 'Reset complete' : `${total - done} left today`) : 'No list yet'}</p>
    </div>
    <div class="ringcard">
      ${ring(week / 5, logged ? 'ok' : 'move', `<b>${streak}</b><small>day streak</small>`, `Workout streak: ${streak} ${streak === 1 ? 'day' : 'days'}. ${week} of 5 this week.`)}
      <button class="mini${logged ? ' is-on' : ''}" data-action="workout" aria-pressed="${logged}">${logged ? `${icon('check', 14)}Done` : 'Done today'}</button>
      <p class="sub">Best ${r.bestStreak(workouts)}</p>
    </div>
    <div class="ringcard">
      ${ring(boxTotal ? sorted / boxTotal : 0, allSorted ? 'ok' : 'focus', `<b>${boxTotal ? `${sorted}/${boxTotal}` : sorted}</b><small>sorted</small>`, `Boxes sorted: ${sorted}${boxTotal ? ` of ${boxTotal}` : ''}`)}
      <div class="stepper">
        <button class="mini" data-action="box" data-delta="-1" aria-label="One fewer box sorted">${icon('minus', 16)}</button>
        <button class="mini" data-action="box" data-delta="1" aria-label="One more box sorted">${icon('plus', 16)}</button>
      </div>
      <p class="sub">${allSorted ? `All ${boxTotal} sorted` : estimate ? `Done about <span class="nowrap">${estimate}</span>` : 'Boxes'}</p>
    </div>
  </section>`;
}

function blockList(blocks, m) {
  if (!blocks.length) return '';
  const rows = blocks.map((b, i) => `<li id="blk-${i}" class="blk kind-${b.kind}${b.end <= m ? ' is-past' : ''}${b.start <= m && m < b.end ? ' is-now' : ''}">
    <time>${fmtTime(b.start)}</time><i class="pip"></i>
    <div><b>${esc(b.title)}</b>${b.detail ? `<span>${esc(b.detail)}</span>` : ''}</div>
  </li>`).join('');
  return `<section class="card"><h2 class="caps">Today's plan</h2><ol class="blocks">${rows}</ol></section>`;
}

function checkItem(list, key, checked, label = key) {
  const id = `${list}:${key}`;
  return `<li><label class="chk${state.popped === id ? ' just' : ''}"><input type="checkbox" data-list="${list}" data-item="${esc(key)}"${checked ? ' checked' : ''}><span class="box">${icon('check', 16)}</span><span class="txt">${esc(label)}</span></label></li>`;
}

function top3Card() {
  const top = getTop3();
  const shutdown = state.content.shutdown;
  const items = top.lines.map((line, i) => (line ? checkItem('top3', String(i), top.ticks[i], line) : '')).join('');
  const empty = shutdown ? `Set at ${fmtTime(shutdown.time).replace(/ [AP]M$/, '')} shutdown` : 'Nothing set for today yet';
  return `<section class="card"><div class="card-head"><h2 class="caps">Top 3 today</h2><button class="link" data-action="sheet" data-sheet="top3">Edit</button></div>
    ${items ? `<ul class="checks">${items}</ul>` : `<p class="empty">${empty}</p>`}</section>`;
}

function resetCard() {
  const items = state.content.cleaning;
  if (!items.length) return '';
  const ticks = getChecks().reset ?? {};
  return `<section class="card" id="reset-list"><h2 class="caps">15-minute reset</h2><ul class="checks">${items.map(item => checkItem('reset', item, ticks[item])).join('')}</ul></section>`;
}

function upcomingCard(d) {
  const items = r.upcoming(state.content.upcoming, d).slice(0, 5);
  if (!items.length) return '';
  const rows = items.map(item => {
    const start = parseDate(item.date);
    const end = parseDate(item.end);
    const through = item.end !== item.date ? `, through ${MONTHS[end.getMonth()]} ${end.getDate()}` : '';
    return `<li class="up kind-${item.kind}"><div class="cal"><small>${MONTHS[start.getMonth()]}</small><b>${start.getDate()}</b></div><div class="up-main"><b>${esc(item.title)}</b><span>${item.when}${through}</span></div></li>`;
  }).join('');
  return `<section class="card"><h2 class="caps">Coming up</h2><ul>${rows}</ul></section>`;
}

function renderToday() {
  const d = now();
  const m = nowMinutes(d);
  const plan = dayPlan(state.content, d);
  const showShutdown = r.shutdownActive(state.content.shutdown, d) && !store.read(`shutdown-dismissed:${today()}`, false);
  return [
    todayHeader(d),
    state.error ? `<button class="warn" data-action="tab" data-tab="settings">${icon('alert', 16)}Couldn't read today's update</button>` : '',
    plan.headline ? `<p class="headline">${esc(plan.headline)}</p>` : '',
    showShutdown ? `<section class="banner" aria-label="Shutdown"><div><b>Shutdown time.</b> Write tomorrow's top 3.</div><button class="btn primary small" data-action="sheet" data-sheet="shutdown">Write</button><button class="iconbtn" data-action="dismiss-shutdown" aria-label="Hide for today">${icon('close', 18)}</button></section>` : '',
    state.hasContent ? nowCard(plan.blocks, d, m) : welcomeCard(),
    timeline(plan.blocks, m),
    rings(d),
    top3Card(),
    blockList(plan.blocks, m),
    resetCard(),
    upcomingCard(d),
  ].join('');
}

// ---------- projects ----------
const STATE_LABEL = { 'on-track': 'On track', waiting: 'Waiting', blocked: 'Blocked', done: 'Done' };

function dueHtml(project, d) {
  if (!project.due) return '';
  const due = parseDate(project.due);
  const n = daysBetween(d, due);
  const date = `${MONTHS[due.getMonth()]} ${due.getDate()}`;
  if (project.state === 'done') return `<span class="due">Due ${date}</span>`;
  const when = n < 0 ? `${-n} day${n === -1 ? '' : 's'} late` : r.relDay(n);
  return `<span class="due${n <= 3 ? ' is-urgent' : ''}">Due ${date}, ${when}</span>`;
}

function renderProjects() {
  const d = now();
  const all = r.sortProjects(state.content.projects);
  const head = '<header class="head"><h1>Projects</h1></header>';
  if (!all.length) return `${head}<section class="card"><p class="empty">No projects yet. They come from your content file.</p></section>`;
  const counters = ['on-track', 'waiting', 'blocked', 'done'].map(s =>
    `<div class="counter state-${s}"><b>${all.filter(p => p.state === s).length}</b><span>${STATE_LABEL[s]}</span></div>`).join('');
  const filters = ['all', 'blocked', 'waiting', 'on-track', 'done'].map(f =>
    `<button class="chip" data-action="filter" data-filter="${f}" aria-pressed="${state.filter === f}">${f === 'all' ? 'All' : STATE_LABEL[f]}</button>`).join('');
  const shown = state.filter === 'all' ? all : all.filter(p => p.state === state.filter);
  const cards = shown.map(p => {
    const body = `<div class="proj-top"><b>${esc(p.name)}</b><span class="state">${STATE_LABEL[p.state]}</span></div>
      ${p.status ? `<p>${esc(p.status)}</p>` : ''}
      ${p.next ? `<p class="next">${icon('arrow', 16)}<span>Next: ${esc(p.next)}</span></p>` : ''}
      ${dueHtml(p, d)}
      ${p.progress != null ? `<div class="bar" role="img" aria-label="${Math.round(p.progress * 100)} percent done"><i data-css="width:${(p.progress * 100).toFixed(0)}%"></i></div>` : ''}`;
    return p.link
      ? `<a class="proj state-${p.state}" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">${body}</a>`
      : `<article class="proj state-${p.state}">${body}</article>`;
  }).join('');
  return `${head}<section class="counters" aria-label="Project counts">${counters}</section>
    <div class="filters" role="group" aria-label="Filter projects">${filters}</div>
    ${cards || '<section class="card"><p class="empty">Nothing in this group.</p></section>'}`;
}

// ---------- pages ----------
const TILE_TINT = { food: 'family', idea: 'focus', folder: 'work', hive: 'focus', book: 'home', game: 'move', bolt: 'focus', pen: 'work' };

function tilesHtml() {
  const query = state.query.trim().toLowerCase();
  const pages = state.content.pages.filter(p => !query || p.title.toLowerCase().includes(query));
  if (!pages.length) return `<section class="card"><p class="empty">${query ? 'No pages match that search.' : 'No pages yet. They come from your content file.'}</p></section>`;
  const groups = [...new Set(pages.map(p => p.group))];
  return groups.map(group => `<section><h2 class="caps">${esc(group)}</h2><div class="tiles">${pages.filter(p => p.group === group).map(p =>
    `<a class="tile" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><span class="tile-ico" data-css="--t:var(--${TILE_TINT[p.icon] ?? 'work'})">${tileIcon(p.icon)}</span><b>${esc(p.title)}</b><span>${esc(p.desc)}</span></a>`).join('')}</div></section>`).join('');
}

function renderPages() {
  const search = state.content.pages.length > 8
    ? `<label class="search">${icon('search', 18)}<input id="page-search" type="search" placeholder="Search pages" aria-label="Search pages" autocomplete="off" value="${esc(state.query)}"></label>`
    : '';
  return `<header class="head"><h1>Pages</h1></header>${search}<div id="tiles">${tilesHtml()}</div>`;
}

// ---------- settings ----------
const stamp = date => `${MONTHS[date.getMonth()]} ${date.getDate()}, ${fmtTime(date.getHours() * 60 + date.getMinutes())}`;

function renderSettings() {
  const c = state.content;
  const prefs = getPrefs();
  const connected = drive.hasToken();
  const ever = drive.everConnected();
  const account = drive.account();
  const status = demo ? 'Demo content, not signed in'
    : connected ? `Connected${account ? ` as ${esc(account)}` : ''}`
    : ever ? 'Signed out. Sync to sign in again.'
    : 'Not connected';
  const updated = c.updated && !Number.isNaN(new Date(c.updated).getTime()) ? stamp(new Date(c.updated)) : 'Unknown';
  const workouts = getWorkouts();
  const theme = prefs.theme || 'auto';
  const boxValue = state.confirm === 'boxes' && state.pendingBoxes != null ? state.pendingBoxes : getBoxes();
  return `<header class="head"><h1>Settings</h1></header>
  <section class="card"><h2 class="caps">Google Drive</h2>
    <dl class="rows"><dt>Status</dt><dd>${status}</dd><dt>Last sync</dt><dd>${state.fetchedAt ? stamp(new Date(state.fetchedAt)) : 'Never'}</dd><dt>Content updated</dt><dd>${state.hasContent ? updated : 'No content yet'}</dd></dl>
    ${state.error ? `<p class="errorbox"><b>Couldn't read today's update.</b> Showing the last good copy. ${esc(state.error)}</p>` : ''}
    <div class="actions">
      <button class="btn primary" data-action="sync">${connected || ever || demo ? 'Sync now' : 'Connect Google Drive'}</button>
      ${connected || ever ? `<button class="btn danger" data-action="disconnect">${state.confirm === 'disconnect' ? 'Tap again to disconnect' : 'Disconnect'}</button>` : ''}
    </div>
  </section>
  <section class="card"><h2 class="caps">Routines</h2>
    <form class="setting" data-form="music">
      <label for="music">"I'm home" music link</label>
      <div class="field-row"><input class="input" id="music" type="url" inputmode="url" placeholder="https://" autocomplete="off" value="${esc(prefs.musicUrl || '')}"><button class="btn" type="submit">Save</button></div>
      <p class="hint">Leave it blank to use the link in your content file${c.home.musicUrl ? '' : ' (none is set there yet)'}.</p>
    </form>
    <form class="setting" data-form="boxes">
      <label for="boxes">Boxes sorted${c.boxes.total ? ` (of ${c.boxes.total})` : ''}</label>
      <div class="field-row"><input class="input" id="boxes" type="number" inputmode="numeric" min="0" ${c.boxes.total ? `max="${c.boxes.total}"` : ''} value="${esc(boxValue)}"><button class="btn" type="submit">${state.confirm === 'boxes' ? 'Tap again to set' : 'Set'}</button></div>
    </form>
    <div class="setting">
      <p class="label">Workout streak</p>
      <p class="hint tight">${r.streak(workouts, now())} day streak, best ${r.bestStreak(workouts)}, ${workouts.length} workout${workouts.length === 1 ? '' : 's'} logged.</p>
      <button class="btn danger" data-action="reset-streak">${state.confirm === 'reset-streak' ? 'Tap again to reset' : 'Reset workout streak'}</button>
    </div>
  </section>
  <section class="card"><h2 class="caps">Theme</h2>
    <div class="seg" role="group" aria-label="Theme">${['auto', 'light', 'dark'].map(t => `<button data-action="theme" data-theme="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
  </section>
  <section class="card"><h2 class="caps">About</h2><p>Hub, version ${esc(APP_VERSION)}</p><p class="hint">What's new: ${esc(WHATS_NEW)}</p></section>`;
}

// ---------- sheets ----------
function top3Sheet(mode) {
  const d = now();
  const target = mode === 'shutdown' ? r.nextWorkday(d) : d;
  const key = `top3:${dateStr(target)}`;
  const saved = getTop3(dateStr(target));
  const title = mode === 'shutdown'
    ? `${daysBetween(d, target) === 1 ? 'Tomorrow' : DAYS[target.getDay()]}'s top 3`
    : "Today's top 3";
  const fields = [0, 1, 2].map(i => `<label class="numfield"><span>${i + 1}</span><input class="input" name="line${i}" maxlength="80" autocomplete="off" enterkeyhint="${i < 2 ? 'next' : 'done'}" aria-label="Top ${i + 1}" value="${esc(saved.lines[i])}"></label>`).join('');
  const closing = mode === 'shutdown'
    ? `<ul class="checks">${checkItem('temp', 'Close tabs and apps', false)}${checkItem('temp', 'Note where you stopped', false)}</ul>`
    : '';
  return { title, body: `<form data-form="top3" data-key="${key}" data-mode="${mode}">${fields}${closing}<button class="btn primary wide" type="submit">Save</button></form>` };
}

function eveningSheet() {
  const c = state.content;
  const d = now();
  const url = musicUrl();
  const ticks = getChecks().home ?? {};
  const list = c.home.checklist.length ? `<ul class="checks">${c.home.checklist.map(item => checkItem('home', item, ticks[item])).join('')}</ul>` : '';
  const music = url
    ? `<a class="btn go" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('music', 20)}Play music</a>`
    : '<p class="empty">Add a music link in Settings.</p>';
  return { title: `Home at ${esc(store.read(`arrival:${today()}`, ''))}`, body: `<div class="sheet-body">${music}${list}${countdownHtml(dayPlan(c, d).blocks, d)}</div>` };
}

function renderSheet() {
  const root = $('#sheet-root');
  if (!state.sheet) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }
  const { title, body } = state.sheet === 'evening' ? eveningSheet() : top3Sheet(state.sheet);
  root.hidden = false;
  setHtml(root, `<div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-head"><h2 id="sheet-title">${title}</h2><button class="iconbtn" data-action="close-sheet" aria-label="Close">${icon('close', 20)}</button></div>
      ${body}
    </div>`);
}

function openSheet(name) {
  state.sheet = name;
  renderSheet();
  ($('#sheet-root input:not([type=checkbox])') ?? $('#sheet-root .iconbtn'))?.focus({ preventScroll: true });
}

function closeSheet() {
  state.sheet = '';
  renderSheet();
}

// ---------- rendering ----------
const PAGES = { today: renderToday, projects: renderProjects, pages: renderPages, settings: renderSettings };
const TABS = [['today', 'Today'], ['projects', 'Projects'], ['pages', 'Pages'], ['settings', 'Settings']];
let lastSignature = '';

// What decides how Today looks. When it changes (a new minute, block, banner or day), redraw.
function signature() {
  const d = now();
  const m = nowMinutes(d);
  const blocks = dayPlan(state.content, d).blocks;
  const { current, next } = r.nowState(blocks, m);
  return [today(), Math.floor(m), current?.start, next?.start, r.shutdownActive(state.content.shutdown, d), r.countdownState(state.content.countdown, blocks, d)?.mode].join('|');
}

function focusKey() {
  const el = document.activeElement;
  if (!el || el === document.body || !el.dataset || !el.closest('#view, #tabs, #sheet-root')) return '';
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset.list) return `input[data-list="${CSS.escape(el.dataset.list)}"][data-item="${CSS.escape(el.dataset.item)}"]`;
  if (!el.dataset.action) return '';
  return `[data-action="${el.dataset.action}"]` + ['tab', 'filter', 'theme', 'delta', 'sheet', 'target']
    .filter(name => el.dataset[name] != null).map(name => `[data-${name}="${CSS.escape(el.dataset[name])}"]`).join('');
}

function render() {
  const key = focusKey();
  const view = $('#view');
  setHtml(view, PAGES[state.tab]());
  view.dataset.tab = state.tab;
  $('#tabs').innerHTML = TABS.map(([id, label]) => `<button data-action="tab" data-tab="${id}"${state.tab === id ? ' aria-current="page"' : ''}>${icon(id, 22)}${label}</button>`).join('');
  if (key && !document.activeElement?.closest?.('#sheet-root')) $(key)?.focus({ preventScroll: true });
  state.popped = '';
  lastSignature = signature();
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function applyTheme() {
  const theme = getPrefs().theme || 'auto';
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) $('meta[name="theme-color"]')?.setAttribute('content', bg);
}

// A second tap within four seconds confirms. The first tap only relabels the button.
let confirmTimer;
function confirmed(key) {
  clearTimeout(confirmTimer);
  if (state.confirm === key) {
    state.confirm = '';
    return true;
  }
  state.confirm = key;
  confirmTimer = setTimeout(() => {
    state.confirm = '';
    state.pendingBoxes = null;
    if (state.tab === 'settings' && !isTyping()) render();
  }, 4000);
  render();
  return false;
}

// ---------- syncing ----------
async function loadDemo() {
  const file = demo === 'local' ? 'local-content.txt' : 'sample-content.json';
  state.syncing = true;
  render();
  try {
    const response = await fetch(file, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Couldn't load ${file}.`);
    let text = await response.text();
    if (demo === 'broken') text = text.replace('"version"', 'version');
    applyText(text);
  } catch (error) {
    toast(error.message);
  } finally {
    state.syncing = false;
    render();
  }
}

let lastSyncAttempt = 0;
async function syncNow(interactive) {
  if (state.syncing) return;
  if (demo) {
    await loadDemo();
    return;
  }
  if (!navigator.onLine) {
    if (interactive) toast("You're offline. Showing the last copy.");
    return;
  }
  if (!drive.hasToken() && !interactive) return;
  lastSyncAttempt = Date.now();
  state.syncing = true;
  render();
  try {
    if (!drive.hasToken()) await drive.signIn();
    let text;
    try {
      text = await drive.fetchContentText();
    } catch (error) {
      if (error.code !== 'auth' || !interactive) throw error;
      await drive.signIn();
      text = await drive.fetchContentText();
    }
    applyText(text);
    if (interactive) toast(state.error ? "Couldn't read today's update" : 'Synced');
  } catch (error) {
    if (interactive) toast(error.message);
  } finally {
    state.syncing = false;
    render();
  }
}

// ---------- taps and typing ----------
const isTyping = () => Boolean(document.activeElement?.matches?.('input:not([type=checkbox])'));

function goTo(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  target.classList.remove('flash');
  requestAnimationFrame(() => target.classList.add('flash'));
}

const actions = {
  tab(el) {
    state.tab = el.dataset.tab;
    state.confirm = '';
    render();
    scrollTo(0, 0);
  },
  sync() {
    syncNow(true);
  },
  disconnect() {
    if (!confirmed('disconnect')) return;
    drive.disconnect();
    toast('Disconnected');
    render();
  },
  goto(el) {
    goTo(el.dataset.target);
  },
  workout() {
    const dates = getWorkouts();
    const day = today();
    store.write('workouts', dates.includes(day) ? dates.filter(d => d !== day) : [...dates, day].sort());
    render();
  },
  box(el) {
    const total = state.content.boxes.total;
    const next = Math.max(0, getBoxes() + Number(el.dataset.delta));
    store.write('boxes', total ? Math.min(total, next) : next);
    render();
  },
  sheet(el) {
    openSheet(el.dataset.sheet);
  },
  'close-sheet'() {
    closeSheet();
  },
  'dismiss-shutdown'() {
    store.write(`shutdown-dismissed:${today()}`, true);
    render();
  },
  home() {
    const d = now();
    const key = `arrival:${today()}`;
    if (!store.read(key, '')) store.write(key, fmtTime(d.getHours() * 60 + d.getMinutes()));
    const url = musicUrl();
    if (url) window.open(url, '_blank', 'noopener');
    openSheet('evening');
  },
  filter(el) {
    state.filter = el.dataset.filter;
    render();
  },
  theme(el) {
    store.write('prefs', { ...getPrefs(), theme: el.dataset.theme });
    applyTheme();
    render();
  },
  'reset-streak'() {
    if (!confirmed('reset-streak')) return;
    store.write('workouts', []);
    toast('Workout streak reset');
    render();
  },
};

const forms = {
  top3(form) {
    const key = form.dataset.key;
    const before = getTop3(key.slice(5));
    const lines = [0, 1, 2].map(i => form.elements[`line${i}`].value.trim());
    store.write(key, { lines, ticks: lines.map((line, i) => Boolean(line) && line === before.lines[i] && before.ticks[i]) });
    if (form.dataset.mode === 'shutdown') store.write(`shutdown-dismissed:${today()}`, true);
    closeSheet();
    toast('Saved');
    render();
  },
  music(form) {
    const value = form.elements.music.value.trim();
    if (value && !/^https?:\/\//i.test(value)) {
      toast('The link needs to start with https://');
      return;
    }
    store.write('prefs', { ...getPrefs(), musicUrl: value });
    toast(value ? 'Music link saved' : 'Music link cleared');
    render();
  },
  boxes(form) {
    const total = state.content.boxes.total;
    const value = Math.max(0, Math.floor(Number(form.elements.boxes.value) || 0));
    state.pendingBoxes = total ? Math.min(total, value) : value;
    if (!confirmed('boxes')) return;
    store.write('boxes', state.pendingBoxes);
    toast(`Box count set to ${state.pendingBoxes}`);
    state.pendingBoxes = null;
    render();
  },
};

let pointerDown = false;
addEventListener('pointerdown', () => { pointerDown = true; });
addEventListener('pointerup', () => { pointerDown = false; });
addEventListener('pointercancel', () => { pointerDown = false; });

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  forms[form.dataset.form]?.(form);
});

document.addEventListener('change', event => {
  const input = event.target;
  if (!input.matches?.('input[type=checkbox][data-list]')) return;
  const { list, item } = input.dataset;
  if (list === 'temp') return;
  if (list === 'top3') {
    const top = getTop3();
    top.ticks[Number(item)] = input.checked;
    store.write(`top3:${today()}`, top);
  } else {
    const checks = getChecks();
    checks[list] = { ...(checks[list] ?? {}), [item]: input.checked };
    store.write(`checks:${today()}`, checks);
  }
  state.popped = input.checked ? `${list}:${item}` : '';
  const inSheet = Boolean(input.closest('#sheet-root'));
  if (inSheet) {
    const popped = state.popped;
    renderSheet();
    $(`#sheet-root input[data-list="${CSS.escape(list)}"][data-item="${CSS.escape(item)}"]`)?.focus({ preventScroll: true });
    state.popped = popped && '';
  }
  render();
});

document.addEventListener('input', event => {
  if (event.target.id !== 'page-search') return;
  state.query = event.target.value;
  setHtml($('#tiles'), tilesHtml());
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.sheet) closeSheet();
});

// Pull down from the top of Today to sync (only when already signed in).
let pullStart = null;
let pulled = false;
addEventListener('touchstart', event => {
  pullStart = state.tab === 'today' && !state.sheet && scrollY <= 0 ? event.touches[0].clientY : null;
  pulled = false;
}, { passive: true });
addEventListener('touchmove', event => {
  if (pullStart != null && event.touches[0].clientY - pullStart > 90) pulled = true;
}, { passive: true });
addEventListener('touchend', () => {
  if (pulled && pullStart != null) {
    if (demo || drive.hasToken()) syncNow(false);
    else toast('Tap the sync chip to sign in');
  }
  pullStart = null;
  pulled = false;
});

// ---------- the clock ----------
function tick() {
  if (signature() !== lastSignature && !pointerDown && !isTyping()) {
    if (!lastSignature.startsWith(today())) store.prune(today());
    if (state.tab === 'today') render();
    else lastSignature = signature();
    if (state.sheet === 'evening') renderSheet();
  }
  const d = now();
  const cd = r.countdownState(state.content.countdown, dayPlan(state.content, d).blocks, d);
  if (cd) document.querySelectorAll('[data-cd]').forEach(el => { el.textContent = cd.mode === 'now' ? 'Now' : r.fmtCountdown(cd.seconds); });
}

setInterval(() => {
  if (!document.hidden) tick();
}, 1000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  tick();
  if (!demo && drive.hasToken() && Date.now() - lastSyncAttempt > 5 * 60_000) syncNow(false);
});
addEventListener('online', () => {
  render();
  if (!demo) drive.preload().catch(() => {});
});
addEventListener('offline', render);

// ---------- startup ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Updated');
  });
}

applyTheme();
store.prune(today());
loadSaved();
$('#home-pill').innerHTML = `${icon('home', 20)}I'm home`;
render();
setTimeout(() => document.body.classList.remove('intro'), 1100);
registerServiceWorker();
if (demo) {
  loadDemo();
} else if (navigator.onLine) {
  drive.preload().catch(() => {});
  if (drive.hasToken()) syncNow(false);
}
