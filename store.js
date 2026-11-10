// Safe localStorage. Everything lives under the "hub:" prefix. If the phone's storage fails
// (private mode, full disk), the app keeps working from memory for this session.
const PREFIX = 'hub:';
const memory = new Map();

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw != null) return JSON.parse(raw);
  } catch {
    // fall through to memory
  }
  return memory.has(key) ? memory.get(key) : fallback;
}

export function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // nothing to remove
  }
}

// Dated keys end in :YYYY-MM-DD. Keep the last `keepDays` days (and anything in the future).
export function prune(todayStr, keepDays = 14) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const cutoffDate = new Date(y, m - 1, d - keepDays);
  const cutoff = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;
  const isOld = key => {
    const match = /:(\d{4}-\d{2}-\d{2})$/.exec(key);
    return match && match[1] < cutoff;
  };
  for (const key of [...memory.keys()]) if (isOld(key)) memory.delete(key);
  try {
    const stale = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX) && isOld(key)) stale.push(key);
    }
    stale.forEach(key => localStorage.removeItem(key));
  } catch {
    // storage unavailable
  }
}
