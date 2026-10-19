/* Run with: node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const zlib = require('zlib');
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] };
for (const f of ['store', 'charts', 'strength', 'focus', 'health-import', 'insights', 'demo']) require(path.join(__dirname, '..', 'js', f + '.js'));
const WA = globalThis.WA;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_US">
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-10-05 08:00:00 -0400" endDate="2026-10-05 08:10:00 -0400" value="4000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-10-05 18:00:00 -0400" endDate="2026-10-05 18:10:00 -0400" value="3000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" startDate="2026-10-05 08:00:00 -0400" endDate="2026-10-05 08:10:00 -0400" value="6500"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch" unit="count/min" startDate="2026-10-05 07:00:00 -0400" endDate="2026-10-05 07:00:00 -0400" value="58">
  <MetadataEntry key="x" value="y"/>
 </Record>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="lb" startDate="2026-10-05 07:00:00 -0400" endDate="2026-10-05 07:00:00 -0400" value="180"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-10-04 23:00:00 -0400" endDate="2026-10-05 03:00:00 -0400" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-10-05 03:00:00 -0400" endDate="2026-10-05 06:30:00 -0400" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="iPhone" startDate="2026-10-04 22:30:00 -0400" endDate="2026-10-05 06:45:00 -0400" value="HKCategoryValueSleepAnalysisInBed"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2020-01-01 08:00:00 -0400" endDate="2020-01-01 08:10:00 -0400" value="999"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45.5" durationUnit="min" sourceName="Apple Watch" startDate="2026-10-05 17:00:00 -0400" endDate="2026-10-05 17:45:30 -0400">
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="x" endDate="y" sum="310.4" unit="kcal"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalDistance="3.1" totalDistanceUnit="mi" totalEnergyBurned="300" totalEnergyBurnedUnit="kcal" sourceName="Apple Watch" startDate="2026-10-06 07:00:00 -0400" endDate="2026-10-06 07:30:00 -0400"/>
</HealthData>`;

function check(r) {
  const d = r.days['2026-10-05'];
  assert.strictEqual(d.steps, 7000, 'max source (iPhone 7000 > Watch 6500), not double counted');
  assert.strictEqual(d.restingHR, 58);
  assert.strictEqual(d.weight, 81.6);
  assert.strictEqual(d.sleepHrs, 7.5, 'asleep stages preferred over in-bed');
  assert.ok(!r.days['2020-01-01'], 'since filter');
  assert.strictEqual(r.workouts.length, 2);
  assert.deepStrictEqual([r.workouts[0].type, r.workouts[0].duration, r.workouts[0].calories], ['Strength', 46, 310]);
  assert.strictEqual(r.workouts[1].distance, 4.99);
}

test('Apple XML parser handles chunk boundaries anywhere', () => {
  for (const size of [1, 7, 64, 100000]) {
    const p = WA.health.AppleXmlParser('2026-01-01');
    for (let i = 0; i < XML.length; i += size) p.push(XML.slice(i, i + size));
    check(p.end());
  }
});

function makeZip(name, data) {
  // minimal single-entry deflate zip
  const comp = zlib.deflateRawSync(data);
  const nameB = Buffer.from(name);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = 30 + nameB.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameB.length, 12); eocd.writeUInt32LE(cdOff, 16);
  return Buffer.concat([lh, nameB, comp, cd, nameB, eocd]);
}

test('Apple export.zip is streamed and decompressed', async () => {
  const zip = makeZip('apple_health_export/export.xml', Buffer.from(XML));
  const file = new File([zip], 'export.zip');
  const r = await WA.health.importAppleHealth(file, { since: '2026-01-01' });
  check(r);
});

test('CSV import: Google Fit daily metrics', () => {
  const csv = 'Date,Move Minutes count,Calories (kcal),Distance (m),Heart Points,Step count,Average weight (kg)\n2026-10-05,62,2400.5,8123.4,30,10234,80.1\n2026-10-06,,,,,,\n';
  const r = WA.health.importCSVText(csv);
  assert.deepStrictEqual(r.days['2026-10-05'], { exerciseMin: 62, activeEnergy: 2401, distanceKm: 8.12, steps: 10234, weight: 80.1 });
});

test('CSV import: Health Auto Export style with sleep stages', () => {
  const csv = '"Date","Step Count (count)","Sleep Analysis [In Bed] (hr)","Sleep Analysis [Asleep] (hr)","Resting Heart Rate (count/min)","Weight & Body Mass (lb)"\n"2026-10-05 00:00:00","8,500","8.2","7.4","57","176"\n';
  const r = WA.health.importCSVText(csv);
  assert.deepStrictEqual(r.days['2026-10-05'], { steps: 8500, sleepHrs: 7.4, restingHR: 57, weight: 79.83 });
});

test('habits, streaks and auto-completion', () => {
  const s = WA.defaultState();
  s.challenge = { name: 'W', start: '2026-10-01', end: '2026-10-10' };
  s.habits = [
    { id: 'w', name: 'Train', kind: 'check', auto: 'workout' },
    { id: 's', name: 'Steps', kind: 'target', target: 10000, metric: 'steps' },
  ];
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06']) {
    s.workouts.push({ id: d, date: d, type: 'Run', duration: 30 });
    s.health[d] = { steps: 12000 };
  }
  assert.strictEqual(WA.calc.dayScore(s, '2026-10-04'), 0);
  assert.deepStrictEqual(WA.calc.streaks(s, '2026-10-06'), { current: 2, best: 3 });
  // today incomplete doesn't break the current streak
  assert.deepStrictEqual(WA.calc.streaks(s, '2026-10-07'), { current: 2, best: 3 });
  // manual override wins over auto
  s.days['2026-10-06'] = { habits: { w: false } };
  assert.strictEqual(WA.calc.habitDone(s, s.habits[0], '2026-10-06'), false);
});

test('insights run on demo data without throwing and produce useful output', () => {
  const s = WA.demo(WA.defaultState());
  const list = WA.insights.generate(s);
  assert.ok(list.length >= 3, JSON.stringify(list));
  for (const i of list) assert.ok(i.title && i.body && ['good', 'warn', 'info'].includes(i.level));
  // empty state
  assert.ok(WA.insights.generate(WA.defaultState()).some((i) => i.id === 'no-health'));
});

test('charts render SVG and empty states', () => {
  assert.match(WA.charts.bar([{ label: 'a', y: 3 }, { label: 'b', y: 0 }], { goal: 2 }), /<svg/);
  assert.match(WA.charts.line([{ label: 'a', y: null }], {}), /chart-empty/);
  assert.match(WA.charts.heatmap([{ date: '2026-10-01', score: 1, tip: 'x' }]), /hm-4/);
});

test('strength: history, est 1RM, PRs and weekly tonnage', () => {
  const s = WA.defaultState();
  s.workouts.push(
    { id: 'a', date: '2026-10-05', type: 'Strength', duration: 45, exercises: [{ name: 'Squat', sets: 3, reps: 5, weight: 100 }, { name: 'Bench', sets: 3, reps: 5, weight: 60 }] },
    { id: 'b', date: '2026-10-07', type: 'Strength', duration: 45, exercises: [{ name: 'squat', sets: 3, reps: 5, weight: 102.5 }] },
    { id: 'c', date: '2026-10-09', type: 'Strength', duration: 45, exercises: [{ name: 'Squat', sets: 3, reps: 3, weight: 105 }] } // 105×(1+3/30)=115.5 < 122.1: not a PR
  );
  const sum = WA.strength.summary(s);
  const squat = sum.find((x) => x.key === 'squat');
  assert.strictEqual(squat.sessions, 3);
  assert.strictEqual(squat.best.e1rm, 119.6);
  assert.deepStrictEqual(squat.prs, ['2026-10-07']);
  assert.strictEqual(WA.strength.prsOn(s, '2026-10-09').length, 0);
  assert.strictEqual(WA.strength.weekVolume(s, '2026-10-05'), 3 * 5 * 100 + 3 * 5 * 60 + 3 * 5 * 102.5 + 3 * 3 * 105);
});

test('sync text import: units, minutes, pounds, repeats', () => {
  const r = WA.health.importSyncText('Steps=2026-10-13:12034,2026-10-12:8800;sleep=2026-10-13:444;RHR=2026-10-13:57;weightlb=2026-10-13:180;protein=2026-10-13:80,2026-10-13:70');
  assert.deepStrictEqual(r.days['2026-10-13'], { steps: 12034, sleepHrs: 7.4, restingHR: 57, weight: 81.65, protein: 150 });
  assert.deepStrictEqual(r.days['2026-10-12'], { steps: 8800 });
  assert.throws(() => WA.health.importSyncText('nothing useful'));
});

test('insights: plan, PR, nutrition and goal-weight rules fire', () => {
  const s = WA.demo(WA.defaultState());
  const ids = WA.insights.generate(s).map((i) => i.id);
  for (const want of ['pr', 'goal-weight']) assert.ok(ids.includes(want), `${want} missing from ${ids}`);
});

test('90:90:1: required days, streaks, hit rate, timer', () => {
  const s = WA.defaultState();
  s.focus.mission = { title: 'Ship it', start: '2026-10-05', days: 90, minutes: 90, schedule: 'weekdays' }; // Mon
  s.habits.push({ id: 'focus', name: 'Focus block', icon: '🎯', kind: 'check', auto: 'focus' });
  WA.focus.logSession(s, '2026-10-05', 95, ['a']);
  WA.focus.logSession(s, '2026-10-06', 60, []);
  WA.focus.logSession(s, '2026-10-06', 30, ['b']); // adds up to 90
  WA.focus.logSession(s, '2026-10-08', 100, []);
  WA.focus.logSession(s, '2026-10-10', 40, []); // Saturday: optional
  const st = WA.focus.stats(s, '2026-10-09'); // Friday, not yet done
  assert.deepStrictEqual([st.dayNo, st.requiredSoFar, st.hit, st.missed, st.streak, st.best], [5, 5, 3, 1, 1, 2]);
  assert.strictEqual(s.focus.sessions['2026-10-06'].taskIds.length, 1);
  assert.strictEqual(WA.calc.habitDone(s, s.habits.find((h) => h.auto === 'focus'), '2026-10-06'), true);
  assert.strictEqual(WA.calc.habitDone(s, s.habits.find((h) => h.auto === 'focus'), '2026-10-07'), false);
  const cal = WA.focus.calendar(s, '2026-10-09');
  assert.deepStrictEqual(cal.slice(0, 7).map((c) => c.state), ['hit', 'hit', 'miss', 'hit', 'today', 'hit', 'off']);
  assert.strictEqual(cal.length, 90);
  WA.focus.startTimer(['a']);
  assert.ok(WA.focus.timer());
  const r = WA.focus.stopTimer();
  assert.deepStrictEqual([r.minutes, r.taskIds, WA.focus.timer()], [1, ['a'], null]);
});

test('90:90:1 segments: workouts credit the fitness segment; both segments needed', () => {
  const s = WA.defaultState();
  s.focus.mission = { title: 'Better', start: '2026-10-05', days: 90, schedule: 'daily', segments: [{ id: 'fit', name: 'Fitness', minutes: 60, source: 'workouts' }, { id: 'top3', name: 'Top 3', minutes: 30, source: 'manual' }] };
  assert.strictEqual(WA.focus.targetMinutes(s.focus.mission), 90);
  s.workouts.push({ id: 'w', date: '2026-10-06', type: 'Run', duration: 45 });
  WA.focus.logSession(s, '2026-10-06', 20, [], '', 'fit'); // 45 + 20 = 65 ≥ 60
  assert.strictEqual(WA.focus.segmentMinutes(s, '2026-10-06', s.focus.mission.segments[0]), 65);
  assert.strictEqual(WA.focus.doneOn(s, '2026-10-06'), false, 'top 3 segment still empty');
  WA.focus.logSession(s, '2026-10-06', 30, [], '', 'top3');
  assert.strictEqual(WA.focus.doneOn(s, '2026-10-06'), true);
  assert.strictEqual(WA.focus.minutesOn(s, '2026-10-06'), 95);
  // legacy mission without segments still works
  const o = WA.defaultState();
  o.focus.mission = { title: 'Old', start: '2026-10-05', days: 90, minutes: 90, schedule: 'daily' };
  o.focus.sessions['2026-10-05'] = { minutes: 90, taskIds: [] };
  assert.strictEqual(WA.focus.doneOn(o, '2026-10-05'), true);
});

test('90:90:1 on-time tracking: ±window around block time', () => {
  const s = WA.defaultState();
  s.focus.mission = { title: 'Better', start: '2026-10-05', days: 90, schedule: 'daily', blockTime: '06:30', tolerance: 30, segments: [{ id: 'a', name: 'A', minutes: 10, source: 'manual' }] };
  WA.focus.setStartTime(s, '2026-10-05', '06:40'); // +10 on time
  WA.focus.setStartTime(s, '2026-10-06', '07:15'); // +45 late
  WA.focus.setStartTime(s, '2026-10-07', '06:00'); // -30 on time (edge)
  WA.focus.setStartTime(s, '2026-10-08', '05:55'); // -35 early = not in window
  assert.deepStrictEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => WA.focus.onTimeOn(s, d)), [true, false, true, false]);
  assert.strictEqual(WA.focus.onTimeOn(s, '2026-10-09'), null);
  const p = WA.focus.punctuality(s, '2026-10-09');
  assert.deepStrictEqual([p.started, p.onTime, p.late, p.avgDelta], [4, 2, 1, -2]); // (10+45-30-35)/4 = -2.5 → -2 (round half toward +inf)
});
