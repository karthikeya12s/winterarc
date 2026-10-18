/* Winter Arc — 90:90:1 — for 90 days, the first 90 minutes of the day go to 1 mission.
 * Data lives in state.focus:
 *   mission: { title, why, start, days, minutes, blockTime, schedule: 'weekdays'|'daily', createdAt,
 *              segments: [{ id, name, minutes, source: 'manual'|'workouts' }] }   // the block split into parts
 *   tasks:   [{ id, title, progress 0..100, doneAt, createdAt }]
 *   sessions:{ date: { minutes, segments: { segId: minutes }, taskIds: [], note } }
 * A segment with source 'workouts' is also credited with the workout minutes logged that day.
 * Top-3 lists live in state.days[date].top3 = [{ text, done }].
 * A running timer is kept in localStorage separately so it survives reloads. */
(function (root) {
  const WA = (root.WA = root.WA || {});
  const D = () => WA.date;
  const TIMER_KEY = 'winterarc.focusTimer';

  const empty = () => ({ mission: null, tasks: [], sessions: {} });
  const get = (s) => (s.focus = s.focus && typeof s.focus === 'object' ? { ...empty(), ...s.focus } : empty());
  const hasMission = (s) => !!(get(s).mission && get(s).mission.title);

  const endDate = (m) => D().addDays(m.start, (m.days || 90) - 1);
  const isRequired = (m, date) => {
    if (date < m.start || date > endDate(m)) return false;
    if (m.schedule === 'weekdays') {
      const dow = D().parse(date).getDay();
      return dow !== 0 && dow !== 6;
    }
    return true;
  };
  const segments = (m) => (m && m.segments && m.segments.length ? m.segments : m ? [{ id: 'main', name: 'Focus block', minutes: m.minutes || 90, source: 'manual' }] : []);
  const workoutMinutes = (s, date) => (s.workouts || []).filter((w) => w.date === date).reduce((a, w) => a + (+w.duration || 0), 0);
  function segmentMinutes(s, date, seg) {
    const sess = get(s).sessions[date] || {};
    const logged = sess.segments ? sess.segments[seg.id] || 0 : seg.id === 'main' ? sess.minutes || 0 : 0;
    return logged + (seg.source === 'workouts' ? workoutMinutes(s, date) : 0);
  }
  const targetMinutes = (m) => segments(m).reduce((a, x) => a + (+x.minutes || 0), 0);
  const minutesOn = (s, date) => (hasMission(s) ? segments(get(s).mission).reduce((a, seg) => a + segmentMinutes(s, date, seg), 0) : 0);
  const doneOn = (s, date) => hasMission(s) && segments(get(s).mission).every((seg) => segmentMinutes(s, date, seg) >= (+seg.minutes || 0));
  const top3 = (s, date) => ((s.days && s.days[date] && s.days[date].top3) || []).filter((x) => x && x.text);

  /** Headline numbers up to `on` (today by default). */
  function stats(s, on) {
    const f = get(s);
    const m = f.mission;
    const t = on || D().today();
    if (!m) return null;
    const end = endDate(m);
    const total = m.days || 90;
    const dayNo = Math.min(Math.max(D().diffDays(m.start, t) + 1, 0), total);
    const elapsed = D().range(m.start, t < end ? t : end).filter((d) => d <= t);
    const required = elapsed.filter((d) => isRequired(m, d));
    const requiredBeforeToday = required.filter((d) => d < t);
    const hit = required.filter((d) => doneOn(s, d));
    const minutes = D().range(m.start, t < end ? t : end).reduce((a, d) => a + minutesOn(s, d), 0);
    // streak: consecutive required days hit, ending today (if hit) or yesterday
    let streak = 0, best = 0, run = 0;
    for (const d of required) {
      if (doneOn(s, d)) {
        run++;
        best = Math.max(best, run);
      } else if (d !== t) run = 0; // today still in progress doesn't break it
    }
    streak = run;
    const missedBeforeToday = requiredBeforeToday.filter((d) => !doneOn(s, d)).length;
    const totalRequired = D().range(m.start, end).filter((d) => isRequired(m, d)).length;
    const tasksDone = f.tasks.filter((x) => x.progress >= 100).length;
    const taskProgress = f.tasks.length ? Math.round(f.tasks.reduce((a, x) => a + (x.progress || 0), 0) / f.tasks.length) : 0;
    return {
      dayNo, total, end, started: t >= m.start, ended: t > end,
      requiredSoFar: requiredBeforeToday.length + (isRequired(m, t) ? 1 : 0),
      hit: hit.length, missed: missedBeforeToday, totalRequired,
      rate: requiredBeforeToday.length ? hit.filter((d) => d < t).length / requiredBeforeToday.length : 0,
      minutes, hours: +(minutes / 60).toFixed(1), streak, best,
      todayMinutes: minutesOn(s, t), todayDone: doneOn(s, t), todayRequired: isRequired(m, t),
      tasksDone, taskCount: f.tasks.length, taskProgress,
    };
  }

  /** 90 cells for the calendar: { date, state: 'hit'|'miss'|'today'|'future'|'off'|'partial', minutes } */
  function calendar(s, on) {
    const m = get(s).mission;
    if (!m) return [];
    const t = on || D().today();
    return D().range(m.start, endDate(m)).map((date) => {
      const mins = minutesOn(s, date);
      let state;
      if (!isRequired(m, date)) state = mins ? 'hit' : 'off';
      else if (doneOn(s, date)) state = 'hit';
      else if (date > t) state = 'future';
      else if (date === t) state = mins ? 'partial' : 'today';
      else state = mins ? 'partial' : 'miss';
      return { date, state, minutes: mins };
    });
  }

  function logSession(s, date, minutes, taskIds, note, segId) {
    const f = get(s);
    const cur = f.sessions[date] || { minutes: 0, taskIds: [], note: '' };
    const segs = segments(f.mission);
    const id = segId || (segs[0] && segs[0].id) || 'main';
    cur.segments = cur.segments || {};
    cur.segments[id] = Math.max(0, Math.round((cur.segments[id] || 0) + minutes));
    cur.minutes = Object.values(cur.segments).reduce((a, v) => a + v, 0);
    cur.taskIds = [...new Set([...(cur.taskIds || []), ...(taskIds || [])])];
    if (note) cur.note = cur.note ? `${cur.note}\n${note}` : note;
    f.sessions[date] = cur;
    return cur;
  }

  // ---- timer (survives reloads) ----
  function timer() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(TIMER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function startTimer(taskIds, segId) {
    const t = { startedAt: Date.now(), taskIds: taskIds || [], segId: segId || null };
    try {
      root.localStorage.setItem(TIMER_KEY, JSON.stringify(t));
    } catch (e) {}
    return t;
  }
  function stopTimer() {
    const t = timer();
    try {
      root.localStorage.removeItem(TIMER_KEY);
    } catch (e) {}
    if (!t) return null;
    return { minutes: Math.max(1, Math.round((Date.now() - t.startedAt) / 60000)), taskIds: t.taskIds, segId: t.segId, startedAt: t.startedAt };
  }
  const elapsedMinutes = () => {
    const t = timer();
    return t ? Math.floor((Date.now() - t.startedAt) / 60000) : 0;
  };

  WA.focus = { get, hasMission, stats, calendar, logSession, isRequired, endDate, doneOn, minutesOn, segments, segmentMinutes, targetMinutes, top3, timer, startTimer, stopTimer, elapsedMinutes };
})(typeof window !== 'undefined' ? window : globalThis);
