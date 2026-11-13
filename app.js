// Startup, the four pages, the sheets and every tap. Rendering is plain template strings:
// each page is rebuilt from the saved content plus what's stored on the phone.
import { APP_NAME, APP_VERSION, CONTENT_FILE, WHATS_NEW } from './config.js';
import { dayPlan, normalize, parseRaw } from './content.js';
import * as dispatch from './dispatch.js';
import * as drive from './drive.js';
import { icon, tileIcon } from './icons.js';
import * as r from './routines.js';
import * as store from './store.js';
import { DAYS, MONTHS, addDays, dateStr, daysBetween, fmtTime, initClock, longDate, now, nowMinutes, parseDate } from './time.js';

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
  open: new Set(), // ids of the cards that are open (kept while the app is open, not saved)
  justOpened: '', // the card that just opened, so only it plays the opening animation
  ring: '', // which progress ring's details are showing: reset, streak or boxes
  counter: '', // which project count's list is showing
  papers: [], // the Dispatch papers read from the web, in the order the content file lists them
  papersAt: 0,
  papersBusy: false,
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
    state.papers = dispatch.cached(state.content.dispatch);
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
    state.papers = dispatch.cached(state.content.dispatch);
    store.write('content', { data, fetchedAt: state.fetchedAt, error: '' });
  } catch (error) {
    state.error = error.message;
    store.write('content', { ...(store.read('content', null) ?? {}), error: error.message });
  }
}

// ---------- cards that open ----------
// Every card is built the same way: a head that is always showing, then (when open) a body with
// more detail. A transparent button laid over the head does the opening, so the head can keep its
// real headings and text, and any link or checkbox inside it still works.
const KIND_LABEL = { work: 'Work', move: 'Move', home: 'Home', family: 'Family', focus: 'Focus', free: 'Free time' };
const isOpen = id => state.open.has(id);
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function xcard(id, { tag = 'section', cls = '', label, head, mid = '', body }) {
  const open = isOpen(id);
  return `<${tag} class="x${open ? ' is-open' : ''}${cls ? ` ${cls}` : ''}" id="card-${id}">
    <div class="xhead">${head}<button class="xtoggle" type="button" data-action="expand" data-id="${id}" aria-expanded="${open}"${open ? ` aria-controls="x-${id}"` : ''} aria-label="${esc(label)}"></button><span class="chev">${icon('chevron', 18)}</span></div>
    ${mid}
    ${open ? `<div class="xbody${state.justOpened === id ? ' just' : ''}" id="x-${id}">${body}</div>` : ''}
  </${tag}>`;
}

// A short list of label and value pairs for the open part of a card.
const facts = rows => `<dl class="facts">${rows.filter(Boolean).map(([label, value]) => `<dt>${esc(label)}</dt><dd>${value}</dd>`).join('')}</dl>`;
const xlinks = list => (list.length
  ? `<div class="xlinks">${list.map(item => `<a class="xlink" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.label)}${icon('external', 14)}</a>`).join('')}</div>`
  : '');
