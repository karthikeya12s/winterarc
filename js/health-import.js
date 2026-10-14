/* Winter Arc — health data importers.
 *
 * Browsers cannot read Apple Health or Google Health Connect directly (both are
 * on-device APIs for native apps), so we import the files those platforms export:
 *   - Apple Health:  Health app → profile → Export All Health Data → export.zip (or the export.xml inside)
 *   - Google:        Google Takeout "Fit" → "Daily activity metrics.csv", or any daily CSV
 *   - Health Auto Export (iOS app) and similar daily CSV exports
 * Everything is parsed locally, streamed so multi‑hundred‑MB exports don't blow up memory,
 * and reduced to one row of daily metrics per date. */
(function (root) {
  const WA = (root.WA = root.WA || {});

  const METRICS = {
    steps: { label: 'Steps', unit: '', agg: 'sum' },
    activeEnergy: { label: 'Active energy', unit: 'kcal', agg: 'sum' },
    exerciseMin: { label: 'Exercise', unit: 'min', agg: 'sum' },
    distanceKm: { label: 'Distance', unit: 'km', agg: 'sum' },
    restingHR: { label: 'Resting HR', unit: 'bpm', agg: 'avg' },
    hrv: { label: 'HRV', unit: 'ms', agg: 'avg' },
    sleepHrs: { label: 'Sleep', unit: 'h', agg: 'sum' },
    weight: { label: 'Weight', unit: 'kg', agg: 'last' },
    calories: { label: 'Calories eaten', unit: 'kcal', agg: 'sum' },
    protein: { label: 'Protein', unit: 'g', agg: 'sum' },
  };

  const APPLE_TYPES = {
    HKQuantityTypeIdentifierStepCount: 'steps',
    HKQuantityTypeIdentifierActiveEnergyBurned: 'activeEnergy',
    HKQuantityTypeIdentifierAppleExerciseTime: 'exerciseMin',
    HKQuantityTypeIdentifierDistanceWalkingRunning: 'distanceKm',
    HKQuantityTypeIdentifierRestingHeartRate: 'restingHR',
    HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'hrv',
    HKQuantityTypeIdentifierBodyMass: 'weight',
    HKQuantityTypeIdentifierDietaryEnergyConsumed: 'calories',
    HKQuantityTypeIdentifierDietaryProtein: 'protein',
    HKCategoryTypeIdentifierSleepAnalysis: 'sleep',
  };

  // ---------- small helpers ----------
  const attrRe = /(\w+)="([^"]*)"/g;
  function attrs(tag) {
    const o = {};
    let m;
    attrRe.lastIndex = 0;
    while ((m = attrRe.exec(tag))) o[m[1]] = m[2];
    return o;
  }
  // "2024-01-01 07:50:00 -0500" -> epoch ms
  function appleTime(s) {
    const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)$/.exec(s || '');
    return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : Date.parse(s);
  }
  const localDay = (s) => (s || '').slice(0, 10); // date as recorded on the device
  const toKm = (v, unit) => (unit === 'mi' ? v * 1.609344 : unit === 'm' ? v / 1000 : v);
  const toKg = (v, unit) => (unit === 'lb' ? v * 0.45359237 : v);

  function prettyWorkoutType(t) {
    const name = (t || '').replace('HKWorkoutActivityType', '');
    const map = {
      TraditionalStrengthTraining: 'Strength',
      FunctionalStrengthTraining: 'Functional strength',
      HighIntensityIntervalTraining: 'HIIT',
      MixedCardio: 'Cardio',
      CoreTraining: 'Core',
      Running: 'Run',
      Walking: 'Walk',
      Cycling: 'Cycle',
      Swimming: 'Swim',
    };
    return map[name] || name.replace(/([a-z])([A-Z])/g, '$1 $2') || 'Workout';
  }

  /** Accumulates raw samples and reduces them to daily values. */
  function Aggregator(since) {
    // sums: metric -> date -> source -> total (we keep the max source per day, which
    // avoids double counting iPhone + Apple Watch steps the way Health's own dedupe roughly does)
    const sums = {};
    const avgs = {};
    const lasts = {};
    const sleep = { asleep: {}, inBed: {} };
    const workouts = [];
    let records = 0;

    function addSum(metric, date, source, v) {
      const m = (sums[metric] = sums[metric] || {});
      const d = (m[date] = m[date] || {});
      d[source] = (d[source] || 0) + v;
    }
    return {
      record(a) {
        const metric = APPLE_TYPES[a.type];
        if (!metric) return;
        const date = localDay(a.startDate);
        if (since && date < since) return;
        records++;
        const src = a.sourceName || '?';
        if (metric === 'sleep') {
          const hrs = (appleTime(a.endDate) - appleTime(a.startDate)) / 3600000;
          if (!(hrs > 0 && hrs < 24)) return;
          const wake = localDay(a.endDate); // a night's sleep belongs to the morning you wake up
          const bucket = /Asleep/.test(a.value) ? sleep.asleep : /InBed/.test(a.value) ? sleep.inBed : null;
          if (!bucket) return;
          const d = (bucket[wake] = bucket[wake] || {});
          d[src] = (d[src] || 0) + hrs;
          return;
        }
        let v = parseFloat(a.value);
        if (!isFinite(v)) return;
        if (metric === 'distanceKm') v = toKm(v, a.unit);
        if ((metric === 'activeEnergy' || metric === 'calories') && a.unit === 'kJ') v = v / 4.184;
        const agg = METRICS[metric].agg;
        if (agg === 'sum') addSum(metric, date, src, v);
        else if (agg === 'avg') {
          const m = (avgs[metric] = avgs[metric] || {});
          const d = (m[date] = m[date] || [0, 0]);
          d[0] += v;
          d[1]++;
        } else {
          if (metric === 'weight') v = toKg(v, a.unit);
          const m = (lasts[metric] = lasts[metric] || {});
          const t = appleTime(a.startDate);
          if (!m[date] || t >= m[date][0]) m[date] = [t, v];
        }
      },
      workout(w) {
        const date = localDay(w.startDate);
        if (since && date < since) return;
        let minutes = parseFloat(w.duration);
        if (w.durationUnit === 's' || w.durationUnit === 'sec') minutes /= 60;
        if (w.durationUnit === 'hr' || w.durationUnit === 'h') minutes *= 60;
        if (!isFinite(minutes)) minutes = (appleTime(w.endDate) - appleTime(w.startDate)) / 60000;
        const kcal = parseFloat(w.totalEnergyBurned || w._energy);
        const dist = parseFloat(w.totalDistance || w._distance);
        workouts.push({
          id: 'apple-' + w.startDate,
          date,
          type: prettyWorkoutType(w.workoutActivityType),
          duration: Math.round(minutes),
          calories: isFinite(kcal) ? Math.round(kcal) : null,
          distance: isFinite(dist) ? +toKm(dist, w.totalDistanceUnit || w._distanceUnit).toFixed(2) : null,
          rpe: null,
          notes: w.sourceName ? `from ${w.sourceName}` : '',
          source: 'apple',
        });
      },
      result() {
        const days = {};
        const put = (date, k, v) => ((days[date] = days[date] || {})[k] = v);
        const maxSrc = (o) => Math.max(...Object.values(o));
        for (const [metric, byDate] of Object.entries(sums))
          for (const [date, bySrc] of Object.entries(byDate)) {
            const v = maxSrc(bySrc);
            put(date, metric, metric === 'distanceKm' ? +v.toFixed(2) : Math.round(v));
          }
        for (const [metric, byDate] of Object.entries(avgs))
          for (const [date, [s, n]] of Object.entries(byDate)) put(date, metric, Math.round(s / n));
        for (const [metric, byDate] of Object.entries(lasts))
          for (const [date, [, v]] of Object.entries(byDate)) put(date, metric, +v.toFixed(1));
        const sleepDates = new Set([...Object.keys(sleep.asleep), ...Object.keys(sleep.inBed)]);
        for (const date of sleepDates) {
          const v = sleep.asleep[date] ? maxSrc(sleep.asleep[date]) : maxSrc(sleep.inBed[date]);
          put(date, 'sleepHrs', +v.toFixed(1));
        }
        return { days, workouts, records };
      },
    };
  }

  /** Feed Apple Health XML text in arbitrary chunks. */
  function AppleXmlParser(since) {
    const agg = Aggregator(since);
    const tagRe = /<(Record|Workout|WorkoutStatistics|\/Workout)\b[^>]*>/g;
    let buf = '';
    let current = null; // open <Workout> collecting child statistics
    function handle(name, tag) {
      if (name === 'Record') return agg.record(attrs(tag));
      if (name === 'Workout') {
        const a = attrs(tag);
        if (/\/>$/.test(tag)) return agg.workout(a);
        current = a;
        return;
      }
      if (name === 'WorkoutStatistics' && current) {
        const a = attrs(tag);
        if (a.type === 'HKQuantityTypeIdentifierActiveEnergyBurned') current._energy = a.sum;
        if (/Distance/.test(a.type)) {
          current._distance = a.sum;
          current._distanceUnit = a.unit;
        }
        return;
      }
      if (name === '/Workout' && current) {
        agg.workout(current);
        current = null;
      }
    }
    return {
      push(text) {
        buf += text;
        const cut = buf.lastIndexOf('>') + 1;
        if (!cut) return;
        const work = buf.slice(0, cut);
        buf = buf.slice(cut);
        tagRe.lastIndex = 0;
        let m;
        while ((m = tagRe.exec(work))) handle(m[1], m[0]);
      },
      end: () => agg.result(),
    };
  }

  // ---------- ZIP (just enough to stream export.xml out of Apple's export.zip) ----------
  async function u8(blob, start, end) {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }
  async function findZipEntry(file, test) {
    const tailLen = Math.min(file.size, 65557 + 20);
    const tail = await u8(file, file.size - tailLen, file.size);
    const dv = new DataView(tail.buffer);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new Error('This does not look like a .zip file.');
    let count = dv.getUint16(eocd + 10, true);
    let cdSize = dv.getUint32(eocd + 12, true);
    let cdOff = dv.getUint32(eocd + 16, true);
    if (cdOff === 0xffffffff || count === 0xffff) {
      // ZIP64: locator sits right before the EOCD record
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z64Off = Number(dv.getBigUint64(loc + 8, true));
        const z = new DataView((await u8(file, z64Off, z64Off + 56)).buffer);
        count = Number(z.getBigUint64(32, true));
        cdSize = Number(z.getBigUint64(40, true));
        cdOff = Number(z.getBigUint64(48, true));
      }
    }
    const cd = await u8(file, cdOff, cdOff + cdSize);
    const cv = new DataView(cd.buffer);
    const dec = new TextDecoder();
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cv.getUint32(p, true) !== 0x02014b50) break;
      const method = cv.getUint16(p + 10, true);
      let csize = cv.getUint32(p + 20, true);
      let usize = cv.getUint32(p + 24, true);
      const nlen = cv.getUint16(p + 28, true);
      const xlen = cv.getUint16(p + 30, true);
      const clen = cv.getUint16(p + 32, true);
      let lho = cv.getUint32(p + 42, true);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nlen));
      // ZIP64 extra field holds the real sizes/offset for big entries
      let x = p + 46 + nlen;
      const xend = x + xlen;
      while (x + 4 <= xend) {
        const id = cv.getUint16(x, true);
        const sz = cv.getUint16(x + 2, true);
        if (id === 0x0001) {
          let q = x + 4;
          if (usize === 0xffffffff) (usize = Number(cv.getBigUint64(q, true))), (q += 8);
          if (csize === 0xffffffff) (csize = Number(cv.getBigUint64(q, true))), (q += 8);
          if (lho === 0xffffffff) lho = Number(cv.getBigUint64(q, true));
        }
        x += 4 + sz;
      }
      if (test(name)) {
        const lh = new DataView((await u8(file, lho, lho + 30)).buffer);
        const dataStart = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        return { name, method, csize, usize, dataStart };
      }
      p += 46 + nlen + xlen + clen;
    }
    return null;
  }

  async function openZipEntryStream(file, test) {
    const e = await findZipEntry(file, test);
    if (!e) throw new Error('Could not find export.xml inside the zip.');
    let stream = file.slice(e.dataStart, e.dataStart + e.csize).stream();
    if (e.method === 8) {
      if (typeof DecompressionStream === 'undefined')
        throw new Error('This browser cannot unzip. Unzip export.zip first and choose export.xml.');
      stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
    } else if (e.method !== 0) throw new Error('Unsupported zip compression method ' + e.method);
    return { stream, size: e.usize };
  }

  async function readTextStream(stream, size, onChunk, onProgress) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let seen = 0;
    let lastTick = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += value.length;
      onChunk(dec.decode(value, { stream: true }));
      if (onProgress && seen - lastTick > 4e6) {
        lastTick = seen;
        onProgress(size ? seen / size : 0);
        await new Promise((r) => setTimeout(r)); // let the UI paint
      }
    }
    onChunk(dec.decode());
    onProgress && onProgress(1);
  }

  /** Import an Apple Health export (.zip or .xml File). */
  async function importAppleHealth(file, { since, onProgress } = {}) {
    const parser = AppleXmlParser(since);
    let stream, size;
    if (/\.zip$/i.test(file.name)) {
      ({ stream, size } = await openZipEntryStream(file, (n) => /(^|\/)export\.xml$/.test(n)));
    } else {
      stream = file.stream();
      size = file.size;
    }
    await readTextStream(stream, size, (t) => parser.push(t), onProgress);
    return parser.end();
  }

  // ---------- CSV (Google Fit Takeout, Health Auto Export, Health Connect exports, spreadsheets) ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';' || c === '\t') row.push(cell), (cell = '');
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell), rows.push(row), (row = []), (cell = '');
      } else cell += c;
    }
    if (cell || row.length) row.push(cell), rows.push(row);
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  const COLUMN_RULES = [
    ['steps', /step/i],
    ['restingHR', /resting.*(heart|hr)/i],
    ['hrv', /hrv|variability/i],
    ['exerciseMin', /exercise|move min|active min/i],
    ['calories', /dietary|intake|consumed|food|eaten/i],
    ['protein', /protein/i],
    ['activeEnergy', /active.*(energy|cal)|calorie|kcal|energy burned/i],
    ['distanceKm', /distance/i],
    ['weight', /weight|body mass/i],
    ['sleepHrs', /sleep/i],
  ];
  const SLEEP_STAGE = /in bed|awake|core|deep|rem\b|light/i;

  function mapColumns(header) {
    const map = {};
    header.forEach((h, i) => {
      for (const [metric, re] of COLUMN_RULES) {
        if (!re.test(h)) continue;
        if (metric === 'sleepHrs' && SLEEP_STAGE.test(h)) break;
        if (map[metric] == null) map[metric] = i;
        break;
      }
    });
    // fall back to an "in bed" column if that's all the export has
    if (map.sleepHrs == null) {
      const i = header.findIndex((h) => /sleep/i.test(h) && /in bed/i.test(h));
      if (i >= 0) map.sleepHrs = i;
    }
    return map;
  }

  function csvDate(s) {
    s = (s || '').trim();
    const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const t = Date.parse(s);
    return isFinite(t) ? WA.date.iso(new Date(t)) : null;
  }

  function importCSVText(text, { since } = {}) {
    const rows = parseCSV(text.replace(/^\uFEFF/, ''));
    if (rows.length < 2) throw new Error('The CSV has no data rows.');
    const header = rows[0];
    const dateCol = header.findIndex((h) => /date|day|time|start/i.test(h));
    if (dateCol < 0) throw new Error('Could not find a date column in the CSV header.');
    const map = mapColumns(header);
    if (!Object.keys(map).length)
      throw new Error('No recognised columns (steps, sleep, heart rate, weight, calories, distance, exercise).');
    const days = {};
    let records = 0;
    for (const r of rows.slice(1)) {
      const date = csvDate(r[dateCol]);
      if (!date || (since && date < since)) continue;
      for (const [metric, i] of Object.entries(map)) {
        let v = parseFloat(String(r[i] || '').replace(/,/g, ''));
        if (!isFinite(v) || (v === 0 && metric !== 'steps')) continue;
        const h = header[i];
        if (metric === 'distanceKm') v = /\(m\)|meters|metres/i.test(h) ? v / 1000 : /mi\b|mile/i.test(h) ? v * 1.609344 : v;
        if (metric === 'weight') v = /lb|pound/i.test(h) ? v * 0.45359237 : v;
        if (metric === 'sleepHrs') v = /min/i.test(h) || v > 24 ? v / 60 : v;
        if ((metric === 'activeEnergy' || metric === 'calories') && /kj/i.test(h)) v /= 4.184;
        const prev = days[date] && days[date][metric];
        // rows can repeat a date (e.g. 15-min buckets): add sums, keep the latest for others
        const val = METRICS[metric].agg === 'sum' && prev != null ? prev + v : v;
        (days[date] = days[date] || {})[metric] = metric === 'distanceKm' || metric === 'weight' || metric === 'sleepHrs' ? +val.toFixed(2) : Math.round(val);
        records++;
      }
    }
    return { days, workouts: [], records, columns: Object.keys(map) };
  }

  // ---------- one-tap sync text (from an iOS Shortcut or anything that can open a URL) ----------
  // Format: metric=date:value,date:value;metric=...   e.g. steps=2026-10-13:12034,2026-10-12:8800;sleep=2026-10-13:7.4
  const SYNC_KEYS = {
    steps: 'steps', sleep: 'sleepHrs', sleephrs: 'sleepHrs', rhr: 'restingHR', restinghr: 'restingHR', hrv: 'hrv',
    weight: 'weight', weightlb: 'weight', kcal: 'calories', calories: 'calories', protein: 'protein',
    active: 'activeEnergy', activeenergy: 'activeEnergy', exercise: 'exerciseMin', exercisemin: 'exerciseMin', distance: 'distanceKm',
  };
  function importSyncText(text) {
    const days = {};
    let records = 0;
    const columns = new Set();
    for (const part of String(text || '').split(/[;\n]/)) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const rawKey = part.slice(0, eq).trim().toLowerCase().replace(/[^a-z]/g, '');
      const metric = SYNC_KEYS[rawKey];
      if (!metric) continue;
      for (const pair of part.slice(eq + 1).split(',')) {
        const m = /^\s*([^:]+?)\s*:\s*([-\d.]+)/.exec(pair);
        if (!m) continue;
        const date = csvDate(m[1]);
        let v = parseFloat(m[2]);
        if (!date || !isFinite(v)) continue;
        if (rawKey === 'weightlb') v *= 0.45359237;
        if (metric === 'sleepHrs' && v > 24) v /= 60; // minutes
        if (metric === 'distanceKm' && v > 500) v /= 1000; // metres
        const prev = (days[date] || {})[metric];
        const val = METRICS[metric].agg === 'sum' && prev != null ? prev + v : v;
        (days[date] = days[date] || {})[metric] = metric === 'distanceKm' || metric === 'weight' || metric === 'sleepHrs' ? +val.toFixed(2) : Math.round(val);
        columns.add(metric);
        records++;
      }
    }
    if (!records) throw new Error('No readable values. Expected text like steps=2026-10-13:12034;sleep=2026-10-13:7.4');
    return { days, workouts: [], records, columns: [...columns] };
  }

  /** Merge an import result into app state. Imported values overwrite the same metric; manual values for other metrics stay. */
  function mergeImport(state, result, source) {
    for (const [date, vals] of Object.entries(result.days)) state.health[date] = { ...(state.health[date] || {}), ...vals };
    const ids = new Set(state.workouts.map((w) => w.id));
    let added = 0;
    for (const w of result.workouts)
      if (!ids.has(w.id)) {
        state.workouts.push({ ...w, id: w.id });
        added++;
      }
    state.healthMeta = { lastImport: new Date().toISOString(), source, records: result.records };
    return { days: Object.keys(result.days).length, workouts: added };
  }

  WA.health = { METRICS, importAppleHealth, importCSVText, importSyncText, mergeImport, AppleXmlParser, parseCSV, prettyWorkoutType };
})(typeof window !== 'undefined' ? window : globalThis);
