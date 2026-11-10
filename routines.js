// The built-in routines, as plain functions with no AI and no storage: what's on now, the
// countdown, the shutdown window, the workout streak, the box estimate and what's coming up.
import { MONTHS, addDays, dateStr, daysBetween, isWeekend, nowMinutes, pad, parseDate } from './time.js';

export function matchesDays(days, date) {
  if (days === 'weekdays') return !isWeekend(date);
  if (days === 'weekends') return isWeekend(date);
  return true;
}

// The block happening at minute m (if any) and the next one to start.
export function nowState(blocks, m) {
  const current = blocks.find(b => b.start <= m && m < b.end) ?? null;
  const next = blocks.find(b => b.start > m) ?? null;
  return { current, next, done: blocks.length > 0 && !current && !next };
}

// Counting down before the time, "now" during the block that starts at that time, then hidden.
export function countdownState(countdown, blocks, date) {
  if (!countdown || !matchesDays(countdown.days, date)) return null;
  const m = nowMinutes(date);
  if (m < countdown.time) return { mode: 'count', seconds: Math.max(0, Math.round((countdown.time - m) * 60)) };
  const block = blocks.find(b => b.start === countdown.time);
  const end = block ? block.end : countdown.time + 60;
  return m < end ? { mode: 'now', seconds: 0 } : null;
}

export function fmtCountdown(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m ${pad(s)}s`;
}

export function fmtDur(mins) {
  const whole = Math.max(0, Math.ceil(mins));
  if (whole < 60) return `${whole} min`;
  const m = whole % 60;
  return m ? `${Math.floor(whole / 60)} hr ${m} min` : `${Math.floor(whole / 60)} hr`;
}

// The shutdown banner shows from the shutdown time until 15 minutes after, on matching days.
export function shutdownActive(shutdown, date) {
  if (!shutdown || !matchesDays(shutdown.days, date)) return false;
  const m = nowMinutes(date);
  return m >= shutdown.time && m < shutdown.time + 15;
}

// Friday's shutdown saves for Monday.
export function nextWorkday(date) {
  let next = addDays(date, 1);
  while (isWeekend(next)) next = addDays(next, 1);
  return next;
}

// Consecutive workout days counted back from today (or from yesterday if today isn't logged yet).
// Saturdays and Sundays never break a streak; they count if logged.
export function streak(dates, today) {
  const logged = new Set(dates);
  if (!logged.size) return 0;
  const earliest = [...logged].sort()[0];
  let cursor = logged.has(dateStr(today)) ? today : addDays(today, -1);
  let total = 0;
  while (dateStr(cursor) >= earliest) {
    if (logged.has(dateStr(cursor))) total += 1;
    else if (!isWeekend(cursor)) break;
    cursor = addDays(cursor, -1);
  }
  return total;
}

export function bestStreak(dates) {
  const sorted = [...new Set(dates)].sort();
  if (!sorted.length) return 0;
  const logged = new Set(sorted);
  const last = sorted.at(-1);
  let best = 0;
  let run = 0;
  for (let cursor = parseDate(sorted[0]); dateStr(cursor) <= last; cursor = addDays(cursor, 1)) {
    if (logged.has(dateStr(cursor))) {
      run += 1;
      best = Math.max(best, run);
    } else if (!isWeekend(cursor)) {
      run = 0;
    }
  }
  return best;
}

// Workout days logged in this week, Monday to Sunday.
export function weekCount(dates, today) {
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const from = dateStr(monday);
  const to = dateStr(addDays(monday, 6));
  return new Set(dates.filter(d => d >= from && d <= to)).size;
}

// "mid-Jan": when the boxes run out at perWeekend boxes each weekend, counting weekends from today.
export function boxEstimate(sorted, total, perWeekend, today) {
  const remaining = total - sorted;
  if (remaining <= 0 || !perWeekend) return '';
  const weekends = Math.ceil(remaining / perWeekend);
  const day = today.getDay();
  const firstSaturday = day === 0 ? addDays(today, -1) : addDays(today, 6 - day);
  const finish = addDays(firstSaturday, (weekends - 1) * 7);
  const part = finish.getDate() <= 10 ? 'early' : finish.getDate() <= 20 ? 'mid' : 'late';
  return `${part}-${MONTHS[finish.getMonth()]}`;
}

// Upcoming items that haven't ended, soonest first, each with a short "when" label.
export function upcoming(items, today) {
  const todayStr = dateStr(today);
  return items
    .filter(item => item.end >= todayStr)
    .map(item => {
      const n = daysBetween(today, parseDate(item.date));
      const when = n < 0 ? 'now' : relDay(n);
      return { ...item, when, days: n };
    });
}

export function relDay(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// Projects sorted by how much attention they need, then by due date.
export function sortProjects(projects) {
  const order = { blocked: 0, waiting: 1, 'on-track': 2, done: 3 };
  return [...projects].sort(
    (a, b) => order[a.state] - order[b.state] || (a.due || '9999').localeCompare(b.due || '9999'),
  );
}
