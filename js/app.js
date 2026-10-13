/* Winter Arc — UI: hash router + views. */
(function () {
  const { store, date: D, calc, charts, health, insights, reminders } = WA;
  const esc = charts.esc;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const view = $('#view');

  const WORKOUT_TYPES = ['Strength', 'Run', 'Walk', 'HIIT', 'Cycle', 'Swim', 'Yoga', 'Mobility', 'Core', 'Sport', 'Hike', 'Other'];
  const METRIC_FIELDS = [
    ['steps', 'Steps', '', 1],
    ['sleepHrs', 'Sleep', 'h', 0.1],
    ['exerciseMin', 'Exercise', 'min', 1],
    ['activeEnergy', 'Active energy', 'kcal', 1],
    ['restingHR', 'Resting HR', 'bpm', 1],
    ['hrv', 'HRV', 'ms', 1],
    ['weight', 'Weight', 'kg', 0.1],
    ['distanceKm', 'Distance', 'km', 0.01],
  ];

  const fmtNum = (v, unit) => (v == null ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ' ' + unit : ''}`);
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  const toast = (msg) => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  };
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 0);
  }
  const insightCard = (i) => `<div class="insight ${i.level}">
      <span class="insight-icon" aria-hidden="true">${i.level === 'warn' ? '⚠️' : i.level === 'good' ? '✅' : '💡'}</span>
      <div><strong>${esc(i.title)}</strong><p>${esc(i.body)}</p></div></div>`;

  // ---------------- router ----------------
  const routes = { today: renderToday, workouts: renderWorkouts, progress: renderProgress, insights: renderInsights, health: renderHealth, settings: renderSettings };
  function route() {
    const [, name = 'today', arg] = location.hash.split('/');
    const fn = routes[name] || renderToday;
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${name}`));
    view.innerHTML = '';
    fn(arg);
    view.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', () => (route(), window.scrollTo(0, 0)));

  // ---------------- TODAY ----------------
  function renderToday(arg) {
    const s = store.get();
    const t = D.today();
    const day = arg && /^\d{4}-\d\d-\d\d$/.test(arg) ? arg : t;
    const prog = calc.challengeProgress(s, day);
    const score = calc.dayScore(s, day);
    const { current, best } = calc.streaks(s, t);
    const entry = s.days[day] || { habits: {}, note: '' };
    const hd = s.health[day] || {};
    const ws = WA.workoutsOn(s, day);
    const ins = insights.generate(s).slice(0, 2);
    const title = day === t ? 'Today' : day === D.addDays(t, -1) ? 'Yesterday' : D.fmt(day, { weekday: 'long' });

    view.innerHTML = `
    <header class="page-head">
      <div class="day-nav">
        <a class="icon-btn" href="#/today/${D.addDays(day, -1)}" aria-label="Previous day">‹</a>
        <div><h1>${title}</h1><div class="muted">${D.fmt(day, { weekday: 'short', month: 'long', day: 'numeric' })}</div></div>
        <a class="icon-btn ${day >= t ? 'disabled' : ''}" href="#/today/${D.addDays(day, 1)}" aria-label="Next day">›</a>
      </div>
    </header>

    <section class="hero card">
      ${charts.ring(prog.pct, prog.started ? `Day ${prog.day}` : 'Soon', prog.started ? `of ${prog.total}` : `starts ${D.fmt(s.challenge.start)}`)}
      <div class="hero-stats">
        <div class="stat"><span class="stat-num">${pct(score)}</span><span class="stat-label">${day === t ? "today's" : 'day'} habits</span></div>
        <div class="stat"><span class="stat-num">${current}🔥</span><span class="stat-label">current streak</span></div>
        <div class="stat"><span class="stat-num">${best}</span><span class="stat-label">best streak</span></div>
      </div>
    </section>

    ${ins.length ? `<section class="stack">${ins.map(insightCard).join('')}</section>` : ''}

    <section class="card">
      <div class="card-head"><h2>Habits</h2><a href="#/settings" class="link">Edit</a></div>
      <ul class="habits">
        ${s.habits
          .map((h) => {
            const done = calc.habitDone(s, h, day);
            const manual = entry.habits[h.id];
            if (h.kind === 'check') {
              const auto = manual === undefined && done;
              return `<li class="habit ${done ? 'done' : ''}">
                <button class="check" data-toggle="${h.id}" aria-pressed="${done}" aria-label="${esc(h.name)}">${done ? '✓' : ''}</button>
                <span class="habit-icon">${h.icon}</span><span class="habit-name">${esc(h.name)}</span>
                ${auto ? '<span class="badge">auto</span>' : ''}</li>`;
            }
            const v = calc.habitValue(s, h, day);
            const fromHealth = typeof manual !== 'number' && v != null;
            return `<li class="habit ${done ? 'done' : ''}">
              <span class="check static" aria-hidden="true">${done ? '✓' : ''}</span>
              <span class="habit-icon">${h.icon}</span>
              <span class="habit-name">${esc(h.name)}<span class="bar-mini"><span style="width:${Math.min(100, ((v || 0) / h.target) * 100)}%"></span></span></span>
              <span class="habit-input"><input type="number" inputmode="decimal" step="any" min="0" data-value="${h.id}" value="${v ?? ''}" placeholder="0" aria-label="${esc(h.name)} amount">
              <span class="muted">/ ${h.target.toLocaleString()} ${esc(h.unit || '')}</span>${fromHealth ? '<span class="badge">health</span>' : ''}</span></li>`;
          })
          .join('')}
      </ul>
    </section>

    <section class="card">
      <div class="card-head"><h2>Workouts</h2><button class="btn small" data-add-workout>+ Log workout</button></div>
      ${ws.length ? `<ul class="list">${ws.map(workoutRow).join('')}</ul>` : `<p class="muted">Nothing logged ${day === t ? 'yet today' : 'this day'}.</p>`}
      <div class="chips">${WORKOUT_TYPES.slice(0, 6).map((ty) => `<button class="chip" data-quick="${ty}">${ty}</button>`).join('')}</div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Body & recovery</h2><a href="#/health" class="link">Import</a></div>
      <div class="metric-grid">
        ${METRIC_FIELDS.filter(([k]) => ['steps', 'sleepHrs', 'weight', 'restingHR'].includes(k))
          .map(([k, label, unit, step]) => `<label class="metric"><span>${label}${unit ? ` <small>${unit}</small>` : ''}</span><input type="number" step="${step}" min="0" inputmode="decimal" data-metric="${k}" value="${hd[k] ?? ''}" placeholder="—"></label>`)
          .join('')}
      </div>
    </section>

    <section class="card">
      <h2>Notes</h2>
      <textarea id="note" rows="3" placeholder="How did today feel? Wins, struggles, energy…">${esc(entry.note || '')}</textarea>
    </section>`;

    view.onclick = (e) => {
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        store.update((st) => {
          const en = WA.dayEntry(st, day);
          const h = st.habits.find((x) => x.id === tg.dataset.toggle);
          en.habits[h.id] = !calc.habitDone(st, h, day);
        });
        return renderToday(day);
      }
      if (e.target.closest('[data-add-workout]')) return openWorkoutDialog({ date: day });
      const q = e.target.closest('[data-quick]');
      if (q) return openWorkoutDialog({ date: day, type: q.dataset.quick });
      handleWorkoutRowClick(e, () => renderToday(day));
    };
    view.onchange = (e) => {
      const el = e.target;
      if (el.dataset.value) {
        store.update((st) => {
          const en = WA.dayEntry(st, day);
          if (el.value === '') delete en.habits[el.dataset.value];
          else en.habits[el.dataset.value] = parseFloat(el.value);
        });
        renderToday(day);
      } else if (el.dataset.metric) {
        store.update((st) => {
          const h = (st.health[day] = st.health[day] || {});
          if (el.value === '') delete h[el.dataset.metric];
          else h[el.dataset.metric] = parseFloat(el.value);
        });
        renderToday(day);
      } else if (el.id === 'note') {
        store.update((st) => (WA.dayEntry(st, day).note = el.value));
        toast('Note saved');
      }
    };
  }

  function workoutRow(w) {
    const bits = [`${w.duration || 0} min`, w.rpe ? `RPE ${w.rpe}` : '', w.distance ? `${w.distance} km` : '', w.calories ? `${w.calories} kcal` : ''].filter(Boolean);
    return `<li class="row">
      <div class="row-main"><strong>${esc(w.type)}</strong> <span class="muted">${bits.join(' · ')}</span>
      ${w.notes ? `<div class="muted small">${esc(w.notes)}</div>` : ''}</div>
      ${w.source && w.source !== 'manual' ? `<span class="badge">${w.source === 'apple' ? 'Apple' : 'import'}</span>` : ''}
      <button class="icon-btn small" data-edit="${w.id}" aria-label="Edit">✎</button>
      <button class="icon-btn small" data-del="${w.id}" aria-label="Delete">✕</button></li>`;
  }
  function handleWorkoutRowClick(e, rerender) {
    const del = e.target.closest('[data-del]');
    if (del && confirm('Delete this workout?')) {
      store.update((st) => (st.workouts = st.workouts.filter((w) => w.id !== del.dataset.del)));
      rerender();
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) openWorkoutDialog(store.get().workouts.find((w) => w.id === ed.dataset.edit));
  }

  // ---------------- workout dialog ----------------
  function openWorkoutDialog(w = {}) {
    const dlg = $('#workout-dialog');
    const f = $('form', dlg).elements;
    $('form', dlg).reset();
    f.wid.value = w.id || '';
    f.date.value = w.date || D.today();
    f.type.value = w.type || '';
    f.duration.value = w.duration ?? '';
    f.rpe.value = w.rpe ?? '';
    f.distance.value = w.distance ?? '';
    f.calories.value = w.calories ?? '';
    f.notes.value = w.notes || '';
    $('h2', dlg).textContent = w.id ? 'Edit workout' : 'Log workout';
    dlg.showModal();
    (w.type ? f.duration : f.type).focus();
  }
  function setupWorkoutDialog() {
    const dlg = $('#workout-dialog');
    const form = $('form', dlg);
    const f = form.elements;
    $('#types').innerHTML = WORKOUT_TYPES.map((t) => `<option value="${t}">`).join('');
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    form.onsubmit = (e) => {
      e.preventDefault();
      const num = (v) => (v === '' ? null : parseFloat(v));
      const rec = {
        id: f.wid.value || WA.uid(),
        date: f.date.value,
        type: f.type.value.trim() || 'Workout',
        duration: num(f.duration.value) || 0,
        rpe: num(f.rpe.value),
        distance: num(f.distance.value),
        calories: num(f.calories.value),
        notes: f.notes.value.trim(),
        source: 'manual',
      };
      store.update((st) => {
        const i = st.workouts.findIndex((x) => x.id === rec.id);
        if (i >= 0) st.workouts[i] = { ...st.workouts[i], ...rec, source: st.workouts[i].source };
        else st.workouts.push(rec);
      });
      dlg.close();
      toast('Workout saved 💪');
      route();
    };
  }

  // ---------------- WORKOUTS ----------------
  function renderWorkouts() {
    const s = store.get();
    const t = D.today();
    const filter = renderWorkouts.filter || '';
    const types = [...new Set(s.workouts.map((w) => w.type))].sort();
    const list = s.workouts.filter((w) => !filter || w.type === filter).sort((a, b) => (a.date < b.date ? 1 : -1));
    const sum = (ws) => ws.reduce((a, w) => a + (+w.duration || 0), 0);
    const wk = s.workouts.filter((w) => w.date >= D.weekStart(t) && w.date <= t);
    const ch = s.workouts.filter((w) => w.date >= s.challenge.start && w.date <= s.challenge.end);
    const byWeek = {};
    list.forEach((w) => (byWeek[D.weekStart(w.date)] = byWeek[D.weekStart(w.date)] || []).push(w));

    view.innerHTML = `
    <header class="page-head"><h1>Workouts</h1><button class="btn" data-add-workout>+ Log workout</button></header>
    <section class="tiles">
      <div class="tile"><span class="stat-num">${wk.length}</span><span class="stat-label">sessions this week</span></div>
      <div class="tile"><span class="stat-num">${sum(wk)}</span><span class="stat-label">minutes this week</span></div>
      <div class="tile"><span class="stat-num">${ch.length}</span><span class="stat-label">sessions this challenge</span></div>
      <div class="tile"><span class="stat-num">${Math.round(sum(ch) / 60)}</span><span class="stat-label">hours this challenge</span></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>History</h2>
        <select id="wfilter" aria-label="Filter by type"><option value="">All types</option>${types.map((ty) => `<option ${ty === filter ? 'selected' : ''}>${esc(ty)}</option>`).join('')}</select></div>
      ${
        list.length
          ? Object.entries(byWeek)
              .map(
                ([ws, items]) => `<h3 class="week-head">Week of ${D.fmt(ws)} <span class="muted">· ${items.length} sessions · ${sum(items)} min</span></h3>
              <ul class="list">${items.map((w) => workoutRow(w).replace('<div class="row-main">', `<div class="row-date">${D.fmt(w.date, { weekday: 'short', day: 'numeric' })}</div><div class="row-main">`)).join('')}</ul>`
              )
              .join('')
          : '<p class="muted">No workouts yet. Log one, or import them from Apple Health on the Health tab.</p>'
      }
    </section>`;
    view.onclick = (e) => {
      if (e.target.closest('[data-add-workout]')) return openWorkoutDialog();
      handleWorkoutRowClick(e, renderWorkouts);
    };
    view.onchange = (e) => {
      if (e.target.id === 'wfilter') {
        renderWorkouts.filter = e.target.value;
        renderWorkouts();
      }
    };
  }

  // ---------------- PROGRESS ----------------
  function renderProgress() {
    const s = store.get();
    const t = D.today();
    const mode = renderProgress.mode || 'week';
    let offset = renderProgress.offset || 0;
    let from, to, label;
    if (mode === 'week') {
      from = D.addDays(D.weekStart(t), offset * 7);
      to = D.addDays(from, 6);
      label = offset === 0 ? 'This week' : offset === -1 ? 'Last week' : `Week of ${D.fmt(from)}`;
    } else if (mode === '30') {
      from = D.addDays(t, -29);
      to = t;
      label = 'Last 30 days';
    } else {
      from = s.challenge.start;
      to = s.challenge.end;
      label = `${s.challenge.name} · ${D.fmt(from)} – ${D.fmt(to)}`;
    }
    const days = D.range(from, to);
    const past = days.filter((d) => d <= t);
    const scored = past.filter((d) => d >= s.challenge.start && d <= s.challenge.end);
    const avgScore = scored.length ? scored.reduce((a, d) => a + calc.dayScore(s, d), 0) / scored.length : 0;
    const fullDays = scored.filter((d) => calc.dayScore(s, d) >= 1).length;
    const ws = s.workouts.filter((w) => w.date >= from && w.date <= to);
    const mins = ws.reduce((a, w) => a + (+w.duration || 0), 0);
    const { current, best } = calc.streaks(s, t);

    const daily = (fn) => days.map((d) => ({ date: d, label: mode === 'week' ? D.fmt(d, { weekday: 'short' }) : D.fmt(d, { month: 'numeric', day: 'numeric' }), y: d <= t ? fn(d) : null }));
    let workoutPts;
    if (mode === 'challenge') {
      const weeks = [];
      for (let w = D.weekStart(from); w <= to; w = D.addDays(w, 7)) weeks.push(w);
      workoutPts = weeks.map((w) => {
        const m = s.workouts.filter((x) => x.date >= w && x.date <= D.addDays(w, 6)).reduce((a, x) => a + (+x.duration || 0), 0);
        return { label: D.fmt(w, { month: 'numeric', day: 'numeric' }), y: m, tip: `Week of ${D.fmt(w)}: ${m} min` };
      });
    } else workoutPts = daily((d) => WA.workoutsOn(s, d).reduce((a, x) => a + (+x.duration || 0), 0)).map((p) => ({ ...p, tip: `${D.fmt(p.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${p.y || 0} min` }));

    const metricPts = (k, unit) =>
      daily((d) => (s.health[d] && s.health[d][k] != null ? s.health[d][k] : null)).map((p) => ({ ...p, tip: `${D.fmt(p.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${fmtNum(p.y, unit)}` }));
    const goalOf = (metric) => (s.habits.find((h) => h.metric === metric) || {}).target;

    const heatDays = D.range(s.challenge.start, s.challenge.end).map((d) => {
      const sc = d <= t ? calc.dayScore(s, d) : null;
      return { date: d, score: sc, today: d === t, tip: `${D.fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })}: ${sc == null ? 'upcoming' : pct(sc) + ' of habits'}` };
    });

    view.innerHTML = `
    <header class="page-head"><h1>Progress</h1>
      <div class="seg" role="tablist">
        ${[['week', 'Week'], ['30', '30 days'], ['challenge', 'Challenge']].map(([k, l]) => `<button role="tab" aria-selected="${mode === k}" data-mode="${k}">${l}</button>`).join('')}
      </div></header>
    <div class="range-nav">
      ${mode === 'week' ? `<button class="icon-btn" data-shift="-1" aria-label="Previous week">‹</button>` : ''}
      <span>${esc(label)}</span>
      ${mode === 'week' ? `<button class="icon-btn ${offset >= 0 ? 'disabled' : ''}" data-shift="1" aria-label="Next week">›</button>` : ''}
    </div>
    <section class="tiles">
      <div class="tile"><span class="stat-num">${pct(avgScore)}</span><span class="stat-label">habit completion</span></div>
      <div class="tile"><span class="stat-num">${fullDays}</span><span class="stat-label">perfect days</span></div>
      <div class="tile"><span class="stat-num">${ws.length}</span><span class="stat-label">workouts · ${mins} min</span></div>
      <div class="tile"><span class="stat-num">${current} / ${best}</span><span class="stat-label">streak now / best</span></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Challenge calendar</h2>
      <span class="legend"><span class="hm-key hm-0"></span>0<span class="hm-key hm-1"></span><span class="hm-key hm-2"></span><span class="hm-key hm-3"></span><span class="hm-key hm-4"></span>100%</span></div>
      <div class="scroll-x">${charts.heatmap(heatDays)}</div>
      <p class="muted small">A day counts toward your streak when ≥${Math.round(calc.STREAK_THRESHOLD * 100)}% of habits are done. Tap a day to open it.</p>
    </section>

    <section class="card">
      <h2>Habit completion</h2>
      <ul class="habit-bars">
        ${s.habits
          .map((h) => {
            const r = scored.length ? scored.filter((d) => calc.habitDone(s, h, d)).length / scored.length : 0;
            return `<li><span>${h.icon} ${esc(h.name)}</span><span class="hbar"><span style="width:${r * 100}%"></span></span><span class="num">${pct(r)}</span></li>`;
          })
          .join('')}
      </ul>
    </section>

    <div class="chart-grid">
      <section class="card"><h2>Workout minutes${mode === 'challenge' ? ' per week' : ''}</h2>${charts.bar(workoutPts, { label: 'Workout minutes', empty: 'No workouts in this range' })}</section>
      <section class="card"><h2>Steps</h2>${charts.bar(metricPts('steps', 'steps'), { goal: goalOf('steps'), label: 'Steps', empty: 'No step data — import on the Health tab' })}</section>
      <section class="card"><h2>Sleep</h2>${charts.bar(metricPts('sleepHrs', 'h'), { goal: goalOf('sleepHrs'), label: 'Sleep hours', empty: 'No sleep data — import on the Health tab' })}</section>
      <section class="card"><h2>Resting heart rate</h2>${charts.line(metricPts('restingHR', 'bpm'), { label: 'Resting heart rate', empty: 'No heart-rate data yet' })}</section>
      <section class="card"><h2>Weight</h2>${charts.line(metricPts('weight', 'kg'), { label: 'Weight', empty: 'Log weight on Today or import it' })}</section>
      <section class="card"><h2>Active energy</h2>${charts.bar(metricPts('activeEnergy', 'kcal'), { label: 'Active energy', empty: 'No active-energy data yet' })}</section>
    </div>`;

    view.onclick = (e) => {
      const m = e.target.closest('[data-mode]');
      if (m) {
        renderProgress.mode = m.dataset.mode;
        renderProgress.offset = 0;
        return renderProgress();
      }
      const sh = e.target.closest('[data-shift]');
      if (sh && !sh.classList.contains('disabled')) {
        renderProgress.offset = offset + +sh.dataset.shift;
        return renderProgress();
      }
      const cell = e.target.closest('[data-date]');
      if (cell && cell.dataset.date <= t) location.hash = `#/today/${cell.dataset.date}`;
    };
    view.onchange = null;
  }

  // ---------------- INSIGHTS & REMINDERS ----------------
  function renderInsights() {
    const s = store.get();
    const list = insights.generate(s);
    const perm = reminders.supported() ? Notification.permission : 'unsupported';
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    view.innerHTML = `
    <header class="page-head"><h1>Insights</h1></header>
    <section class="stack">${list.length ? list.map(insightCard).join('') : '<p class="muted">Log a few days and insights will appear here.</p>'}</section>

    <section class="card">
      <h2>Reminders</h2>
      <label class="row-field"><span>Daily check-in time</span><input type="time" id="rtime" value="${s.settings.reminderTime}"></label>
      <div class="option">
        <div><strong>📅 Add to your calendar</strong>
        <p class="muted small">Most reliable on iPhone and Android. Downloads a calendar file with a daily check-in at your time and an 8 pm "close out the day" alarm until ${D.fmt(s.challenge.end)}.</p></div>
        <button class="btn" id="ics">Download .ics</button>
      </div>
      <div class="option">
        <div><strong>🔔 App notifications</strong>
        <p class="muted small">Morning check-in plus an 8 pm nudge if habits are still open. Fires only while the app is open or running in the background — there's no server to push when it's closed.
        ${!standalone ? ' On iPhone, first Share → Add to Home Screen.' : ''}</p></div>
        ${
          perm === 'unsupported'
            ? '<span class="muted small">Not supported in this browser</span>'
            : `<label class="switch"><input type="checkbox" id="notify" ${s.settings.notify && perm === 'granted' ? 'checked' : ''}><span></span></label>`
        }
      </div>
    </section>`;

    view.onclick = (e) => {
      if (e.target.id === 'ics') download('winter-arc-reminders.ics', reminders.icsFile(store.get()), 'text/calendar');
    };
    view.onchange = async (e) => {
      if (e.target.id === 'rtime') {
        store.update((st) => (st.settings.reminderTime = e.target.value || '07:00'));
        toast('Reminder time saved');
      }
      if (e.target.id === 'notify') {
        if (e.target.checked) {
          const p = await reminders.requestPermission();
          if (p !== 'granted') {
            e.target.checked = false;
            return toast('Notifications were blocked in browser settings');
          }
          reminders.notify('Reminders on ❄️', `You'll get a check-in at ${store.get().settings.reminderTime}.`);
        }
        store.update((st) => (st.settings.notify = e.target.checked));
      }
    };
  }

  // ---------------- HEALTH ----------------
  function renderHealth() {
    const s = store.get();
    const t = D.today();
    const meta = s.healthMeta;
    const recent = D.range(D.addDays(t, -13), t).reverse();
    const defaultSince = D.addDays(s.challenge.start, -60);

    view.innerHTML = `
    <header class="page-head"><h1>Health data</h1></header>
    <section class="card notice">
      <p><strong>Why a file import?</strong> Apple Health and Google Health Connect only share data with native apps installed on the phone — no website can read them directly. Exporting a file takes a minute, and everything is processed on this device; nothing is uploaded.</p>
      ${meta.lastImport ? `<p class="muted small">Last import: ${new Date(meta.lastImport).toLocaleString()} · ${esc(meta.source)} · ${meta.records.toLocaleString()} records</p>` : ''}
    </section>

    <section class="card">
      <h2> Apple Health</h2>
      <ol class="steps">
        <li>On iPhone open <b>Health</b> → tap your profile picture → <b>Export All Health Data</b>.</li>
        <li>Save <code>export.zip</code> to Files (or AirDrop it to your computer).</li>
        <li>Choose it below. Large exports take a minute.</li>
      </ol>
      <label class="row-field"><span>Import data from</span><input type="date" id="since" value="${defaultSince}"></label>
      <label class="file-btn btn">Choose export.zip / export.xml<input type="file" id="apple" accept=".zip,.xml,application/zip,text/xml"></label>
      <div class="progress" id="apple-progress" hidden><span></span></div>
      <p class="muted small">Imports steps, active energy, exercise minutes, distance, sleep, resting heart rate, HRV, weight and all workouts.</p>
    </section>

    <section class="card">
      <h2>Google Fit / Health Connect / other CSV</h2>
      <ul class="steps">
        <li><b>Google Fit:</b> takeout.google.com → select <b>Fit</b> → export → open <code>Fit/Daily activity metrics/Daily activity metrics.csv</code>.</li>
        <li><b>Health Connect / Samsung / Fitbit / Garmin:</b> export daily summaries as CSV (apps like Health Sync or Health Auto Export do this on a schedule).</li>
        <li>Any spreadsheet works if it has a <b>Date</b> column plus columns like <i>Steps, Sleep, Resting heart rate, Weight, Calories, Distance</i>.</li>
      </ul>
      <label class="file-btn btn">Choose CSV<input type="file" id="csv" accept=".csv,text/csv"></label>
    </section>

    <section class="card">
      <div class="card-head"><h2>Last 14 days</h2><span class="muted small">Edit any value on the Today tab</span></div>
      <div class="scroll-x"><table class="table">
        <thead><tr><th>Date</th>${METRIC_FIELDS.map(([, l, u]) => `<th>${l}${u ? ` <small>${u}</small>` : ''}</th>`).join('')}</tr></thead>
        <tbody>${recent
          .map((d) => `<tr><td><a href="#/today/${d}">${D.fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })}</a></td>${METRIC_FIELDS.map(([k]) => `<td>${fmtNum((s.health[d] || {})[k])}</td>`).join('')}</tr>`)
          .join('')}</tbody>
      </table></div>
    </section>`;

    view.onclick = null;
    view.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const since = $('#since').value || null;
      try {
        let result, source;
        if (e.target.id === 'apple') {
          const bar = $('#apple-progress');
          bar.hidden = false;
          result = await health.importAppleHealth(file, { since, onProgress: (p) => ($('span', bar).style.width = `${Math.round(p * 100)}%`) });
          source = 'Apple Health';
        } else {
          result = health.importCSVText(await file.text(), { since });
          source = `CSV (${result.columns.join(', ')})`;
        }
        let summary;
        store.update((st) => (summary = health.mergeImport(st, result, source)));
        toast(`Imported ${summary.days} days${summary.workouts ? ` and ${summary.workouts} workouts` : ''}`);
        renderHealth();
      } catch (err) {
        console.error(err);
        alert(`Import failed: ${err.message}`);
        renderHealth();
      }
    };
  }

  // ---------------- SETTINGS ----------------
  function renderSettings() {
    const s = store.get();
    const metricOpts = (sel) =>
      `<option value="">manual</option>${METRIC_FIELDS.map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`).join('')}`;
    view.innerHTML = `
    <header class="page-head"><h1>Settings</h1></header>
    <section class="card">
      <h2>Challenge</h2>
      <form id="challenge" class="form-grid">
        <label>Name<input name="name" value="${esc(s.challenge.name)}" required></label>
        <label>Start<input type="date" name="start" value="${s.challenge.start}" required></label>
        <label>End<input type="date" name="end" value="${s.challenge.end}" required></label>
        <button class="btn">Save</button>
      </form>
      <p class="muted small">${D.diffDays(s.challenge.start, s.challenge.end) + 1} days.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Habits</h2><button class="btn small" id="add-habit">+ Add habit</button></div>
      <p class="muted small"><b>Check</b> habits are done/not done. <b>Target</b> habits have a number goal; link one to a health metric and it fills itself from imported data. "Train" ticks automatically when you log a workout.</p>
      <div class="habit-editor">
        ${s.habits
          .map(
            (h, i) => `<div class="he-row" data-i="${i}">
            <input class="he-icon" data-f="icon" value="${esc(h.icon)}" aria-label="Icon" maxlength="4">
            <input data-f="name" value="${esc(h.name)}" aria-label="Name">
            <select data-f="kind" aria-label="Type"><option value="check" ${h.kind === 'check' ? 'selected' : ''}>Check</option><option value="target" ${h.kind === 'target' ? 'selected' : ''}>Target</option></select>
            ${
              h.kind === 'target'
                ? `<input type="number" step="any" data-f="target" value="${h.target}" aria-label="Target"><input data-f="unit" value="${esc(h.unit || '')}" placeholder="unit" aria-label="Unit"><select data-f="metric" aria-label="Linked metric">${metricOpts(h.metric)}</select>`
                : '<span></span><span></span><span></span>'
            }
            <span class="he-move"><button class="icon-btn small" data-move="-1" aria-label="Move up">↑</button><button class="icon-btn small" data-move="1" aria-label="Move down">↓</button></span>
            <button class="icon-btn small" data-remove aria-label="Remove">✕</button>
          </div>`
          )
          .join('')}
      </div>
    </section>

    <section class="card">
      <h2>Your data</h2>
      <p class="muted small">Stored only in this browser. Export a backup regularly, and to move between devices.</p>
      <div class="btn-row">
        <button class="btn" id="export">Export backup</button>
        <label class="file-btn btn ghost">Restore backup<input type="file" id="restore" accept=".json,application/json"></label>
        <button class="btn ghost" id="demo">Load demo data</button>
        <button class="btn danger" id="reset">Reset everything</button>
      </div>
    </section>`;

    const editHabit = (i, fn) => {
      store.update((st) => fn(st.habits[i], st));
      renderSettings();
    };
    view.onclick = (e) => {
      const row = e.target.closest('.he-row');
      const i = row && +row.dataset.i;
      if (e.target.closest('[data-remove]')) {
        if (confirm('Remove this habit? Past check-ins for it are kept in your data.')) editHabit(i, (h, st) => st.habits.splice(i, 1));
      } else if (e.target.closest('[data-move]')) {
        const j = i + +e.target.closest('[data-move]').dataset.move;
        editHabit(i, (h, st) => j >= 0 && j < st.habits.length && ([st.habits[i], st.habits[j]] = [st.habits[j], st.habits[i]]));
      } else if (e.target.id === 'add-habit') {
        store.update((st) => st.habits.push({ id: WA.uid(), name: 'New habit', icon: '⭐', kind: 'check' }));
        renderSettings();
        $$('.he-row input[data-f="name"]').pop().select();
      } else if (e.target.id === 'export') {
        download(`winter-arc-backup-${D.today()}.json`, JSON.stringify(store.get(), null, 1), 'application/json');
      } else if (e.target.id === 'demo') {
        if (confirm('Replace your data with 6 weeks of sample data?')) {
          store.set(WA.demo(store.get()));
          toast('Demo data loaded');
          location.hash = '#/progress';
        }
      } else if (e.target.id === 'reset') {
        if (confirm('Delete ALL Winter Arc data on this device? Export a backup first if unsure.')) {
          store.reset();
          toast('Reset complete');
          renderSettings();
        }
      }
    };
    view.onchange = async (e) => {
      const el = e.target;
      const row = el.closest('.he-row');
      if (row && el.dataset.f) {
        editHabit(+row.dataset.i, (h) => {
          const f = el.dataset.f;
          if (f === 'target') h.target = parseFloat(el.value) || 1;
          else if (f === 'metric') el.value ? (h.metric = el.value) : delete h.metric;
          else if (f === 'kind') {
            h.kind = el.value;
            if (h.kind === 'target' && !h.target) (h.target = 1), (h.unit = h.unit || '');
          } else h[f] = el.value;
        });
      }
      if (el.id === 'restore' && el.files[0]) {
        try {
          const data = JSON.parse(await el.files[0].text());
          if (!data.challenge || !Array.isArray(data.habits)) throw new Error('Not a Winter Arc backup');
          if (confirm('Replace current data with this backup?')) {
            store.set(data);
            toast('Backup restored');
            renderSettings();
          }
        } catch (err) {
          alert(`Could not restore: ${err.message}`);
        }
      }
    };
    $('#challenge').onsubmit = (e) => {
      e.preventDefault();
      const f = e.target.elements;
      if (f.end.value < f.start.value) return alert('End date must be after the start date.');
      store.update((st) => Object.assign(st.challenge, { name: f.name.value.trim() || 'Winter Arc', start: f.start.value, end: f.end.value }));
      toast('Challenge saved');
      renderSettings();
    };
  }

  // ---------------- boot ----------------
  store.load();
  setupWorkoutDialog();
  charts.installTooltips(document);
  $('#fab').onclick = () => openWorkoutDialog({ date: location.hash.startsWith('#/today/') ? location.hash.split('/')[2] : D.today() });
  route();
  reminders.start();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
