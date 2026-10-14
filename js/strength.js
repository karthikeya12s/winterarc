/* Winter Arc — strength tracking maths: per-exercise history, estimated 1RM and PRs. */
(function (root) {
  const WA = (root.WA = root.WA || {});

  // Epley estimate; for 1 rep it's just the weight. Good enough to compare sessions.
  const est1RM = (weight, reps) => (reps > 0 && weight > 0 ? +(weight * (1 + reps / 30)).toFixed(1) : 0);
  const volume = (ex) => (ex.sets || 0) * (ex.reps || 0) * (ex.weight || 0);
  const norm = (name) => (name || '').trim().toLowerCase();

  /** All sets ever logged, flattened: [{date, workoutId, name, sets, reps, weight, e1rm}] sorted by date. */
  function entries(s) {
    const out = [];
    for (const w of s.workouts)
      for (const ex of w.exercises || [])
        if (ex.name) out.push({ date: w.date, workoutId: w.id, key: norm(ex.name), name: ex.name.trim(), sets: +ex.sets || 0, reps: +ex.reps || 0, weight: +ex.weight || 0, e1rm: est1RM(+ex.weight, +ex.reps) });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /** Per-exercise summary: last session, best e1RM (and when), history for charts, PR dates. */
  function summary(s) {
    const byKey = {};
    for (const e of entries(s)) {
      const x = (byKey[e.key] = byKey[e.key] || { key: e.key, name: e.name, history: [], best: null, prs: [] });
      x.history.push(e);
      if (!x.best || e.e1rm > x.best.e1rm) {
        if (x.best && e.e1rm > x.best.e1rm) x.prs.push(e.date);
        x.best = e;
      }
    }
    return Object.values(byKey)
      .map((x) => ({ ...x, last: x.history[x.history.length - 1], sessions: new Set(x.history.map((h) => h.date)).size }))
      .sort((a, b) => (a.last.date < b.last.date ? 1 : -1));
  }

  /** PRs set on a given date (new best e1RM for that exercise). */
  function prsOn(s, date) {
    return summary(s).filter((x) => x.prs.includes(date)).map((x) => ({ name: x.name, e1rm: x.best.e1rm, weight: x.best.weight, reps: x.best.reps }));
  }

  /** Weekly tonnage (sets × reps × kg) for the week starting `from`. */
  function weekVolume(s, from) {
    const to = WA.date.addDays(from, 6);
    return s.workouts.filter((w) => w.date >= from && w.date <= to).reduce((a, w) => a + (w.exercises || []).reduce((b, ex) => b + volume(ex), 0), 0);
  }

  /** Names you've used before, most recent first, for autocomplete. */
  function exerciseNames(s) {
    return summary(s).map((x) => x.name);
  }

  WA.strength = { est1RM, volume, entries, summary, prsOn, weekVolume, exerciseNames };
})(typeof window !== 'undefined' ? window : globalThis);
