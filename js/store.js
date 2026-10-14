/* Winter Arc — state, persistence and date helpers.
 * Everything lives in localStorage on this device; nothing is sent anywhere. */
(function (root) {
  const WA = (root.WA = root.WA || {});
  const KEY = 'winterarc.v1';

  // ---------- dates (always local calendar days, 'YYYY-MM-DD') ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (s, n) => {
    const d = parse(s);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const today = () => iso(new Date());
  const range = (from, to) => {
    const out = [];
    for (let s = from; s <= to; s = addDays(s, 1)) out.push(s);
    return out;
  };
  // Monday-based week start
  const weekStart = (s) => {
    const d = parse(s);
    const dow = (d.getDay() + 6) % 7;
    return addDays(s, -dow);
  };
  const fmt = (s, opts) => parse(s).toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric' });
  WA.date = { iso, parse, addDays, diffDays, today, range, weekStart, fmt };

  // ---------- defaults ----------
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  WA.uid = uid;

  function defaultState() {
    const y = new Date().getFullYear();
    return {
      version: 1,
      challenge: {
        name: 'Winter Arc',
        start: `${y}-10-01`,
        end: `${y}-12-31`,
      },
      habits: [
        { id: 'workout', name: 'Train', icon: '🏋️', kind: 'check', auto: 'workout' },
        { id: 'steps', name: 'Steps', icon: '👟', kind: 'target', target: 10000, unit: 'steps', metric: 'steps' },
        { id: 'sleep', name: 'Sleep', icon: '🌙', kind: 'target', target: 7.5, unit: 'h', metric: 'sleepHrs' },
        { id: 'water', name: 'Water', icon: '💧', kind: 'target', target: 3, unit: 'L' },
        { id: 'read', name: 'Read 10 pages', icon: '📖', kind: 'check' },
        { id: 'clean', name: 'No junk food', icon: '🥦', kind: 'check' },
        { id: 'cold', name: 'Cold shower', icon: '🧊', kind: 'check' },
      ],
      days: {}, // date -> { habits: {id: true|number}, note }
      workouts: [], // {id,date,type,duration,rpe,calories,distance,notes,source, exercises:[{name,sets,reps,weight}]}
      health: {}, // date -> { steps, activeEnergy, exerciseMin, restingHR, hrv, sleepHrs, weight, distanceKm, calories, protein }
      healthMeta: { lastImport: null, source: null, records: 0 },
      plans: {}, // weekStart -> { focus: habitId, days: ['Mon','Wed'], types: {Mon:'Strength'}, note }
      reviews: {}, // weekStart -> { worked, change, done: true }
      settings: { reminderTime: '07:00', notify: false, lastDuration: {}, goals: { calories: null, protein: null, goalWeight: null } },
    };
  }
  WA.defaultState = defaultState;

  // ---------- persistence ----------
  let state;
  const listeners = new Set();

  function load() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(KEY);
      state = raw ? migrate(JSON.parse(raw)) : defaultState();
    } catch (e) {
      console.warn('Could not read saved data, starting fresh', e);
      state = defaultState();
    }
    return state;
  }

  function migrate(s) {
    const d = defaultState();
    return {
      ...d,
      ...s,
      challenge: { ...d.challenge, ...(s.challenge || {}) },
      settings: { ...d.settings, ...(s.settings || {}), goals: { ...d.settings.goals, ...((s.settings || {}).goals || {}) }, lastDuration: { ...((s.settings || {}).lastDuration || {}) } },
      plans: s.plans || {},
      reviews: s.reviews || {},
      healthMeta: { ...d.healthMeta, ...(s.healthMeta || {}) },
    };
  }

  function save() {
    try {
      root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      (root.WA.ui ? root.WA.ui.tell : alert)('Could not save. Storage may be full; export a backup from Settings.');
    }
    listeners.forEach((fn) => fn(state));
  }

  WA.store = {
    load,
    save,
    get: () => state || load(),
    set(next) {
      state = migrate(next);
      save();
    },
    reset() {
      state = defaultState();
      save();
    },
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    update(fn) {
      fn(state);
      save();
    },
  };

  // ---------- derived data ----------
  const dayEntry = (s, date) => (s.days[date] = s.days[date] || { habits: {}, note: '' });
  WA.dayEntry = dayEntry;

  const workoutsOn = (s, date) => s.workouts.filter((w) => w.date === date);
  WA.workoutsOn = workoutsOn;

  /** Is a habit done on a date? Manual entries win; otherwise derive from health data / workouts. */
  function habitDone(s, h, date) {
    const v = s.days[date] && s.days[date].habits[h.id];
    if (h.kind === 'check') {
      if (v === true) return true;
      if (v === false) return false;
      if (h.auto === 'workout') return workoutsOn(s, date).length > 0;
      return false;
    }
    const val = habitValue(s, h, date);
    return val != null && val >= h.target;
  }

  function habitValue(s, h, date) {
    const v = s.days[date] && s.days[date].habits[h.id];
    if (typeof v === 'number') return v;
    if (h.metric && s.health[date] && s.health[date][h.metric] != null) return s.health[date][h.metric];
    return null;
  }

  function dayScore(s, date) {
    if (!s.habits.length) return 0;
    return s.habits.filter((h) => habitDone(s, h, date)).length / s.habits.length;
  }

  // A day "counts" toward the streak when at least 80% of habits are done.
  const STREAK_THRESHOLD = 0.8;

  function streaks(s, upTo) {
    const end = upTo || today();
    const start = s.challenge.start;
    if (end < start) return { current: 0, best: 0 };
    let best = 0, run = 0;
    for (const d of range(start, end)) {
      if (dayScore(s, d) >= STREAK_THRESHOLD) {
        run++;
        best = Math.max(best, run);
      } else run = 0;
    }
    // today being incomplete shouldn't break the current streak yet
    let current = 0;
    let d = dayScore(s, end) >= STREAK_THRESHOLD ? end : addDays(end, -1);
    while (d >= start && dayScore(s, d) >= STREAK_THRESHOLD) {
      current++;
      d = addDays(d, -1);
    }
    return { current, best };
  }

  function challengeProgress(s, on) {
    const t = on || today();
    const total = diffDays(s.challenge.start, s.challenge.end) + 1;
    const day = Math.min(Math.max(diffDays(s.challenge.start, t) + 1, 0), total);
    return { day, total, pct: total ? day / total : 0, started: t >= s.challenge.start, ended: t > s.challenge.end };
  }

  WA.calc = { habitDone, habitValue, dayScore, streaks, challengeProgress, STREAK_THRESHOLD };
})(typeof window !== 'undefined' ? window : globalThis);
