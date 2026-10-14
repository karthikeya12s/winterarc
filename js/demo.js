/* Winter Arc — sample data so you can explore the app before you have your own. */
(function (root) {
  const WA = (root.WA = root.WA || {});
  WA.demo = function (current) {
    const D = WA.date;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const s = WA.defaultState();
    s.habits = current.habits.length ? current.habits : s.habits;
    const t = D.today();
    s.challenge = { name: 'Winter Arc', start: D.addDays(t, -41), end: D.addDays(t, 48) };
    const plan = ['Strength', 'Run', 'Strength', 'Mobility', 'Strength', 'HIIT', null];
    const lifts = [['Squat', 100], ['Bench press', 70], ['Deadlift', 120], ['Overhead press', 45], ['Barbell row', 65]];
    let weight = 82.4;
    let strengthN = 0;
    s.settings.goals = { calories: 2300, protein: 160, goalWeight: 78 };
    for (const d of D.range(D.addDays(s.challenge.start, -21), t)) {
      const dow = (D.parse(d).getDay() + 6) % 7;
      const progress = Math.max(0, D.diffDays(s.challenge.start, d)) / 42; // gets more consistent over time
      const sleep = +(6.3 + rnd() * 1.6 + progress * 0.6).toFixed(1);
      weight -= 0.03 + (rnd() - 0.5) * 0.25;
      s.health[d] = {
        steps: Math.round(6500 + rnd() * 6000 + progress * 2000),
        sleepHrs: sleep,
        restingHR: Math.round(61 - progress * 4 + rnd() * 3),
        hrv: Math.round(48 + progress * 8 + rnd() * 10),
        activeEnergy: Math.round(380 + rnd() * 400),
        weight: dow % 2 === 0 ? +weight.toFixed(1) : undefined,
        calories: Math.round(2050 + rnd() * 500),
        protein: Math.round(120 + rnd() * 60 + progress * 15),
      };
      if (d >= s.challenge.start) {
        const type = plan[dow];
        if (type && rnd() < 0.7 + progress * 0.25) {
          let exercises = [];
          if (type === 'Strength') {
            const pick = strengthN % 2 ? [0, 1, 4] : [2, 3, 0];
            exercises = pick.map((i) => ({ name: lifts[i][0], sets: 3 + Math.round(rnd()), reps: 5, weight: lifts[i][1] + Math.floor(strengthN / 2) * 2.5 - (rnd() < 0.2 ? 2.5 : 0) }));
            strengthN++;
          }
          s.workouts.push({ id: WA.uid(), date: d, type, duration: 30 + Math.round(rnd() * 5) * 6, rpe: 6 + Math.round(rnd() * 3), calories: null, distance: type === 'Run' ? +(4 + rnd() * 4).toFixed(1) : null, notes: '', source: 'manual', exercises });
        }
        const habits = {};
        s.habits.forEach((h) => {
          if (h.kind === 'check' && !h.auto) habits[h.id] = rnd() < 0.55 + progress * 0.4;
          if (h.kind === 'target' && !h.metric) habits[h.id] = +(h.target * (0.6 + rnd() * 0.6)).toFixed(1);
        });
        s.days[d] = { habits, note: '' };
      }
    }
    s.healthMeta = { lastImport: new Date().toISOString(), source: 'Demo data', records: 0 };
    s.settings.lastDuration = { Strength: 48, Run: 36, Walk: 30 };
    const thisWeek = D.weekStart(t), lastWeek = D.addDays(thisWeek, -7);
    s.reviews[lastWeek] = { done: true, doneAt: D.addDays(thisWeek, -1), worked: 'Training straight after work — no detour home first.', change: 'Phone charges in the kitchen, not the bedroom.' };
    s.plans[thisWeek] = { focus: 'sleep', types: { Mon: 'Strength', Tue: 'Run', Wed: 'Strength', Fri: 'Strength', Sat: 'HIIT' }, note: 'Deload squats if knees complain.' };
    return s;
  };
})(typeof window !== 'undefined' ? window : globalThis);