const xlist = lines => (lines.length ? `<ul class="xlist">${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : '');

// The dates shown inside cards: "Sun, Nov 15".
const shortDate = date => `${DAYS[date.getDay()].slice(0, 3)}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;

function blockFacts(block, m, blocks) {
  const status = block.end <= m ? 'Finished'
    : block.start <= m ? `In progress: ${Math.round(((m - block.start) / (block.end - block.start)) * 100)}% done, ${r.fmtDur(block.end - m)} left`
    : `Starts in ${r.fmtDur(block.start - m)}`;
  const after = blocks[blocks.indexOf(block) + 1];
  return facts([
    ['Time', `${fmtTime(block.start)} to ${fmtTime(block.end)}`],
    ['Length', r.fmtDur(block.end - block.start)],
    ['Status', status],
    ['Type', KIND_LABEL[block.kind]],
    ['Then', after ? `${esc(after.title)} at ${fmtTime(after.start)}` : 'Last block of the day'],
  ]);
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
  return `<header class="head"><div><p class="caps"><span class="brand">${icon('hive', 14)}${esc(APP_NAME)}</span>${esc(longDate(d))}</p><h1>Good ${part}${name}</h1></div>${syncChip()}</header>`;
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
    <p class="tag">Connect Google Drive to load your ${esc(APP_NAME)}.</p>
    <button class="btn primary wide" data-action="sync">Connect Google Drive</button>
  </section>`;
}

function nowCard(blocks, d, m) {
  const { current, next, done } = r.nowState(blocks, m);
  const cd = countdownHtml(blocks, d);
  if (current) {
    const fraction = (m - current.start) / (current.end - current.start);
    return xcard('now', {
      cls: `now kind-${current.kind}`,
      label: `More about ${current.title}`,
      head: `<p class="caps"><i class="pip"></i>Now</p>
      <h2>${esc(current.title)}</h2>
      ${current.detail ? `<p>${esc(current.detail)}</p>` : ''}
      <div class="bar"><i data-css="width:${(fraction * 100).toFixed(1)}%"></i></div>
      <div class="now-row"><span>${r.fmtDur(current.end - m)} left</span><span>${next ? `Next: ${esc(next.title)} ${fmtTime(next.start)}` : 'Last block today'}</span></div>
      ${cd}`,
      body: blockFacts(current, m, blocks),
    });
  }
  if (next) {
    return xcard('now', {
      cls: `now kind-${next.kind}`,
      label: `More about ${next.title}`,
      head: `<p class="caps"><i class="pip"></i>Next</p>
      <h2>${esc(next.title)}</h2>
      ${next.detail ? `<p>${esc(next.detail)}</p>` : ''}
      <div class="now-row"><span>Starts in ${r.fmtDur(next.start - m)}</span><span>${fmtTime(next.start)} to ${fmtTime(next.end)}</span></div>
      ${cd}`,
      body: blockFacts(next, m, blocks),
    });
  }
  const tomorrow = dayPlan(state.content, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)).blocks[0];
  return xcard('now', {
    cls: 'now kind-free',
    label: 'More about today',
    head: `<p class="caps"><i class="pip"></i>${done ? 'Today' : 'Open day'}</p>
    <h2>${done ? "Day's done" : 'Nothing scheduled'}</h2>
    ${tomorrow ? `<p>Tomorrow starts with ${esc(tomorrow.title)} at ${fmtTime(tomorrow.start)}.</p>` : ''}
    ${cd}`,
    body: facts([
      ['Blocks today', String(blocks.length)],
      ['Tomorrow', tomorrow ? `${esc(tomorrow.title)}, ${fmtTime(tomorrow.start)} to ${fmtTime(tomorrow.end)}` : 'Nothing planned'],
    ]),
  });
}

function timeline(blocks, m) {
  if (!blocks.length) return '';
  const start = Math.min(300, blocks[0].start);
  const end = Math.max(1320, ...blocks.map(b => b.end));
  const pct = value => (((value - start) / (end - start)) * 100).toFixed(2);
  const segments = blocks.map((b, i) =>
    `<button class="tl-seg kind-${b.kind}${b.end <= m ? ' is-past' : ''}" data-css="left:${pct(b.start)}%;width:${(((b.end - b.start) / (end - start)) * 100).toFixed(2)}%" data-action="goto" data-target="card-blk-${i}" data-open="blk-${i}" aria-label="${esc(b.title)}, ${fmtTime(b.start)} to ${fmtTime(b.end)}"></button>`).join('');
  const ticks = [[360, '6a'], [540, '9a'], [720, '12p'], [900, '3p'], [1080, '6p'], [1260, '9p']]
    .filter(([at]) => at > start && at < end)
    .map(([at, label]) => `<span data-css="left:${pct(at)}%">${label}</span>`).join('');
  const marker = m >= start && m <= end ? `<i class="tl-now" data-css="left:${pct(m)}%"></i>` : '';
  return `<section class="tl" aria-label="Day timeline"><div class="tl-track">${segments}${marker}</div><div class="tl-ticks" aria-hidden="true">${ticks}</div></section>`;
}

const RING = 2 * Math.PI * 36;
function ring(fraction, color, center, label, toggle = '') {
  const off = RING * (1 - Math.max(0, Math.min(1, fraction)));
  return `<div class="ringwrap" data-css="--rc:var(--${color})">
    <svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${esc(label)}"><circle class="ring-bg" cx="42" cy="42" r="36"/><circle class="ring-fg" cx="42" cy="42" r="36" transform="rotate(-90 42 42)" stroke-dasharray="${RING.toFixed(1)}" data-css="--off:${off.toFixed(1)}"/></svg>
    <div class="ring-center" aria-hidden="true">${center}</div>
    ${toggle}
  </div>`;
}

const ringToggle = (key, label) => `<button class="xtoggle" type="button" data-action="ring" data-ring="${key}" aria-expanded="${state.ring === key}" aria-label="${esc(label)}"></button>`;
const ringChev = key => (state.ring === key ? `<span class="chev">${icon('chevron', 14)}</span>` : '');

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
    <div class="ringcard${state.ring === 'reset' ? ' is-open' : ''}">
      ${ring(total ? done / total : 0, total && done === total ? 'ok' : 'home', `<b>${total ? `${done}/${total}` : '0'}</b><small>reset</small>`, `15-minute reset: ${done} of ${total} done`, ringToggle('reset', 'Details about the 15-minute reset'))}
      <button class="mini" data-action="goto" data-target="card-reset" data-open="reset">${total && done === total ? 'All done' : 'Open list'}</button>
      <p class="sub">${total ? (done === total ? 'Reset complete' : `${total - done} left today`) : 'No list yet'}</p>
      ${ringChev('reset')}
    </div>
    <div class="ringcard${state.ring === 'streak' ? ' is-open' : ''}">
      ${ring(week / 5, logged ? 'ok' : 'move', `<b>${streak}</b><small>day streak</small>`, `Workout streak: ${streak} ${streak === 1 ? 'day' : 'days'}. ${week} of 5 this week.`, ringToggle('streak', 'Details about your workout streak'))}
      <button class="mini${logged ? ' is-on' : ''}" data-action="workout" aria-pressed="${logged}">${logged ? `${icon('check', 14)}Done` : 'Done today'}</button>
      <p class="sub">Best ${r.bestStreak(workouts)}</p>
      ${ringChev('streak')}
    </div>
    <div class="ringcard${state.ring === 'boxes' ? ' is-open' : ''}">
      ${ring(boxTotal ? sorted / boxTotal : 0, allSorted ? 'ok' : 'focus', `<b>${boxTotal ? `${sorted}/${boxTotal}` : sorted}</b><small>sorted</small>`, `Boxes sorted: ${sorted}${boxTotal ? ` of ${boxTotal}` : ''}`, ringToggle('boxes', 'Details about the boxes'))}
      <div class="stepper">
        <button class="mini" data-action="box" data-delta="-1" aria-label="One fewer box sorted">${icon('minus', 16)}</button>
        <button class="mini" data-action="box" data-delta="1" aria-label="One more box sorted">${icon('plus', 16)}</button>
      </div>
      <p class="sub">${allSorted ? `All ${boxTotal} sorted` : estimate ? `Done about <span class="nowrap">${estimate}</span>` : 'Boxes'}</p>
      ${ringChev('boxes')}
    </div>
  </section>${ringPanel(d, { ticks, total, done, workouts, streak, week, boxTotal, sorted, estimate })}`;
}

// The details for whichever ring is open, shown under the three rings.
function ringPanel(d, v) {
  const c = state.content;
  if (!state.ring) return '';
  let title;
  let body;
  if (state.ring === 'reset') {
    const left = c.cleaning.filter(item => !v.ticks[item]);
    title = '15-minute reset';
    body = `${facts([
      ['Done', v.total ? `${v.done} of ${v.total}` : 'No list yet'],
      ['Left', left.length ? left.map(esc).join(', ') : v.total ? 'All done' : 'Nothing'],
      ['Clears', 'Every night'],
    ])}<button class="btn wide" data-action="goto" data-target="card-reset" data-open="reset">Open the list</button>`;
  } else if (state.ring === 'streak') {
    const days = [6, 5, 4, 3, 2, 1, 0].map(back => addDays(d, -back));
    const on = days.filter(day => v.workouts.includes(dateStr(day))).length;
    title = 'Workout streak';
    body = `${facts([
      ['Streak', `${v.streak} ${v.streak === 1 ? 'day' : 'days'}`],
      ['Best', `${r.bestStreak(v.workouts)} days`],
      ['This week', `${v.week} of 5`],
      ['Logged in all', String(v.workouts.length)],
    ])}<div class="weekdots" role="img" aria-label="Last seven days: ${on} workouts">${days.map((day, i) =>
      `<span class="wd${v.workouts.includes(dateStr(day)) ? ' on' : ''}${i === 6 ? ' today' : ''}"><i></i>${DAYS[day.getDay()][0]}</span>`).join('')}</div>`;
  } else {
    const left = v.boxTotal ? Math.max(0, v.boxTotal - v.sorted) : 0;
    const per = c.boxes.perWeekend;
    title = 'Boxes';
    body = facts([
      ['Sorted', v.boxTotal ? `${v.sorted} of ${v.boxTotal}` : String(v.sorted)],
      v.boxTotal ? ['Left', String(left)] : null,
      per ? ['Pace', `${per} a weekend`] : null,
      per && left ? ['Weekends to go', String(Math.ceil(left / per))] : null,
      v.estimate ? ['Done about', esc(v.estimate)] : null,
    ]);
  }
  return `<section class="card ringpanel" id="ring-panel"><div class="card-head"><h2 class="caps">${title}</h2><button class="link" data-action="ring" data-ring="${state.ring}">Close</button></div>${body}</section>`;
}

function blockList(blocks, m) {
  if (!blocks.length) return '';
  const rows = blocks.map((b, i) => xcard(`blk-${i}`, {
    tag: 'li',
    cls: `blk kind-${b.kind}${b.end <= m ? ' is-past' : ''}${b.start <= m && m < b.end ? ' is-now' : ''}`,
    label: `More about ${b.title}`,
    head: `<time>${fmtTime(b.start)}</time><i class="pip"></i>
    <div><b>${esc(b.title)}</b>${b.detail ? `<span class="blk-detail">${esc(b.detail)}</span>` : ''}</div>`,
    body: blockFacts(b, m, blocks),
  })).join('');
  return `<section class="card"><h2 class="caps">Today's plan</h2><ol class="blocks">${rows}</ol></section>`;
}

function checkItem(list, key, checked, label = key) {
  const id = `${list}:${key}`;
  return `<li><label class="chk${state.popped === id ? ' just' : ''}"><input type="checkbox" data-list="${list}" data-item="${esc(key)}"${checked ? ' checked' : ''}><span class="box">${icon('check', 16)}</span><span class="txt">${esc(label)}</span></label></li>`;
}

const DAYS_LABEL = { every: 'every day', weekdays: 'weekdays', weekends: 'weekends' };

function top3Card(d) {
  const top = getTop3();
  const shutdown = state.content.shutdown;
  const items = top.lines.map((line, i) => (line ? checkItem('top3', String(i), top.ticks[i], line) : '')).join('');
  const empty = shutdown ? `Set at ${fmtTime(shutdown.time).replace(/ [AP]M$/, '')} shutdown` : 'Nothing set for today yet';
  const target = r.nextWorkday(d);
  const later = getTop3(dateStr(target)).lines.filter(Boolean);
  const set = top.lines.filter(Boolean).length;
  const ticked = top.lines.filter((line, i) => line && top.ticks[i]).length;
  return xcard('top3', {
    cls: 'card',
    label: 'More about your top 3',
    head: '<div class="card-head"><h2 class="caps">Top 3 today</h2><button class="link" data-action="sheet" data-sheet="top3">Edit</button></div>',
    mid: items ? `<ul class="checks">${items}</ul>` : `<p class="empty">${empty}</p>`,
    body: facts([
      ['Done', set ? `${ticked} of ${set}` : 'Nothing set yet'],
      [daysBetween(d, target) === 1 ? 'Tomorrow' : DAYS[target.getDay()], later.length ? later.map(esc).join('<br>') : 'Not written yet. Write them at shutdown.'],
      shutdown ? ['Shutdown', `${fmtTime(shutdown.time)}, ${DAYS_LABEL[shutdown.days]}`] : null,
    ]),
  });
}

function resetCard() {
  const items = state.content.cleaning;
  if (!items.length) return '';
  const ticks = getChecks().reset ?? {};
  const left = items.filter(item => !ticks[item]);
  return xcard('reset', {
    cls: 'card',
    label: 'More about the 15-minute reset',
    head: '<h2 class="caps">15-minute reset</h2>',
    mid: `<ul class="checks">${items.map(item => checkItem('reset', item, ticks[item])).join('')}</ul>`,
    body: facts([
      ['Done', `${items.length - left.length} of ${items.length}`],
      ['Left', left.length ? left.map(esc).join(', ') : 'All done'],
      ['Clears', 'Every night'],
    ]),
  });
}

function upcomingCard(d) {
  const items = r.upcoming(state.content.upcoming, d).slice(0, 5);
  if (!items.length) return '';
  const rows = items.map((item, i) => {
    const start = parseDate(item.date);
    const end = parseDate(item.end);
    const ranged = item.end !== item.date;
    const through = ranged ? `, through ${MONTHS[end.getMonth()]} ${end.getDate()}` : '';
    return xcard(`up-${i}`, {
      tag: 'li',
      cls: `up kind-${item.kind}`,
      label: `More about ${item.title}`,
      head: `<div class="cal"><small>${MONTHS[start.getMonth()]}</small><b>${start.getDate()}</b></div><div class="up-main"><b>${esc(item.title)}</b><span>${item.when}${through}</span></div>`,
      body: `${facts([
        ['When', ranged ? `${shortDate(start)} to ${shortDate(end)}` : shortDate(start)],
        ranged ? ['Length', `${daysBetween(start, end) + 1} days`] : null,
        ['Away', item.days < 0 ? 'Happening now' : item.when],
        ['Type', KIND_LABEL[item.kind]],
      ])}${item.detail ? `<p class="xnote">${esc(item.detail)}</p>` : ''}`,
    });
  }).join('');
  return `<section class="card"><h2 class="caps">Coming up</h2><ul>${rows}</ul></section>`;
}

// The Dispatch line: one headline per paper. Open one for the summary and the sources it was written from.
function dispatchCard() {
  const entries = state.content.dispatch;
  if (!entries.length) return '';
  const papers = state.papers.length === entries.length ? state.papers : dispatch.cached(entries);
  const rows = papers.map(({ entry, paper, failed }, i) => {
    if (!paper) {
      const message = state.papersBusy ? 'Loading...' : failed ? "Couldn't load it. Tap to try again." : 'Tap to load.';
      return `<li><button class="dprow" type="button" data-action="dispatch-retry"><span class="dp-name">${esc(entry.name)}</span><span class="dp-line">${message}</span></button></li>`;
    }
    const old = Boolean(paper.date) && paper.date !== today();
    const note = paper.date ? (old ? `Edition of ${shortDate(parseDate(paper.date))}` : 'Today') : '';
    const sources = paper.sources.length ? `<p class="caps tiny">Sources</p>${xlinks(paper.sources.map(s => ({ label: s.name, url: s.url })))}` : '';
    return xcard(`dp-${i}`, {
      tag: 'li',
      cls: 'dp',
      label: `More about the ${entry.name} headline`,
      head: `<span class="dp-name">${esc(entry.name)}${note ? `<small class="${old || failed ? 'is-old' : ''}">${esc(note)}${failed ? ', saved copy' : ''}</small>` : ''}</span><b class="dp-line">${esc(paper.headline)}</b>`,
      body: `${paper.dek ? `<p class="xnote">${esc(paper.dek)}</p>` : ''}${paper.bottom ? `<p class="xnote">${esc(paper.bottom)}</p>` : ''}${sources}<a class="btn wide" href="${esc(dispatch.paperPage(entry))}" target="_blank" rel="noopener noreferrer">Open ${esc(entry.name)}${icon('external', 16)}</a>`,
    });
  }).join('');
  return `<section class="card dispatch"><h2 class="caps">Dispatch</h2><ul class="dplist">${rows}</ul></section>`;
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
    dispatchCard(),
    top3Card(d),
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

function projectCard(p, d) {
  const id = `p-${slug(p.name)}`;
  const due = p.due ? parseDate(p.due) : null;
  const n = due ? daysBetween(d, due) : 0;
  const web = [...(p.link && !p.links.some(item => item.url === p.link) ? [{ label: 'Open', url: p.link }] : []), ...p.links];
  const updated = state.content.updated && !Number.isNaN(new Date(state.content.updated).getTime()) ? stamp(new Date(state.content.updated)) : '';
  return xcard(id, {
    tag: 'article',
    cls: `proj state-${p.state}`,
    label: `More about ${p.name}`,
    head: `<div class="proj-top"><b>${esc(p.name)}</b><span class="state">${STATE_LABEL[p.state]}</span></div>
      ${p.status ? `<p>${esc(p.status)}</p>` : ''}
      ${p.next ? `<p class="next">${icon('arrow', 16)}<span>Next: ${esc(p.next)}</span></p>` : ''}
      ${dueHtml(p, d)}
      ${p.progress != null ? `<div class="bar" role="img" aria-label="${Math.round(p.progress * 100)} percent done"><i data-css="width:${(p.progress * 100).toFixed(0)}%"></i></div>` : ''}`,
    body: `${xlist(p.detail)}${facts([
      ['State', STATE_LABEL[p.state]],
      p.progress != null ? ['Progress', `${Math.round(p.progress * 100)}%`] : null,
      due ? ['Due', `${shortDate(due)}, ${p.state === 'done' ? 'done' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} late` : r.relDay(n)}`] : null,
      updated ? ['Info from', `your content file, ${esc(updated)}`] : null,
    ])}${xlinks(web)}`,
  });
}

function renderProjects() {
  const d = now();
  const all = r.sortProjects(state.content.projects);
  const head = '<header class="head"><h1>Projects</h1></header>';
  if (!all.length) return `${head}<section class="card"><p class="empty">No projects yet. They come from your content file.</p></section>`;
  const counters = ['on-track', 'waiting', 'blocked', 'done'].map(s =>
    `<button class="counter state-${s}${state.counter === s ? ' is-open' : ''}" type="button" data-action="counter" data-counter="${s}" aria-expanded="${state.counter === s}"><b>${all.filter(p => p.state === s).length}</b><span>${STATE_LABEL[s]}</span></button>`).join('');
  const names = state.counter ? all.filter(p => p.state === state.counter) : [];
  const panel = state.counter
    ? `<section class="card counterpanel"><div class="card-head"><h2 class="caps">${STATE_LABEL[state.counter]}</h2><button class="link" data-action="counter" data-counter="${state.counter}">Close</button></div>${names.length
      ? names.map(p => `<button class="rowbtn" type="button" data-action="open-project" data-id="p-${slug(p.name)}"><b>${esc(p.name)}</b><span>${esc(p.next || p.status)}</span></button>`).join('')
      : '<p class="empty">Nothing here.</p>'}</section>`
    : '';
  const filters = ['all', 'blocked', 'waiting', 'on-track', 'done'].map(f =>
    `<button class="chip" data-action="filter" data-filter="${f}" aria-pressed="${state.filter === f}">${f === 'all' ? 'All' : STATE_LABEL[f]}</button>`).join('');
  const shown = state.filter === 'all' ? all : all.filter(p => p.state === state.filter);
  const cards = shown.map(p => projectCard(p, d)).join('');
  return `${head}<section class="counters" aria-label="Project counts">${counters}</section>${panel}
    <div class="filters" role="group" aria-label="Filter projects">${filters}</div>
    ${cards || '<section class="card"><p class="empty">Nothing in this group.</p></section>'}`;
}

// ---------- pages ----------
const TILE_TINT = { food: 'family', idea: 'focus', folder: 'work', hive: 'focus', book: 'home', game: 'move', bolt: 'focus', pen: 'work', news: 'family' };

const hostOf = url => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function tilesHtml() {
  const query = state.query.trim().toLowerCase();
  const pages = state.content.pages.filter(p => !query || p.title.toLowerCase().includes(query));
  if (!pages.length) return `<section class="card"><p class="empty">${query ? 'No pages match that search.' : 'No pages yet. They come from your content file.'}</p></section>`;
  const groups = [...new Set(pages.map(p => p.group))];
  return groups.map(group => `<section><h2 class="caps">${esc(group)}</h2><div class="tiles">${pages.filter(p => p.group === group).map(p => xcard(`t-${slug(p.group)}-${slug(p.title)}`, {
    tag: 'div',
    cls: 'tile',
    label: `More about ${p.title}`,
    head: `<span class="tile-ico" data-css="--t:var(--${TILE_TINT[p.icon] ?? 'work'})">${tileIcon(p.icon)}</span><b>${esc(p.title)}</b><span class="tile-desc">${esc(p.desc)}</span><a class="tile-go" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(p.title)}">${icon('external', 18)}</a>`,
    body: `${xlist(p.detail)}${facts([['Group', esc(p.group)], ['Opens', esc(hostOf(p.url))]])}<div class="xactions"><a class="btn primary small" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open${icon('external', 16)}</a><button class="btn small" type="button" data-action="copy" data-url="${esc(p.url)}">${icon('copy', 16)}Copy link</button></div>`,
  })).join('')}</div></section>`).join('');
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
  const read = state.papers.filter(item => item.fetchedAt).map(item => item.fetchedAt);
  const papers = c.dispatch.length
    ? `${c.dispatch.length} (${c.dispatch.map(item => esc(item.name)).join(', ')}), ${read.length ? `last read ${stamp(new Date(Math.max(...read)))}` : 'not read yet'}`
    : 'None listed in your content file';
  const drivePart = xcard('drive', {
    cls: 'card',
    label: 'More about the Google Drive link',
    head: '<h2 class="caps">Google Drive</h2>',
    mid: `<dl class="rows"><dt>Status</dt><dd>${status}</dd><dt>Last sync</dt><dd>${state.fetchedAt ? stamp(new Date(state.fetchedAt)) : 'Never'}</dd><dt>Content updated</dt><dd>${state.hasContent ? updated : 'No content yet'}</dd></dl>
    ${state.error ? `<p class="errorbox"><b>Couldn't read today's update.</b> Showing the last good copy. ${esc(state.error)}</p>` : ''}
    <div class="actions">
      <button class="btn primary" data-action="sync">${connected || ever || demo ? 'Sync now' : 'Connect Google Drive'}</button>
      ${connected || ever ? `<button class="btn danger" data-action="disconnect">${state.confirm === 'disconnect' ? 'Tap again to disconnect' : 'Disconnect'}</button>` : ''}
    </div>`,
    body: facts([
      ['Reads', `One Google Doc named ${esc(CONTENT_FILE)}, read-only`],
      ['In it', `${c.projects.length} projects, ${c.pages.length} pages, ${c.upcoming.length} coming up`],
      ['Dispatch', papers],
      ['Sign-in', 'Kept on this phone only, until it runs out or you disconnect'],
    ]),
  });
  const aboutPart = xcard('about', {
    cls: 'card',
    label: 'More about this app',
    head: `<h2 class="caps">About</h2><p>${esc(APP_NAME)}, version ${esc(APP_VERSION)}</p>`,
    body: facts([
      ["What's new", esc(WHATS_NEW)],
      ['Saved here', 'Your ticks, streak, box count and top 3 lines stay on this phone. They are not synced.'],
      ['Offline', 'The app and your last content copy open without a connection.'],
      ['Content version', String(c.version)],
    ]),
  });
  return `<header class="head"><h1>Settings</h1></header>
  ${drivePart}
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
  ${aboutPart}`;
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
  return `[data-action="${el.dataset.action}"]` + ['tab', 'filter', 'theme', 'delta', 'sheet', 'target', 'id', 'ring', 'counter']
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
// The Dispatch papers are public web pages, so reading them needs no sign-in. A paper that can't
// be read keeps its last good copy on screen.
async function refreshPapers(interactive = false) {
  const entries = state.content.dispatch;
  if (!entries.length || state.papersBusy) return;
  if (!navigator.onLine) {
    if (interactive) toast("You're offline. Showing the last copy.");
    return;
  }
  state.papersBusy = true;
  if (!isTyping()) render();
  try {
    state.papers = await dispatch.loadAll(entries);
    state.papersAt = Date.now();
    if (interactive && state.papers.some(item => item.failed)) toast("Couldn't load every paper");
  } finally {
    state.papersBusy = false;
    if (!isTyping()) render();
  }
}

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
    refreshPapers();
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
    refreshPapers();
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
    const open = el.dataset.open;
    if (open && !state.open.has(open)) {
      state.open.add(open);
      state.justOpened = open;
      render();
      state.justOpened = '';
    }
    goTo(el.dataset.target);
  },
  expand(el) {
    const id = el.dataset.id;
    if (state.open.has(id)) {
      state.open.delete(id);
    } else {
      state.open.add(id);
      state.justOpened = id;
    }
    render();
    state.justOpened = '';
    document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  },
  ring(el) {
    state.ring = state.ring === el.dataset.ring ? '' : el.dataset.ring;
    render();
    if (state.ring) document.getElementById('ring-panel')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  },
  counter(el) {
    state.counter = state.counter === el.dataset.counter ? '' : el.dataset.counter;
    render();
  },
  'open-project'(el) {
    const id = el.dataset.id;
    state.filter = 'all';
    state.counter = '';
    state.open.add(id);
    state.justOpened = id;
    render();
    state.justOpened = '';
    goTo(`card-${id}`);
  },
  async copy(el) {
    try {
      await navigator.clipboard.writeText(el.dataset.url);
      toast('Link copied');
    } catch {
      toast("Couldn't copy the link");
    }
  },
  'dispatch-retry'() {
    refreshPapers(true);
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
  if (Date.now() - state.papersAt > 20 * 60_000) refreshPapers();
});
addEventListener('online', () => {
  render();
  if (!demo) drive.preload().catch(() => {});
  refreshPapers();
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
  refreshPapers();
}
