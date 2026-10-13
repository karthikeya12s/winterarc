/* Winter Arc — reminders.
 * A static web app has no server, so it cannot push notifications while it's closed.
 * Two mechanisms cover that honestly:
 *   1. In-app notifications while the app/tab is open (or installed and in the background on desktop).
 *   2. A calendar file (.ics) with a daily repeating alarm — your phone's calendar delivers it reliably. */
(function (root) {
  const WA = (root.WA = root.WA || {});
  const SENT_KEY = 'winterarc.notified';

  const supported = () => typeof Notification !== 'undefined';

  async function requestPermission() {
    if (!supported()) return 'unsupported';
    return Notification.requestPermission();
  }

  async function notify(title, body) {
    if (!supported() || Notification.permission !== 'granted') return false;
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) await reg.showNotification(title, { body, icon: 'icons/icon.svg', tag: 'winterarc' });
      else new Notification(title, { body, icon: 'icons/icon.svg' });
      return true;
    } catch (e) {
      return false;
    }
  }

  function sentToday(kind) {
    try {
      const o = JSON.parse(localStorage.getItem(SENT_KEY) || '{}');
      return o[kind] === WA.date.today();
    } catch (e) {
      return false;
    }
  }
  function markSent(kind) {
    try {
      const o = JSON.parse(localStorage.getItem(SENT_KEY) || '{}');
      o[kind] = WA.date.today();
      localStorage.setItem(SENT_KEY, JSON.stringify(o));
    } catch (e) {}
  }

  function tick() {
    const s = WA.store.get();
    if (!s.settings.notify) return;
    const t = WA.date.today();
    const prog = WA.calc.challengeProgress(s, t);
    if (!prog.started || prog.ended) return;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const left = s.habits.filter((h) => !WA.calc.habitDone(s, h, t));
    if (hm >= s.settings.reminderTime && !sentToday('morning')) {
      markSent('morning');
      notify(`Day ${prog.day} of ${prog.total} — ${s.challenge.name}`, left.length ? `Today: ${left.map((h) => h.name).join(' · ')}` : 'All done already. Legend.');
    }
    if (hm >= '20:00' && left.length && !sentToday('evening')) {
      markSent('evening');
      const { current } = WA.calc.streaks(s, t);
      notify(current ? `Protect your ${current}-day streak` : 'Close out today', `Still open: ${left.map((h) => h.name).join(', ')}`);
    }
  }

  function start() {
    tick();
    setInterval(tick, 60000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
  }

  /** Build an .ics with a daily event + alarm for the rest of the challenge. */
  function icsFile(s) {
    const [hh, mm] = s.settings.reminderTime.split(':');
    const from = WA.date.today() > s.challenge.start ? WA.date.today() : s.challenge.start;
    const d = (iso) => iso.replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const until = d(s.challenge.end) + 'T235959';
    const habits = s.habits.map((h) => `${h.icon} ${h.name}${h.kind === 'target' ? ` (${h.target} ${h.unit})` : ''}`).join('\\n');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Winter Arc//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:winterarc-daily-${d(s.challenge.start)}@winterarc`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${d(from)}T${hh}${mm}00`,
      'DURATION:PT15M',
      `RRULE:FREQ=DAILY;UNTIL=${until}`,
      `SUMMARY:❄️ ${s.challenge.name} — check in`,
      `DESCRIPTION:Today's habits:\\n${habits}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Winter Arc check-in',
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
      'BEGIN:VEVENT',
      `UID:winterarc-evening-${d(s.challenge.start)}@winterarc`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${d(from)}T200000`,
      'DURATION:PT10M',
      `RRULE:FREQ=DAILY;UNTIL=${until}`,
      `SUMMARY:🔥 ${s.challenge.name} — close out the day`,
      'DESCRIPTION:Log your workout and tick off anything left.',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Close out the day',
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return lines.join('\r\n');
  }

  WA.reminders = { start, requestPermission, notify, icsFile, supported, tick };
})(typeof window !== 'undefined' ? window : globalThis);
