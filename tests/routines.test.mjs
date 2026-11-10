import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as r from '../routines.js';
import { dateStr, fmtTime, initClock, minutesOf, now } from '../time.js';

const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi);
const blocks = [
  { start: 420, end: 885, title: 'Work' },
  { start: 885, end: 900, title: 'Shutdown' },
  { start: 1020, end: 1140, title: 'Family' },
];

test('time helpers', () => {
  assert.equal(minutesOf('14:45'), 885);
  assert.equal(minutesOf('7:05'), 425);
  assert.equal(minutesOf('25:00'), null);
  assert.equal(minutesOf('noon'), null);
  assert.equal(fmtTime(900), '3:00 PM');
  assert.equal(fmtTime(0), '12:00 AM');
  assert.equal(fmtTime(725), '12:05 PM');
  assert.equal(dateStr(at(2026, 1, 3)), '2026-01-03');
});

test('the ?now= flag fakes the clock', () => {
  initClock('?demo=1&now=2026-11-10T14:50');
  const fake = now();
  assert.equal(dateStr(fake), '2026-11-10');
  assert.equal(fake.getHours(), 14);
  assert.equal(fake.getMinutes(), 50);
});

test('nowState finds the current and next block', () => {
  assert.equal(r.nowState(blocks, 600).current.title, 'Work');
  assert.equal(r.nowState(blocks, 600).next.title, 'Shutdown');
  const between = r.nowState(blocks, 950);
  assert.equal(between.current, null);
  assert.equal(between.next.title, 'Family');
  assert.equal(between.done, false);
  assert.equal(r.nowState(blocks, 1200).done, true);
  assert.equal(r.nowState([], 600).done, false);
});

test('the countdown counts down, reads "now" during its block, then hides', () => {
  const cd = { label: 'Family', time: 1020, days: 'every' };
  assert.deepEqual(r.countdownState(cd, blocks, at(2026, 11, 10, 15, 18)), { mode: 'count', seconds: 6120 });
  assert.equal(r.countdownState(cd, blocks, at(2026, 11, 10, 17, 30)).mode, 'now');
  assert.equal(r.countdownState(cd, blocks, at(2026, 11, 10, 19, 0)), null);
  assert.equal(r.countdownState({ ...cd, days: 'weekends' }, blocks, at(2026, 11, 10, 15, 0)), null);
  assert.equal(r.countdownState(null, blocks, at(2026, 11, 10, 15, 0)), null);
  assert.equal(r.fmtCountdown(6120), '1h 42m');
  assert.equal(r.fmtCountdown(125), '2m 05s');
});

test('fmtDur reads naturally', () => {
  assert.equal(r.fmtDur(37.2), '38 min');
  assert.equal(r.fmtDur(60), '1 hr');
  assert.equal(r.fmtDur(125), '2 hr 5 min');
});

test('the shutdown window lasts 15 minutes on matching days', () => {
  const sd = { time: 885, days: 'weekdays' };
  assert.equal(r.shutdownActive(sd, at(2026, 11, 10, 14, 44)), false);
  assert.equal(r.shutdownActive(sd, at(2026, 11, 10, 14, 45)), true);
  assert.equal(r.shutdownActive(sd, at(2026, 11, 10, 14, 50)), true);
  assert.equal(r.shutdownActive(sd, at(2026, 11, 10, 15, 0)), false);
  assert.equal(r.shutdownActive(sd, at(2026, 11, 14, 14, 50)), false); // Saturday
  assert.equal(r.shutdownActive(null, at(2026, 11, 10, 14, 50)), false);
});

test("Friday's shutdown saves for Monday", () => {
  assert.equal(dateStr(r.nextWorkday(at(2026, 11, 10))), '2026-11-11'); // Tuesday to Wednesday
  assert.equal(dateStr(r.nextWorkday(at(2026, 11, 13))), '2026-11-16'); // Friday to Monday
  assert.equal(dateStr(r.nextWorkday(at(2026, 11, 14))), '2026-11-16'); // Saturday to Monday
});

test('the workout streak counts back from today or yesterday', () => {
  const tue = at(2026, 11, 10);
  assert.equal(r.streak([], tue), 0);
  assert.equal(r.streak(['2026-11-10'], tue), 1);
  assert.equal(r.streak(['2026-11-09'], tue), 1); // today not logged yet
  assert.equal(r.streak(['2026-11-06'], tue), 0); // Monday was missed
  assert.equal(r.streak(['2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10'], tue), 4);
});

test('weekends never break a streak, and count when logged', () => {
  const mon = at(2026, 11, 9);
  assert.equal(r.streak(['2026-11-05', '2026-11-06'], mon), 2); // Thu, Fri, then an empty weekend
  assert.equal(r.streak(['2026-11-06', '2026-11-07', '2026-11-09'], mon), 3); // Saturday counts
  assert.equal(r.streak(['2026-11-04', '2026-11-06'], mon), 1); // Thursday missed
});

test('best streak and this week\'s count', () => {
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-10'];
  assert.equal(r.bestStreak(dates), 3);
  assert.equal(r.bestStreak([]), 0);
  assert.equal(r.weekCount(dates, at(2026, 11, 10)), 2);
  assert.equal(r.weekCount(dates, at(2026, 11, 8)), 4); // Sunday belongs to the week that started Nov 2
});

test('the box estimate lands on the right part of the month', () => {
  assert.equal(r.boxEstimate(0, 50, 5, at(2026, 11, 10)), 'mid-Jan'); // 10 weekends from Nov 14
  assert.equal(r.boxEstimate(45, 50, 5, at(2026, 11, 10)), 'mid-Nov');
  assert.equal(r.boxEstimate(45, 50, 5, at(2026, 11, 15)), 'mid-Nov'); // Sunday still counts this weekend
  assert.equal(r.boxEstimate(50, 50, 5, at(2026, 11, 10)), '');
  assert.equal(r.boxEstimate(0, 50, 0, at(2026, 11, 10)), '');
});

test('upcoming hides past items and keeps multi-day ones until they end', () => {
  const items = [
    { date: '2026-11-01', end: '2026-11-01', title: 'Past' },
    { date: '2026-11-08', end: '2026-11-12', title: 'Trip' },
    { date: '2026-11-10', end: '2026-11-10', title: 'Deadline' },
    { date: '2026-11-11', end: '2026-11-11', title: 'Soon' },
    { date: '2026-11-15', end: '2026-11-15', title: 'Later' },
  ];
  const shown = r.upcoming(items, at(2026, 11, 10));
  assert.deepEqual(shown.map(i => [i.title, i.when]), [
    ['Trip', 'now'],
    ['Deadline', 'today'],
    ['Soon', 'tomorrow'],
    ['Later', 'in 5 days'],
  ]);
});

test('projects sort by attention needed, then due date', () => {
  const sorted = r.sortProjects([
    { name: 'done', state: 'done' },
    { name: 'on', state: 'on-track' },
    { name: 'wait-late', state: 'waiting', due: '2027-01-03' },
    { name: 'blocked', state: 'blocked' },
    { name: 'wait-soon', state: 'waiting', due: '2026-11-15' },
    { name: 'wait-none', state: 'waiting' },
  ]);
  assert.deepEqual(sorted.map(p => p.name), ['blocked', 'wait-soon', 'wait-late', 'wait-none', 'on', 'done']);
});
