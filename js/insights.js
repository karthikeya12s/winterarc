/* Winter Arc — rule-based insights from your logs + imported health data.
 * Each insight: { id, level: 'good'|'warn'|'info', title, body }.
 * Rules are deliberately simple and explainable; they only fire when there is enough data. */
(function (root) {
  const WA = (root.WA = root.WA || {});
  const { addDays, range, today, weekStart, fmt, parse } = WA.date;

  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const vals = (s, metric, days) => days.map((d) => s.health[d] && s.health[d][metric]).filter((v) => v != null);
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function generate(s, on) {
    const t = on || today();
    const out = [];
    const add = (id, level, title, body) => out.push({ id, level, title, body });
    const { calc } = WA;
    const prog = calc.challengeProgress(s, t);
    const last7 = range(addDays(t, -6), t);
    const prev7 = range(addDays(t, -13), addDays(t, -7));
    const past7 = range(addDays(t, -7), addDays(t, -1)); // excludes today, which is still in progress

    // --- challenge status ---
    if (!prog.started) {
      const n = WA.date.diffDays(t, s.challenge.start);
      add('starts', 'info', `${s.challenge.name} starts in ${n} day${n === 1 ? '' : 's'}`, 'Set your habits in Settings and import your health history now so you have a baseline to beat.');
    } else if (prog.ended) {
      add('ended', 'good', `${s.challenge.name} is complete`, 'Look at Progress → Challenge for the full picture, and export a backup from Settings.');
    }

    // --- today: what's left ---
    if (prog.started && !prog.ended) {
      const left = s.habits.filter((h) => !calc.habitDone(s, h, t));
      const hour = new Date().getHours();
      const { current } = calc.streaks(s, t);
      if (left.length && hour >= 18 && current >= 2)
        add('streak-risk', 'warn', `Your ${current}-day streak is on the line`, `Still open today: ${left.map((h) => h.name).join(', ')}.`);
      else if (!left.length) add('today-done', 'good', 'Everything checked off today', 'That is how the arc is built — one closed day at a time.');
    }

    // --- consistency trend ---
    const inChallenge = (d) => d >= s.challenge.start && d <= s.challenge.end;
    const scoreOf = (days) => mean(days.filter(inChallenge).map((d) => calc.dayScore(s, d)));
    const cur = scoreOf(past7), before = scoreOf(range(addDays(t, -14), addDays(t, -8)));
    if (cur != null && before != null && past7.filter(inChallenge).length >= 5) {
      const delta = Math.round((cur - before) * 100);
      if (delta >= 10) add('consistency-up', 'good', `Consistency up ${delta} pts this week`, `You completed ${Math.round(cur * 100)}% of habits over the last 7 days.`);
      if (delta <= -10) add('consistency-down', 'warn', `Consistency down ${-delta} pts this week`, `You're at ${Math.round(cur * 100)}% of habits over the last 7 days, from ${Math.round(before * 100)}%. Pick the one habit you skip most and protect it first.`);
    }

    // --- weakest habit ---
    const recent = range(addDays(t, -13), addDays(t, -1)).filter(inChallenge);
    if (recent.length >= 7 && s.habits.length) {
      const rates = s.habits.map((h) => ({ h, r: recent.filter((d) => calc.habitDone(s, h, d)).length / recent.length }));
      rates.sort((a, b) => a.r - b.r);
      const w = rates[0];
      if (w.r < 0.6) add('weak-habit', 'warn', `${w.h.icon} ${w.h.name} is your weak link`, `Done on ${Math.round(w.r * 100)}% of the last ${recent.length} days. Attach it to something you already do every day.`);
    }

    // --- training volume ---
    const wk = (from) => s.workouts.filter((w) => w.date >= from && w.date <= addDays(from, 6));
    const thisWeek = wk(weekStart(t)), lastWeek = wk(addDays(weekStart(t), -7));
    const mins = (ws) => ws.reduce((a, w) => a + (+w.duration || 0), 0);
    if (lastWeek.length) {
      const a = mins(thisWeek), b = mins(lastWeek);
      const dowIdx = (parse(t).getDay() + 6) % 7; // 0 = Monday
      if (dowIdx >= 4 && a < b * 0.5) add('volume-low', 'warn', 'Training volume is behind last week', `${a} min so far vs ${b} min last week.`);
      if (a > b && a > 0) add('volume-up', 'good', 'You have out-trained last week', `${a} min this week vs ${b} min last week.`);
    }
    const lastWorkout = s.workouts.map((w) => w.date).filter((d) => d <= t).sort().pop();
    if (lastWorkout && prog.started) {
      const gap = WA.date.diffDays(lastWorkout, t);
      if (gap >= 3) add('workout-gap', 'warn', `${gap} days since your last workout`, `Last logged session: ${fmt(lastWorkout, { weekday: 'short', month: 'short', day: 'numeric' })}. Even 20 minutes keeps the chain going.`);
    }

    // --- this week's plan ---
    const plan = s.plans[weekStart(t)];
    if (plan && prog.started && !prog.ended) {
      const dowName = fmt(t, { weekday: 'short' });
      const plannedType = plan.types && plan.types[dowName];
      if (plannedType && !WA.workoutsOn(s, t).length && new Date().getHours() >= 12)
        add('planned-today', 'warn', `${plannedType} is on the plan today`, `You scheduled it in your weekly review. Tap the ${plannedType} chip on Today to log it.`);
      const focus = plan.focus && s.habits.find((h) => h.id === plan.focus);
      if (focus) {
        const wkDays = range(weekStart(t), t).filter(inChallenge);
        const hit = wkDays.filter((d) => calc.habitDone(s, focus, d)).length;
        if (wkDays.length >= 2 && hit < wkDays.length - 1)
          add('focus-slipping', 'warn', `Focus habit ${focus.icon} ${focus.name}: ${hit}/${wkDays.length} days`, `You picked this as the one to fix this week. Make it the first thing you do tomorrow.`);
      }
    }

    // --- Sunday review nudge ---
    const dow = parse(t).getDay();
    const thisWeekKey = weekStart(t);
    if (prog.started && !prog.ended && !(s.reviews[thisWeekKey] || {}).done && (dow === 0 || dow === 6) && new Date().getHours() >= 15)
      add('do-review', 'info', 'Time for your weekly review', 'Five minutes: what worked, what to change, and the plan for next week. Open the Review tab.');

    // --- strength PRs ---
    if (WA.strength) {
      const recentPRs = range(addDays(t, -6), t).flatMap((d) => WA.strength.prsOn(s, d).map((p) => ({ ...p, date: d })));
      if (recentPRs.length) {
        const top = recentPRs[recentPRs.length - 1];
        add('pr', 'good', `${recentPRs.length} PR${recentPRs.length > 1 ? 's' : ''} this week`, `${top.name}: ${top.weight} kg × ${top.reps} (est. 1RM ${top.e1rm} kg) on ${fmt(top.date, { weekday: 'short' })}.`);
      }
      const vNow = WA.strength.weekVolume(s, weekStart(t)), vPrev = WA.strength.weekVolume(s, addDays(weekStart(t), -7));
      if (vPrev > 0 && vNow > vPrev * 1.1) add('tonnage-up', 'good', `Lifting volume up ${Math.round(((vNow - vPrev) / vPrev) * 100)}%`, `${Math.round(vNow / 1000)} t this week vs ${Math.round(vPrev / 1000)} t last week.`);
      const stale = WA.strength.summary(s).filter((x) => x.sessions >= 3 && WA.date.diffDays(x.last.date, t) >= 10);
      if (stale.length) add('lift-stale', 'info', `${stale[0].name} hasn't been trained in ${WA.date.diffDays(stale[0].last.date, t)} days`, 'Strength you don\'t train fades in 2–3 weeks. Put it back on the plan.');
    }

    // --- nutrition ---
    const goals = (s.settings && s.settings.goals) || {};
    const prot7 = vals(s, 'protein', past7);
    if (goals.protein && prot7.length >= 3) {
      const avg = Math.round(mean(prot7));
      if (avg < goals.protein * 0.85) add('protein-low', 'warn', `Protein averaging ${avg} g, goal ${goals.protein} g`, `${Math.round((avg / goals.protein) * 100)}% of target over ${prot7.length} logged days. Add a protein source to breakfast — that's where most people fall short.`);
      else add('protein-ok', 'good', `Protein on track: ${avg} g a day`, `Goal is ${goals.protein} g.`);
    }
    const kcal7 = vals(s, 'calories', past7);
    if (goals.calories && kcal7.length >= 3) {
      const avg = Math.round(mean(kcal7));
      const diff = avg - goals.calories;
      if (Math.abs(diff) > goals.calories * 0.1) add('kcal-off', 'warn', `Eating ${Math.abs(diff)} kcal ${diff > 0 ? 'over' : 'under'} target`, `${avg} kcal/day average vs ${goals.calories} goal over ${kcal7.length} logged days.`);
    }
    if (goals.goalWeight) {
      const ws = Object.keys(s.health).filter((d) => s.health[d].weight != null && d <= t).sort();
      if (ws.length >= 4) {
        const last = s.health[ws[ws.length - 1]].weight;
        const firstIdx = ws.findIndex((d) => WA.date.diffDays(d, t) <= 28);
        const first = s.health[ws[Math.max(0, firstIdx)]].weight;
        const span = Math.max(1, WA.date.diffDays(ws[Math.max(0, firstIdx)], ws[ws.length - 1]));
        const perWeek = ((last - first) / span) * 7;
        const toGo = goals.goalWeight - last;
        if (Math.abs(toGo) < 0.3) add('goal-weight', 'good', 'You are at your goal weight', `${last} kg. Shift to maintenance and keep the habits.`);
        else if (Math.sign(perWeek) === Math.sign(toGo) && Math.abs(perWeek) >= 0.1) add('goal-weight', 'info', `On pace to reach ${goals.goalWeight} kg in ~${Math.ceil(Math.abs(toGo / perWeek))} weeks`, `${Math.abs(perWeek).toFixed(2)} kg/week over the last ${span} days; ${Math.abs(toGo).toFixed(1)} kg to go.`);
        else if (Math.abs(toGo) >= 1) add('goal-weight', 'warn', `Weight is not moving toward ${goals.goalWeight} kg`, `${last} kg now, ${Math.abs(toGo).toFixed(1)} kg to go, trend ${perWeek >= 0 ? '+' : ''}${perWeek.toFixed(2)} kg/week.`);
      }
    }

    // --- best training day ---
    if (s.workouts.length >= 8) {
      const counts = Array(7).fill(0);
      s.workouts.forEach((w) => counts[parse(w.date).getDay()]++);
      const best = counts.indexOf(Math.max(...counts));
      add('best-dow', 'info', `${DOW[best]} is your strongest training day`, `${counts[best]} of your ${s.workouts.length} sessions landed on a ${DOW[best]}. Schedule your hardest session there.`);
    }

    // --- health data ---
    const stepHabit = s.habits.find((h) => h.metric === 'steps');
    const stepGoal = stepHabit ? stepHabit.target : 10000;
    const steps7 = vals(s, 'steps', past7);
    if (steps7.length >= 4) {
      const avg = Math.round(mean(steps7));
      const prevAvg = mean(vals(s, 'steps', range(addDays(t, -14), addDays(t, -8))));
      const trend = prevAvg ? ` (${avg >= prevAvg ? '+' : ''}${Math.round(((avg - prevAvg) / prevAvg) * 100)}% vs prior week)` : '';
      add('steps-avg', avg >= stepGoal ? 'good' : 'info', `Averaging ${avg.toLocaleString()} steps a day`, `Goal is ${stepGoal.toLocaleString()}${trend}.`);
    }

    const sleepHabit = s.habits.find((h) => h.metric === 'sleepHrs');
    const sleepGoal = sleepHabit ? sleepHabit.target : 7.5;
    const sleep7 = vals(s, 'sleepHrs', last7);
    if (sleep7.length >= 4) {
      const avg = mean(sleep7);
      const debt = sleep7.reduce((a, v) => a + Math.max(0, sleepGoal - v), 0);
      if (avg < sleepGoal) add('sleep-low', 'warn', `Sleep is averaging ${avg.toFixed(1)} h`, `That's ${debt.toFixed(1)} h short of your ${sleepGoal} h goal over the last ${sleep7.length} nights. Recovery is where the gains happen.`);
      else add('sleep-ok', 'good', `Sleep on target: ${avg.toFixed(1)} h average`, `Keep the same bedtime through the weekends.`);
    }

    // sleep vs training: do you train more after good nights?
    const paired = Object.keys(s.health).filter((d) => s.health[d].sleepHrs != null && inChallenge(d));
    if (paired.length >= 14) {
      const good = paired.filter((d) => s.health[d].sleepHrs >= sleepGoal);
      const bad = paired.filter((d) => s.health[d].sleepHrs < sleepGoal);
      const rate = (ds) => ds.filter((d) => WA.workoutsOn(s, d).length).length / ds.length;
      if (good.length >= 5 && bad.length >= 5) {
        const g = rate(good), b = rate(bad);
        if (g - b >= 0.15) add('sleep-train', 'info', 'Good sleep → you train', `You worked out on ${Math.round(g * 100)}% of days after ${sleepGoal}+ h of sleep vs ${Math.round(b * 100)}% after short nights.`);
      }
    }

    const rhrNow = mean(vals(s, 'restingHR', last7));
    const rhrBase = mean(vals(s, 'restingHR', range(addDays(t, -35), addDays(t, -8))));
    if (rhrNow && rhrBase) {
      const d = rhrNow - rhrBase;
      if (d >= 4) add('rhr-up', 'warn', `Resting heart rate up ${Math.round(d)} bpm`, `${Math.round(rhrNow)} bpm this week vs ${Math.round(rhrBase)} bpm baseline. Can signal fatigue, illness or poor sleep — consider a lighter day.`);
      else if (d <= -2) add('rhr-down', 'good', `Resting heart rate down ${Math.round(-d)} bpm`, `${Math.round(rhrNow)} bpm vs ${Math.round(rhrBase)} bpm baseline — a sign your fitness is improving.`);
    }

    const hrvNow = mean(vals(s, 'hrv', last7));
    const hrvBase = mean(vals(s, 'hrv', range(addDays(t, -35), addDays(t, -8))));
    if (hrvNow && hrvBase && hrvNow < hrvBase * 0.85)
      add('hrv-low', 'warn', 'HRV is below your baseline', `${Math.round(hrvNow)} ms vs ${Math.round(hrvBase)} ms. Prioritise sleep and keep intensity moderate.`);

    const weights = Object.keys(s.health).filter((d) => s.health[d].weight != null && d >= s.challenge.start && d <= t).sort();
    if (weights.length >= 2) {
      const first = s.health[weights[0]].weight, lastW = s.health[weights[weights.length - 1]].weight;
      const d = lastW - first;
      if (Math.abs(d) >= 0.5)
        add('weight', 'info', `Weight ${d < 0 ? 'down' : 'up'} ${Math.abs(d).toFixed(1)} kg since the start`, `${first} kg on ${fmt(weights[0])} → ${lastW} kg on ${fmt(weights[weights.length - 1])}.`);
    }

    if (!Object.keys(s.health).length)
      add('no-health', 'info', 'Connect your health data', 'Import an Apple Health export or a Google Fit / Health Connect CSV on the Health tab to unlock sleep, steps and heart-rate insights.');
    else if (s.healthMeta.lastImport) {
      const age = WA.date.diffDays(WA.date.iso(new Date(s.healthMeta.lastImport)), t);
      if (age >= 7) add('stale-health', 'info', `Health data is ${age} days old`, 'Re-import your latest export on the Health tab to keep insights current.');
    }

    const order = { warn: 0, good: 1, info: 2 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }

  WA.insights = { generate };
})(typeof window !== 'undefined' ? window : globalThis);
