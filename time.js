// Clock and date helpers. Every "what time is it" question goes through now(), so the
// ?now=YYYY-MM-DDTHH:MM flag can fake the clock for testing time-based screens.
let offset = 0;

export function initClock(search = '') {
  const match = /[?&]now=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(search);
  if (!match) return;
  const fake = new Date(match[1]).getTime();
  if (!Number.isNaN(fake)) offset = fake - Date.now();
}

export const now = () => new Date(Date.now() + offset);

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;
export const daysBetween = (a, b) =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);

// "HH:MM" (24-hour) to minutes after midnight, or null if it isn't a time.
export function minutesOf(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(typeof hhmm === 'string' ? hhmm.trim() : '');
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

// Minutes after midnight, with seconds as a fraction.
export const nowMinutes = d => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

// Minutes after midnight to "3:00 PM".
export function fmtTime(mins) {
  const whole = Math.floor(mins);
  const h = Math.floor(whole / 60) % 24;
  return `${h % 12 || 12}:${pad(whole % 60)} ${h < 12 ? 'AM' : 'PM'}`;
}

export const longDate = d => `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
