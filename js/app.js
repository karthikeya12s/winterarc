/* Winter Arc — UI: router + views. */
(function () {
  const { store, date: D, calc, charts, health, insights, reminders, strength } = WA;
  const esc = charts.esc;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const view = $('#view');

  const WORKOUT_TYPES = ['Strength', 'Run', 'Walk', 'HIIT', 'Cycle', 'Swim', 'Yoga', 'Mobility', 'Core', 'Sport', 'Hike', 'Other'];
  const DEFAULT_MIN = { Strength: 45, Run: 30, Walk: 30, HIIT: 20, Cycle: 40, Swim: 30, Yoga: 30, Mobility: 15, Core: 15, Sport: 60, Hike: 90, Other: 30 };
  const METRIC_FIELDS = [
    ['steps', 'Steps', '', 1],
    ['sleepHrs', 'Sleep', 'h', 0.1],
    ['weight', 'Weight', 'kg', 0.1],
    ['restingHR', 'Resting HR', 'bpm', 1],
    ['calories', 'Calories eaten', 'kcal', 1],
    ['protein', 'Protein', 'g', 1],
    ['exerciseMin', 'Exercise', 'min', 1],
    ['activeEnergy', 'Active energy', 'kcal', 1],
    ['hrv', 'HRV', 'ms', 1],
    ['distanceKm', 'Distance', 'km', 0.01],
  ];
  const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dowShort = (d) => DOWS[(D.parse(d).getDay() + 6) % 7];

  const fmtNum = (v, unit) => (v == null ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ' ' + unit : ''}`);
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

  /** toast(message) or toast(message, [{label, fn}]) for an actionable toast (Undo, Edit…). */
  function toast(msg, actions) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${(actions || []).map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('')}`;
    t.classList.toggle('actionable', !!(actions && actions.length));
    t.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      actions[+b.dataset.i].fn();
      t.classList.remove('show');
    };
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), actions ? 6000 : 2600);
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 0);
  }
  async function shareText(title, text) {
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard — paste it anywhere');
    } catch (e) {
      tell(text);
    }
  }
  const INSIGHT_ICON = { warn: 'alert', good: 'check', info: 'spark' };
  const insightCard = (i) => `<div class="insight ${i.level}">
      <span class="insight-icon" aria-hidden="true">${WA.icon(INSIGHT_ICON[i.level])}</span>
      <div><strong>${esc(i.title)}</strong><p>${esc(i.body)}</p></div></div>`;

  // In-page confirm/alert: native dialogs are blocked in some embedded viewers and look out of place.
  function ask(message, { ok = 'OK', danger = false, cancel = 'Cancel' } = {}) {
    const dlg = $('#confirm-dialog');
    $('p', dlg).textContent = message;
    const okBtn = $('[data-ok]', dlg), cancelBtn = $('[data-cancel]', dlg);
    okBtn.textContent = ok;
    okBtn.classList.toggle('danger-solid', danger);
    cancelBtn.hidden = cancel == null;
    cancelBtn.textContent = cancel || '';
    dlg.showModal();
    return new Promise((resolve) => {
      const done = (v) => () => (dlg.close(), (okBtn.onclick = cancelBtn.onclick = dlg.oncancel = null), resolve(v));
      okBtn.onclick = done(true);
      cancelBtn.onclick = dlg.oncancel = done(false);
    });
  }
  const tell = (message) => ask(message, { cancel: null });
  WA.ui = { ask, tell, toast };

  // ---------------- router ----------------
  const routes = { today: renderToday, workouts: renderWorkouts, progress: renderProgress, review: renderReview, insights: renderInsights, health: renderHealth, settings: renderSettings };
  let current = location.hash || '#/today';
  function go(h) {
    current = h;
    try {
      if (location.hash !== h) history.pushState(null, '', h);
    } catch (e) {}
    route();
    window.scrollTo(0, 0);
  }
  function route() {
    const [, name = 'today', arg] = current.split('/');
    const fn = routes[name] || renderToday;
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${name}`));
    view.innerHTML = '';
    fn(arg);
    view.focus({ preventScroll: true });
  }
  window.addEventListener('popstate', () => ((current = location.hash || '#/today'), route()));
  window.addEventListener('hashchange', () => {
    if (location.hash === current) return;
    current = location.hash;
    route();
    window.scrollTo(0, 0);
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    if (!a.classList.contains('disabled')) go(a.getAttribute('href'));
  });

  // ---------------- shared pieces ----------------
  function stepFor(h) {
    if (/^l$/i.test(h.unit || '')) return 0.25;
    if (h.target >= 5000) return 1000;
    if (h.target >= 500) return 100;
    if (h.target >= 50) return 10;
    if (h.target >= 10) return 1;
    return 0.5;
  }
  function logQuick(type, date) {
    const s = store.get();
    const duration = s.settings.lastDuration[type] || DEFAULT_MIN[type] || 30;
    const rec = { id: WA.uid(), date, type, duration, rpe: null, distance: null, calories: null, notes: '', source: 'manual', exercises: [] };
    store.update((st) => st.workouts.push(rec));
    toast(`${type} · ${duration} min logged`, [
      { label: 'Edit', fn: () => openWorkoutDialog(store.get().workouts.find((w) => w.id === rec.id)) },
      { label: 'Undo', fn: () => (store.update((st) => (st.workouts = st.workouts.filter((w) => w.id !== rec.id))), route()) },
    ]);
    route();
  }
  function workoutRow(w, prs) {
    const bits = [`${w.duration || 0} min`, w.rpe ? `RPE ${w.rpe}` : '', w.distance ? `${w.distance} km` : '', w.calories ? `${w.calories} kcal` : ''].filter(Boolean);
    const ex = (w.exercises || []).filter((x) => x.name);
    const exLine = ex.map((x) => `${esc(x.name)} ${x.sets}×${x.reps}${x.weight ? ` @ ${x.weight} kg` : ''}`).join(' · ');
    const pr = prs && prs.length ? `<span class="badge pr">PR</span>` : '';
    return `<li class="row">
      <div class="row-main"><strong>${esc(w.type)}</strong> <span class="muted">${bits.join(' · ')}</span> ${pr}
      ${exLine ? `<div class="muted small ex-line">${exLine}</div>` : ''}
      ${w.notes ? `<div class="muted small">${esc(w.notes)}</div>` : ''}</div>
      ${w.source && w.source !== 'manual' ? `<span class="badge">${w.source === 'apple' ? 'Apple' : 'import'}</span>` : ''}
      <button class="icon-btn small" data-edit="${w.id}" aria-label="Edit">✎</button>
      <button class="icon-btn small" data-del="${w.id}" aria-label="Delete">✕</button></li>`;
  }
  function handleWorkoutRowClick(e, rerender) {
    const del = e.target.closest('[data-del]');
    if (del)
      ask('Delete this workout?', { ok: 'Delete', danger: true }).then((yes) => {
        if (!yes) return;
        store.update((st) => (st.workouts = st.workouts.filter((w) => w.id !== del.dataset.del)));
        rerender();
      });
    const ed = e.target.closest('[data-edit]');
    if (ed) openWorkoutDialog(store.get().workouts.find((w) => w.id === ed.dataset.edit));
  }

  // ---------------- TODAY ----------------
  function renderToday(arg) {
    const s = store.get();
    const t = D.today();
    const day = arg && /^\d{4}-\d\d-\d\d$/.test(arg) ? arg : t;
    const prog = calc.challengeProgress(s, day);
    const score = calc.dayScore(s, day);
    const { current: streakNow, best } = calc.streaks(s, t);
    const wk = D.weekStart(day);
    const weekSessions = s.workouts.filter((w) => w.date >= wk && w.date <= D.addDays(wk, 6)).length;
    const entry = s.days[day] || { habits: {}, note: '' };
    const hd = s.health[day] || {};
    const ws = WA.workoutsOn(s, day);
    const ins = insights.generate(s).slice(0, 2);
    const title = day === t ? 'Today' : day === D.addDays(t, -1) ? 'Yesterday' : D.fmt(day, { weekday: 'long' });
    const plan = s.plans[wk] || {};
    const plannedType = plan.types && plan.types[dowShort(day)];
    const focus = plan.focus && s.habits.find((h) => h.id === plan.focus);
    const checks = s.habits.filter((h) => h.kind === 'check');
    const targets = s.habits.filter((h) => h.kind === 'target');
    const left = s.habits.filter((h) => !calc.habitDone(s, h, day)).length;
    const prsToday = strength.prsOn(s, day);

    view.innerHTML = `
    <header class="page-head">
      <div class="day-nav">
        <a class="icon-btn" href="#/today/${D.addDays(day, -1)}" aria-label="Previous day">‹</a>
        <div><h1>${title}</h1><div class="muted">${D.fmt(day, { weekday: 'short', month: 'long', day: 'numeric' })}</div></div>
        <a class="icon-btn ${day >= t ? 'disabled' : ''}" href="#/today/${D.addDays(day, 1)}" aria-label="Next day">›</a>
      </div>
    </header>

    <section class="hero">
      <div class="hero-top">
        <div class="hero-title">
          <span class="eyebrow">${esc(s.challenge.name)}</span>
          ${
            prog.started
              ? `<div class="hero-day"><span class="hero-num">${prog.day}</span><span class="hero-of">of ${prog.total}<br>days</span></div>`
              : `<div class="hero-day"><span class="hero-num">${D.diffDays(day, s.challenge.start)}</span><span class="hero-of">days<br>to go</span></div>`
          }
        </div>
        ${charts.ring(score, pct(score), left ? `${left} left` : 'done')}
      </div>
      ${charts.arc(s.challenge.start, s.challenge.end, day)}
      <div class="hero-stats">
        <div class="stat"><span class="stat-num">${streakNow}</span><span class="stat-label">day streak</span></div>
        <div class="stat"><span class="stat-num">${best}</span><span class="stat-label">best streak</span></div>
        <div class="stat"><span class="stat-num">${weekSessions}</span><span class="stat-label">sessions this week</span></div>
      </div>
    </section>

    <nav class="week-strip" aria-label="This week">
      ${D.range(wk, D.addDays(wk, 6))
        .map((d) => {
          const future = d > t;
          const sc = future ? 0 : calc.dayScore(s, d);
          const planned = plan.types && plan.types[dowShort(d)];
          return `<a href="#/today/${d}" class="wday ${d === day ? 'sel' : ''} ${future ? 'disabled future' : ''}" aria-label="${D.fmt(d, { weekday: 'long', month: 'short', day: 'numeric' })}${planned ? `, planned ${planned}` : ''}">
            <span class="wday-name">${D.fmt(d, { weekday: 'narrow' })}</span>${charts.miniRing(sc, D.parse(d).getDate())}<span class="wday-plan ${planned ? 'on' : ''}"></span></a>`;
        })
        .join('')}
    </nav>

    ${
      plannedType && !ws.length && day <= t
        ? `<div class="plan-banner">${WA.icon('workouts')}<span>Planned today: <b>${esc(plannedType)}</b></span><button class="btn small" data-quick="${esc(plannedType)}">Log it</button></div>`
        : ''
    }
    ${prsToday.length ? `<div class="plan-banner pr-banner">${WA.icon('spark')}<span><b>PR!</b> ${prsToday.map((p) => `${esc(p.name)} ${p.weight} kg × ${p.reps}`).join(', ')}</span></div>` : ''}

    <section class="card">
      <div class="card-head"><h2>Check-in</h2><a href="#/settings" class="link">Edit habits</a></div>
      <div class="pills">
        ${checks
          .map((h) => {
            const done = calc.habitDone(s, h, day);
            const auto = entry.habits[h.id] === undefined && done;
            return `<button class="pill ${done ? 'done' : ''} ${focus && focus.id === h.id ? 'focus' : ''}" data-toggle="${h.id}" aria-pressed="${done}">
              <span class="pill-icon">${h.icon}</span><span class="pill-name">${esc(h.name)}</span>${auto ? '<span class="badge">auto</span>' : ''}<span class="pill-check">${WA.icon('check')}</span></button>`;
          })
          .join('')}
      </div>
      ${
        targets.length
          ? `<ul class="targets">${targets
              .map((h) => {
                const done = calc.habitDone(s, h, day);
                const v = calc.habitValue(s, h, day);
                const manual = entry.habits[h.id];
                const fromHealth = typeof manual !== 'number' && v != null;
                return `<li class="target ${done ? 'done' : ''} ${focus && focus.id === h.id ? 'focus' : ''}">
                <span class="habit-icon">${h.icon}</span>
                <span class="habit-name">${esc(h.name)} ${fromHealth ? '<span class="badge">health</span>' : ''}<span class="bar-mini"><span style="width:${Math.min(100, ((v || 0) / h.target) * 100)}%"></span></span></span>
                <span class="stepper">
                  <button class="step" data-step="-1" data-h="${h.id}" aria-label="Less">−</button>
                  <input type="number" inputmode="decimal" step="any" min="0" data-value="${h.id}" value="${v ?? ''}" placeholder="0" aria-label="${esc(h.name)} amount">
                  <button class="step" data-step="1" data-h="${h.id}" aria-label="More">+</button>
                </span>
                <span class="target-goal muted">/ ${h.target.toLocaleString()} ${esc(h.unit || '')}</span></li>`;
              })
              .join('')}</ul>`
          : ''
      }
      ${focus ? `<p class="muted small focus-note">This week's focus: ${focus.icon} ${esc(focus.name)}</p>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>Workouts</h2><button class="btn small ghost" data-add-workout>Full log…</button></div>
      ${ws.length ? `<ul class="list">${ws.map((w) => workoutRow(w, strength.prsOn(s, w.date))).join('')}</ul>` : ''}
      <div class="chips">${WORKOUT_TYPES.slice(0, 8).map((ty) => `<button class="chip" data-quick="${ty}">${ty}<small>${s.settings.lastDuration[ty] || DEFAULT_MIN[ty]}m</small></button>`).join('')}</div>
      <p class="muted small">One tap logs it with your usual duration. Use Edit to add lifts, distance or notes.</p>
    </section>

    ${ins.length ? `<section class="stack">${ins.map(insightCard).join('')}</section>` : ''}

    <section class="card">
      <div class="card-head"><h2>Body & food</h2><a href="#/health" class="link">Sync</a></div>
      <div class="metric-grid">
        ${METRIC_FIELDS.slice(0, 6)
          .map(([k, label, unit, step]) => `<label class="metric"><span>${label}${unit ? ` <small>${unit}</small>` : ''}</span><input type="number" step="${step}" min="0" inputmode="decimal" data-metric="${k}" value="${hd[k] ?? ''}" placeholder="—"></label>`)
          .join('')}
      </div>
    </section>

    <section class="card">
      <h2>Notes</h2>
      <textarea id="note" rows="2" placeholder="How did today feel? Wins, struggles, energy…">${esc(entry.note || '')}</textarea>
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
      const st = e.target.closest('[data-step]');
      if (st) {
        store.update((x) => {
          const h = x.habits.find((y) => y.id === st.dataset.h);
          const en = WA.dayEntry(x, day);
          const cur = calc.habitValue(x, h, day) || 0;
          const step = stepFor(h);
          en.habits[h.id] = Math.max(0, +(cur + step * +st.dataset.step).toFixed(2));
        });
        return renderToday(day);
      }
      if (e.target.closest('[data-add-workout]')) return openWorkoutDialog({ date: day });
      const q = e.target.closest('[data-quick]');
      if (q) return logQuick(q.dataset.quick, day);
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

  // ---------------- workout dialog ----------------
  const exerciseRow = (x = {}) => `<div class="ex-row">
      <input list="exnames" data-x="name" value="${esc(x.name || '')}" placeholder="Exercise" aria-label="Exercise" autocomplete="off">
      <input type="number" inputmode="numeric" min="0" data-x="sets" value="${x.sets ?? ''}" placeholder="sets" aria-label="Sets">
      <input type="number" inputmode="numeric" min="0" data-x="reps" value="${x.reps ?? ''}" placeholder="reps" aria-label="Reps">
      <input type="number" inputmode="decimal" step="0.5" min="0" data-x="weight" value="${x.weight ?? ''}" placeholder="kg" aria-label="Weight">
      <button type="button" class="icon-btn small" data-x-remove aria-label="Remove exercise">✕</button></div>`;
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
    $('#exnames').innerHTML = strength.exerciseNames(store.get()).map((n) => `<option value="${esc(n)}">`).join('');
    $('#exercises').innerHTML = (w.exercises || []).map(exerciseRow).join('');
    $('h2', dlg).textContent = w.id ? 'Edit workout' : 'Log workout';
    dlg.showModal();
    (w.type ? f.duration : f.type).focus();
  }
  function readExercises() {
    return $$('#exercises .ex-row')
      .map((r) => ({ name: $('[data-x=name]', r).value.trim(), sets: +$('[data-x=sets]', r).value || 0, reps: +$('[data-x=reps]', r).value || 0, weight: +$('[data-x=weight]', r).value || 0 }))
      .filter((x) => x.name);
  }
  function setupWorkoutDialog() {
    const dlg = $('#workout-dialog');
    const form = $('form', dlg);
    const f = form.elements;
    $('#types').innerHTML = WORKOUT_TYPES.map((t) => `<option value="${t}">`).join('');
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    dlg.onclick = (e) => {
      if (e.target.closest('[data-add-ex]')) {
        $('#exercises').insertAdjacentHTML('beforeend', exerciseRow());
        $('#exercises .ex-row:last-child input').focus();
      } else if (e.target.closest('[data-x-remove]')) e.target.closest('.ex-row').remove();
      else if (e.target.closest('[data-copy-last]')) {
        const type = f.type.value.trim();
        const last = store
          .get()
          .workouts.filter((w) => w.id !== f.wid.value && (w.exercises || []).length && (!type || w.type === type))
          .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        if (!last) return toast('No earlier session with lifts to copy');
        $('#exercises').innerHTML = last.exercises.map(exerciseRow).join('');
        if (!f.duration.value) f.duration.value = last.duration;
        toast(`Copied ${last.exercises.length} lifts from ${D.fmt(last.date)}`);
      }
    };
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
        exercises: readExercises(),
        source: 'manual',
      };
      store.update((st) => {
        const i = st.workouts.findIndex((x) => x.id === rec.id);
        if (i >= 0) st.workouts[i] = { ...st.workouts[i], ...rec, source: st.workouts[i].source };
        else st.workouts.push(rec);
        if (rec.duration) st.settings.lastDuration[rec.type] = rec.duration;
      });
      dlg.close();
      const prs = strength.prsOn(store.get(), rec.date).filter((p) => rec.exercises.some((x) => x.name.trim().toLowerCase() === p.name.toLowerCase()));
      toast(prs.length ? `PR! ${prs.map((p) => p.name).join(', ')} 🔥` : 'Workout saved 💪');
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
    const lifts = strength.summary(s);
    const tonnage = strength.weekVolume(s, D.weekStart(t));

    view.innerHTML = `
    <header class="page-head"><h1>Workouts</h1><button class="btn" data-add-workout>+ Log workout</button></header>
    <section class="tiles">
      <div class="tile"><span class="stat-num">${wk.length}</span><span class="stat-label">sessions this week</span></div>
      <div class="tile"><span class="stat-num">${sum(wk)}</span><span class="stat-label">minutes this week</span></div>
      <div class="tile"><span class="stat-num">${tonnage >= 1000 ? (tonnage / 1000).toFixed(1) + ' t' : tonnage}</span><span class="stat-label">lifted this week</span></div>
      <div class="tile"><span class="stat-num">${ch.length}</span><span class="stat-label">sessions this challenge</span></div>
    </section>

    ${
      lifts.length
        ? `<section class="card">
      <div class="card-head"><h2>Lifts</h2><span class="muted small">est. 1RM = weight × (1 + reps/30)</span></div>
      <ul class="lifts">
        ${lifts
          .map((x) => {
            const pts = x.history.map((h) => ({ label: D.fmt(h.date, { month: 'numeric', day: 'numeric' }), y: h.e1rm, tip: `${D.fmt(h.date)}: ${h.sets}×${h.reps} @ ${h.weight} kg · e1RM ${h.e1rm}` }));
            const isPR = x.prs.includes(x.last.date);
            return `<li class="lift">
              <div class="lift-head"><strong>${esc(x.name)}</strong>${isPR ? '<span class="badge pr">PR</span>' : ''}<span class="muted small">${x.sessions} session${x.sessions === 1 ? '' : 's'}</span></div>
              <div class="lift-stats">
                <div><span class="stat-num">${x.last.weight}<small>kg</small></span><span class="stat-label">last · ${x.last.sets}×${x.last.reps} · ${D.fmt(x.last.date)}</span></div>
                <div><span class="stat-num">${x.best.e1rm}<small>kg</small></span><span class="stat-label">best est. 1RM · ${D.fmt(x.best.date)}</span></div>
              </div>
              ${pts.length >= 2 ? `<div class="lift-chart">${charts.line(pts, { height: 90, label: `${x.name} est. 1RM` })}</div>` : ''}
            </li>`;
          })
          .join('')}
      </ul>
    </section>`
        : `<section class="card notice"><p><strong>Track your lifts.</strong> Tap Edit on a strength workout and add exercises with sets × reps × kg. You'll get a per-lift history, estimated 1RM trend and PR alerts.</p></section>`
    }

    <section class="card">
      <div class="card-head"><h2>History</h2>
        <select id="wfilter" aria-label="Filter by type"><option value="">All types</option>${types.map((ty) => `<option ${ty === filter ? 'selected' : ''}>${esc(ty)}</option>`).join('')}</select></div>
      ${
        list.length
          ? Object.entries(byWeek)
              .map(
                ([ws, items]) => `<h3 class="week-head">Week of ${D.fmt(ws)} <span class="muted">· ${items.length} sessions · ${sum(items)} min</span></h3>
              <ul class="list">${items.map((w) => workoutRow(w, strength.prsOn(s, w.date)).replace('<div class="row-main">', `<div class="row-date">${D.fmt(w.date, { weekday: 'short', day: 'numeric' })}</div><div class="row-main">`)).join('')}</ul>`
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
    const goals = s.settings.goals || {};
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
      <button class="icon-btn" id="share" aria-label="Share this summary" title="Share">${WA.icon('share')}</button>
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
      <section class="card"><h2>Weight</h2>${charts.line(metricPts('weight', 'kg'), { goal: goals.goalWeight, label: 'Weight', empty: 'Log weight on Today or sync it' })}</section>
      <section class="card"><h2>Steps</h2>${charts.bar(metricPts('steps', 'steps'), { goal: goalOf('steps'), label: 'Steps', empty: 'No step data — sync on the Health tab' })}</section>
      <section class="card"><h2>Sleep</h2>${charts.bar(metricPts('sleepHrs', 'h'), { goal: goalOf('sleepHrs'), label: 'Sleep hours', empty: 'No sleep data — sync on the Health tab' })}</section>
      <section class="card"><h2>Protein</h2>${charts.bar(metricPts('protein', 'g'), { goal: goals.protein, label: 'Protein', empty: 'Log protein on Today (set a goal in Settings)' })}</section>
      <section class="card"><h2>Calories eaten</h2>${charts.bar(metricPts('calories', 'kcal'), { goal: goals.calories, label: 'Calories', empty: 'Log calories on Today (set a goal in Settings)' })}</section>
      <section class="card"><h2>Resting heart rate</h2>${charts.line(metricPts('restingHR', 'bpm'), { label: 'Resting heart rate', empty: 'No heart-rate data yet' })}</section>
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
      if (e.target.closest('#share')) return shareText(`${s.challenge.name} · ${label}`, summaryText(s, from, Math.min(to, t), label));
      const cell = e.target.closest('[data-date]');
      if (cell && cell.dataset.date <= t) go(`#/today/${cell.dataset.date}`);
    };
    view.onchange = null;
  }

  /** Plain-text summary for sharing to a friend or group chat. */
  function summaryText(s, from, to, label) {
    const days = D.range(from, to).filter((d) => d >= s.challenge.start && d <= s.challenge.end);
    const score = days.length ? mean(days.map((d) => calc.dayScore(s, d))) : 0;
    const ws = s.workouts.filter((w) => w.date >= from && w.date <= to);
    const mins = ws.reduce((a, w) => a + (+w.duration || 0), 0);
    const { current } = calc.streaks(s, to);
    const prog = calc.challengeProgress(s, to);
    const sleep = mean(days.map((d) => (s.health[d] || {}).sleepHrs).filter((v) => v != null));
    const steps = mean(days.map((d) => (s.health[d] || {}).steps).filter((v) => v != null));
    const prs = [...new Map(days.flatMap((d) => strength.prsOn(s, d)).map((p) => [p.name.toLowerCase(), `${p.name} ${p.weight}kg×${p.reps}`])).values()];
    const lines = [
      `❄️ ${s.challenge.name} — ${label} (day ${prog.day}/${prog.total})`,
      `✅ Habits: ${pct(score)} · 🔥 streak ${current}`,
      `🏋️ ${ws.length} workouts · ${mins} min`,
    ];
    if (steps) lines.push(`👟 ${Math.round(steps).toLocaleString()} steps/day`);
    if (sleep) lines.push(`🌙 ${sleep.toFixed(1)} h sleep/night`);
    if (prs.length) lines.push(`🏆 PRs: ${prs.join(', ')}`);
    return lines.join('\n');
  }

  // ---------------- WEEKLY REVIEW ----------------
  function renderReview(arg) {
    const s = store.get();
    const t = D.today();
    const dow = (D.parse(t).getDay() + 6) % 7; // 0 = Mon
    const defaultWeek = dow <= 2 ? D.addDays(D.weekStart(t), -7) : D.weekStart(t); // Mon–Wed: review last week
    const wk = arg && /^\d{4}-\d\d-\d\d$/.test(arg) ? D.weekStart(arg) : defaultWeek;
    const next = D.addDays(wk, 7);
    const end = D.addDays(wk, 6);
    const days = D.range(wk, end).filter((d) => d <= t && d >= s.challenge.start && d <= s.challenge.end);
    const prevDays = D.range(D.addDays(wk, -7), D.addDays(wk, -1)).filter((d) => d >= s.challenge.start && d <= s.challenge.end);
    const review = s.reviews[wk] || {};
    const plan = s.plans[next] || { focus: '', types: {}, note: '' };
    const score = days.length ? mean(days.map((d) => calc.dayScore(s, d))) : 0;
    const prevScore = prevDays.length ? mean(prevDays.map((d) => calc.dayScore(s, d))) : null;
    const ws = s.workouts.filter((w) => w.date >= wk && w.date <= end);
    const mins = ws.reduce((a, w) => a + (+w.duration || 0), 0);
    const tonnage = strength.weekVolume(s, wk);
    const hv = (k) => days.map((d) => (s.health[d] || {})[k]).filter((v) => v != null);
    const sleep = mean(hv('sleepHrs')), steps = mean(hv('steps')), protein = mean(hv('protein'));
    const weights = D.range(wk, end).map((d) => (s.health[d] || {}).weight).filter((v) => v != null);
    const wDelta = weights.length >= 2 ? weights[weights.length - 1] - weights[0] : null;
    const habitRows = s.habits.map((h) => {
      const hit = days.filter((d) => calc.habitDone(s, h, d)).length;
      const prev = prevDays.filter((d) => calc.habitDone(s, h, d)).length;
      return { h, hit, prev, rate: days.length ? hit / days.length : 0 };
    });
    const bestDay = days.length ? days.reduce((a, d) => (calc.dayScore(s, d) > calc.dayScore(s, a) ? d : a), days[0]) : null;
    const worstDay = days.length ? days.reduce((a, d) => (calc.dayScore(s, d) < calc.dayScore(s, a) ? d : a), days[0]) : null;
    const prs = [...new Map(days.flatMap((d) => strength.prsOn(s, d)).map((p) => [p.name.toLowerCase(), p])).values()];
    const delta = (a, b) => (b == null ? '' : a - b === 0 ? '<span class="delta flat">=</span>' : `<span class="delta ${a > b ? 'up' : 'down'}">${a > b ? '▲' : '▼'} ${Math.abs(a - b)}</span>`);

    view.innerHTML = `
    <header class="page-head"><div><span class="eyebrow">Weekly review</span><h1>Week of ${D.fmt(wk)}</h1></div>
      <div class="range-nav compact">
        <a class="icon-btn" href="#/review/${D.addDays(wk, -7)}" aria-label="Previous week">‹</a>
        <a class="icon-btn ${next > t ? 'disabled' : ''}" href="#/review/${next}" aria-label="Next week">›</a>
      </div></header>

    ${review.done ? `<div class="plan-banner done-banner">${WA.icon('check')}<span>Reviewed ${review.doneAt ? D.fmt(review.doneAt) : ''}. You can still edit it.</span></div>` : ''}

    <section class="tiles">
      <div class="tile"><span class="stat-num">${pct(score)}</span><span class="stat-label">habits ${prevScore != null ? `· prev ${pct(prevScore)}` : ''}</span></div>
      <div class="tile"><span class="stat-num">${ws.length}</span><span class="stat-label">workouts · ${mins} min</span></div>
      <div class="tile"><span class="stat-num">${sleep ? sleep.toFixed(1) + '<small>h</small>' : '—'}</span><span class="stat-label">avg sleep</span></div>
      <div class="tile"><span class="stat-num">${wDelta == null ? '—' : (wDelta > 0 ? '+' : '') + wDelta.toFixed(1) + '<small>kg</small>'}</span><span class="stat-label">weight change</span></div>
    </section>

    <section class="card">
      <h2>How the week went</h2>
      <ul class="review-habits">
        ${habitRows.map(({ h, hit, prev }) => `<li><span>${h.icon} ${esc(h.name)}</span><span class="hbar"><span style="width:${days.length ? (hit / days.length) * 100 : 0}%"></span></span><span class="num">${hit}/${days.length}</span>${delta(hit, prevDays.length ? prev : null)}</li>`).join('')}
      </ul>
      <div class="facts">
        ${bestDay ? `<span>Best day: <b>${D.fmt(bestDay, { weekday: 'short' })}</b> (${pct(calc.dayScore(s, bestDay))})</span>` : ''}
        ${worstDay && worstDay !== bestDay ? `<span>Hardest day: <b>${D.fmt(worstDay, { weekday: 'short' })}</b> (${pct(calc.dayScore(s, worstDay))})</span>` : ''}
        ${steps ? `<span>Steps: <b>${Math.round(steps).toLocaleString()}</b>/day</span>` : ''}
        ${protein ? `<span>Protein: <b>${Math.round(protein)} g</b>/day</span>` : ''}
        ${tonnage ? `<span>Lifted: <b>${(tonnage / 1000).toFixed(1)} t</b></span>` : ''}
        ${prs.length ? `<span>PRs: <b>${prs.map((p) => esc(p.name)).join(', ')}</b></span>` : ''}
      </div>
    </section>

    <section class="card">
      <h2>Reflect</h2>
      <label>What worked<textarea id="rv-worked" rows="2" placeholder="e.g. Training straight after work. Prepping lunches on Sunday.">${esc(review.worked || '')}</textarea></label>
      <label>What to change<textarea id="rv-change" rows="2" placeholder="e.g. Phone out of the bedroom. Walk at lunch instead of after dinner.">${esc(review.change || '')}</textarea></label>
    </section>

    <section class="card">
      <div class="card-head"><h2>Plan week of ${D.fmt(next)}</h2></div>
      <label class="row-field"><span>One habit to focus on</span>
        <select id="pl-focus"><option value="">— pick one —</option>${s.habits.map((h) => `<option value="${h.id}" ${plan.focus === h.id ? 'selected' : ''}>${h.icon} ${esc(h.name)}</option>`).join('')}</select></label>
      <div class="plan-grid">
        ${DOWS.map((d) => `<label class="plan-day ${plan.types && plan.types[d] ? 'on' : ''}"><span>${d}</span>
          <select data-plan-day="${d}" aria-label="${d} training"><option value="">rest</option>${WORKOUT_TYPES.map((ty) => `<option ${plan.types && plan.types[d] === ty ? 'selected' : ''}>${ty}</option>`).join('')}</select></label>`).join('')}
      </div>
      <label>Note to self<textarea id="pl-note" rows="2" placeholder="Anything to remember for next week">${esc(plan.note || '')}</textarea></label>
      <div class="btn-row">
        <button class="btn" id="rv-done">${review.done ? 'Update review' : 'Finish review'}</button>
        <button class="btn ghost" id="rv-share">${WA.icon('share')} Share week</button>
      </div>
    </section>`;

    const savePlan = () => {
      store.update((st) => {
        const p = (st.plans[next] = st.plans[next] || { focus: '', types: {}, note: '' });
        p.focus = $('#pl-focus').value;
        p.types = {};
        $$('[data-plan-day]').forEach((sel) => sel.value && (p.types[sel.dataset.planDay] = sel.value));
        p.note = $('#pl-note').value;
      });
      $$('.plan-day').forEach((l) => l.classList.toggle('on', !!$('select', l).value));
    };
    const saveReview = () => store.update((st) => (st.reviews[wk] = { ...(st.reviews[wk] || {}), worked: $('#rv-worked').value, change: $('#rv-change').value }));
    view.onchange = (e) => {
      if (e.target.id.startsWith('rv-')) saveReview();
      else savePlan();
    };
    view.onclick = (e) => {
      if (e.target.closest('#rv-done')) {
        saveReview();
        savePlan();
        store.update((st) => (st.reviews[wk] = { ...(st.reviews[wk] || {}), done: true, doneAt: t }));
        toast('Review saved. Next week is planned 💪');
        renderReview(wk);
      } else if (e.target.closest('#rv-share')) {
        const txt = summaryText(s, wk, Math.min(end, t), `week of ${D.fmt(wk)}`) + (review.worked ? `\n💡 ${review.worked}` : '');
        shareText(`${s.challenge.name} — week of ${D.fmt(wk)}`, txt);
      }
    };
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
  function applySync(text, source) {
    const result = health.importSyncText(text);
    let summary;
    store.update((st) => (summary = health.mergeImport(st, result, source)));
    return { ...summary, columns: result.columns };
  }
  function renderHealth() {
    const s = store.get();
    const t = D.today();
    const meta = s.healthMeta;
    const recent = D.range(D.addDays(t, -13), t).reverse();
    const defaultSince = D.addDays(s.challenge.start, -60);
    const base = location.origin + location.pathname;

    view.innerHTML = `
    <header class="page-head"><h1>Health data</h1></header>
    <section class="card notice">
      <p><strong>Why not automatic?</strong> Apple Health and Google Health Connect only share data with native apps on the phone, so a web app can't read them directly. Everything below is processed on this device; nothing is uploaded.</p>
      ${meta.lastImport ? `<p class="muted small">Last sync: ${new Date(meta.lastImport).toLocaleString()} · ${esc(meta.source)} · ${meta.records.toLocaleString()} records</p>` : ''}
    </section>

    <section class="card">
      <h2>One-tap sync from iPhone (Shortcut)</h2>
      <p class="small">Build a Shortcut once; after that, one tap (or a daily automation) sends the last 7 days of Health data into this app. It opens this URL with the data attached:</p>
      <code class="url">${esc(base)}?sync=…</code>
      <details class="steps-details"><summary>How to build the Shortcut</summary>
      <ol class="steps">
        <li>Open <b>Shortcuts</b> → <b>+</b> → name it <i>Sync Winter Arc</i>.</li>
        <li>Add <b>Find Health Samples</b>: type <i>Steps</i>, Start Date <i>is in the last 7 days</i>, and turn on <b>Group by Day</b>.</li>
        <li>Add <b>Repeat with Each</b> over the samples. Inside, add <b>Text</b> containing <code>Start Date</code> (format <i>Custom</i>: <code>yyyy-MM-dd</code>), then <code>:</code>, then <code>Value</code>. After the repeat, add <b>Combine Text</b> with the separator <code>,</code> and <b>Set Variable</b> <i>steps</i>.</li>
        <li>Repeat steps 2–3 for <i>Sleep Analysis</i> (variable <i>sleep</i>), <i>Resting Heart Rate</i> (<i>rhr</i>), <i>Weight</i> (<i>weight</i>, or <i>weightlb</i> if you use pounds), <i>Dietary Energy</i> (<i>kcal</i>) and <i>Protein</i> (<i>protein</i>). Skip any you don't track.</li>
        <li>Add a final <b>Text</b>: <code>steps=[steps];sleep=[sleep];rhr=[rhr];weight=[weight];kcal=[kcal];protein=[protein]</code> (insert the variables), then <b>URL Encode</b> it.</li>
        <li>Add <b>Open URLs</b> with <code>${esc(base)}?sync=</code> followed by the encoded text.</li>
        <li>Optional: in Shortcuts → <b>Automation</b>, run it daily at a set time, with "Run immediately" on.</li>
      </ol>
      <p class="muted small">Action names can differ slightly between iOS versions. Minutes of sleep, metres and pounds are converted automatically. Steps, sleep and heart rate from Apple Watch are what Health shows for the day.</p>
      </details>
      <label>Or paste sync text here<textarea id="synctext" rows="2" placeholder="steps=2026-10-13:12034,2026-10-12:8800;sleep=2026-10-13:7.4;rhr=2026-10-13:57"></textarea></label>
      <button class="btn small" id="syncbtn">Import text</button>
    </section>

    <section class="card">
      <h2> Apple Health export (full history)</h2>
      <ol class="steps">
        <li>On iPhone open <b>Health</b> → tap your profile picture → <b>Export All Health Data</b>.</li>
        <li>Save <code>export.zip</code> to Files (or AirDrop it to your computer).</li>
        <li>Choose it below. Large exports take a minute.</li>
      </ol>
      <label class="row-field"><span>Import data from</span><input type="date" id="since" value="${defaultSince}"></label>
      <label class="file-btn btn">Choose export.zip / export.xml<input type="file" id="apple" accept=".zip,.xml,application/zip,text/xml"></label>
      <div class="progress" id="apple-progress" hidden><span></span></div>
      <p class="muted small">Imports steps, active energy, exercise minutes, distance, sleep, resting heart rate, HRV, weight, calories eaten, protein and all workouts.</p>
    </section>

    <section class="card">
      <h2>Google Fit / Health Connect / other CSV</h2>
      <ul class="steps">
        <li><b>Google Fit:</b> takeout.google.com → select <b>Fit</b> → export → open <code>Fit/Daily activity metrics/Daily activity metrics.csv</code>.</li>
        <li><b>Health Connect / Samsung / Fitbit / Garmin / MyFitnessPal:</b> export daily summaries as CSV (apps like Health Sync or Health Auto Export do this on a schedule).</li>
        <li>Any spreadsheet works if it has a <b>Date</b> column plus columns like <i>Steps, Sleep, Resting heart rate, Weight, Protein, Dietary calories</i>.</li>
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

    view.onclick = (e) => {
      if (e.target.id === 'syncbtn') {
        try {
          const r = applySync($('#synctext').value, 'Pasted sync text');
          toast(`Imported ${r.days} day${r.days === 1 ? '' : 's'} (${r.columns.join(', ')})`);
          renderHealth();
        } catch (err) {
          tell(err.message);
        }
      }
    };
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
        tell(`Import failed: ${err.message}`);
        renderHealth();
      }
    };
  }

  // ---------------- SETTINGS ----------------
  function renderSettings() {
    const s = store.get();
    const g = s.settings.goals || {};
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
      <h2>Goals</h2>
      <div class="form-grid">
        <label>Goal weight <small>kg</small><input type="number" step="0.1" min="0" inputmode="decimal" data-goal="goalWeight" value="${g.goalWeight ?? ''}" placeholder="—"></label>
        <label>Calories <small>kcal/day</small><input type="number" step="10" min="0" inputmode="numeric" data-goal="calories" value="${g.calories ?? ''}" placeholder="—"></label>
        <label>Protein <small>g/day</small><input type="number" step="5" min="0" inputmode="numeric" data-goal="protein" value="${g.protein ?? ''}" placeholder="—"></label>
      </div>
      <p class="muted small">Goals draw a line on the charts and power nutrition and weight-trend insights. A common protein target is 1.6–2.2 g per kg of body weight.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Habits</h2><button class="btn small" id="add-habit">+ Add habit</button></div>
      <p class="muted small"><b>Check</b> habits are done/not done. <b>Target</b> habits have a number goal; link one to a health metric and it fills itself from synced data. "Train" ticks automatically when you log a workout.</p>
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
        ask('Remove this habit? Past check-ins for it stay in your data.', { ok: 'Remove', danger: true }).then((y) => y && editHabit(i, (h, st) => st.habits.splice(i, 1)));
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
        ask('Replace your data with 6 weeks of sample data?', { ok: 'Load demo data' }).then((y) => {
          if (!y) return;
          store.set(WA.demo(store.get()));
          toast('Demo data loaded');
          go('#/today');
        });
      } else if (e.target.id === 'reset') {
        ask('Delete all Winter Arc data on this device? Export a backup first if unsure.', { ok: 'Delete everything', danger: true }).then((y) => {
          if (!y) return;
          store.reset();
          toast('Reset complete');
          renderSettings();
        });
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
      if (el.dataset.goal) {
        store.update((st) => (st.settings.goals[el.dataset.goal] = el.value === '' ? null : parseFloat(el.value)));
        toast('Goal saved');
      }
      if (el.id === 'restore' && el.files[0]) {
        try {
          const data = JSON.parse(await el.files[0].text());
          if (!data.challenge || !Array.isArray(data.habits)) throw new Error('Not a Winter Arc backup');
          if (await ask('Replace current data with this backup?', { ok: 'Restore' })) {
            store.set(data);
            toast('Backup restored');
            renderSettings();
          }
        } catch (err) {
          tell(`Could not restore: ${err.message}`);
        }
      }
    };
    $('#challenge').onsubmit = (e) => {
      e.preventDefault();
      const f = e.target.elements;
      if (f.end.value < f.start.value) return tell('The end date must be after the start date.');
      store.update((st) => Object.assign(st.challenge, { name: f.name.value.trim() || 'Winter Arc', start: f.start.value, end: f.end.value }));
      toast('Challenge saved');
      renderSettings();
    };
  }

  // ---------------- boot ----------------
  store.load();
  setupWorkoutDialog();
  $$('.nav a[data-icon]').forEach((a) => a.insertAdjacentHTML('afterbegin', WA.icon(a.dataset.icon)));
  $('#fab').innerHTML = WA.icon('plus');
  charts.installTooltips(document);
  $('#fab').onclick = () => openWorkoutDialog({ date: current.startsWith('#/today/') ? current.split('/')[2] : D.today() });
  // ?sync=… from the iPhone Shortcut (or anything that can open a URL)
  const syncParam = new URLSearchParams(location.search).get('sync');
  if (syncParam) {
    try {
      const r = applySync(syncParam, 'iPhone Shortcut');
      current = '#/today';
      history.replaceState(null, '', location.pathname + '#/today');
      setTimeout(() => toast(`Synced ${r.days} day${r.days === 1 ? '' : 's'}: ${r.columns.join(', ')}`), 50);
    } catch (err) {
      setTimeout(() => tell(`Sync failed: ${err.message}`), 50);
    }
  }
  route();
  reminders.start();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
