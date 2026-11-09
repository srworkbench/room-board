'use strict';
const C = RoomBoard;
const $ = id => document.getElementById(id);
const example = `date,start,end,room,title,speaker
2026-11-12,09:00,09:45,Maple,Welcome & orientation,Workshop team
2026-11-12,10:00,10:45,Maple,Building safer handovers,Facilitator A
2026-11-12,11:00,11:45,Maple,Practical checklists,Facilitator B
2026-11-12,09:00,09:45,Cedar,Mapping the customer journey,Facilitator C
2026-11-12,10:00,10:30,Cedar,Questions that uncover needs,Facilitator D
2026-11-12,10:45,11:30,Cedar,Turning feedback into changes,Facilitator E
`;
let schedule = null, mode = 'preview', revision = 0;
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zones = [...new Set([localZone, 'UTC', ...(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'])])];
for (const z of zones) { const opt = document.createElement('option'); opt.value = z; opt.textContent = z.replaceAll('_', ' '); $('zone').append(opt); }
function element(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function invalidate(message = 'Schedule changed. Build the board again to apply it.') {
  revision++; schedule = null; $('controls').hidden = true; $('issues').replaceChildren(); $('status').textContent = message;
  document.body.classList.remove('displaying'); $('exit').hidden = true;
  $('board-content').replaceChildren(element('div', 'Build a valid schedule to show sessions here.', 'empty'));
  $('mode').className = 'mode'; $('mode').textContent = 'WAITING FOR SCHEDULE'; $('room-title').textContent = 'Your room, ready.'; $('clock').textContent = 'No schedule is currently displayed.';
  $('board-note').textContent = 'No uploads · No sign-in · No installation';
}
function build() {
  invalidate('Checking schedule…');
  try {
    const parsed = C.readSchedule($('source').value);
    if (parsed.issues.length) {
      $('status').textContent = 'Fix ' + parsed.issues.length + ' issue' + (parsed.issues.length === 1 ? '' : 's') + ', then build again. Display is held.';
      for (const issue of parsed.issues.slice(0, 50)) $('issues').append(element('li', 'Record ' + issue.sourceRow + ': ' + issue.message));
      if (parsed.issues.length > 50) $('issues').append(element('li', 'Showing the first 50 issues. Correct them and build again.'));
      return;
    }
    if (!parsed.sessions.length) throw Error('Add at least one session.');
    schedule = parsed.sessions; mode = 'preview';
    const rooms = new Map(); for (const s of schedule) if (!rooms.has(s.roomKey)) rooms.set(s.roomKey, s.room);
    $('room').replaceChildren();
    for (const [key, name] of [['', 'All rooms'], ...[...rooms].sort((a, b) => a[1].localeCompare(b[1]))]) {
      const opt = element('option', name); opt.value = key; $('room').append(opt);
    }
    $('date').value = schedule[0].date; $('time').value = '10:10';
    $('status').textContent = schedule.length + ' sessions · ' + rooms.size + ' rooms · Ready to display';
    $('controls').hidden = false; render();
  } catch (e) { $('status').textContent = e.message; }
}
function card(session, current) {
  const article = element('article', undefined, 'session' + (current ? ' current' : ''));
  article.append(element('div', C.label(session.start) + '–' + C.label(session.end), 'time'));
  const detail = element('div'); detail.append(element('span', session.room, 'room-chip'), element('h4', session.title));
  if (session.speaker) detail.append(element('p', session.speaker));
  article.append(detail); return article;
}
function render() {
  if (!schedule) return;
  try {
    const clock = mode === 'live' ? C.clockAt(new Date(), $('zone').value) : { date: $('date').value, minute: C.minutes($('time').value) };
    const view = C.viewAt(schedule, clock.date, clock.minute, $('room').value);
    $('mode').className = 'mode' + (mode === 'preview' ? ' preview' : '');
    $('mode').textContent = mode === 'live' ? 'LIVE VENUE CLOCK' : 'PREVIEW · CLOCK PAUSED';
    $('room-title').textContent = $('room').selectedOptions[0].textContent;
    $('clock').textContent = clock.date + ' · ' + C.label(clock.minute) + ' · ' + $('zone').value.replaceAll('_', ' ');
    const content = $('board-content'); content.replaceChildren(element('h3', 'ON NOW'));
    if (view.current.length) for (const s of view.current) content.append(card(s, true));
    else content.append(element('div', !view.total ? 'No sessions in this room on this date.' : view.next.length ? 'Between sessions. Coming up below.' : 'That’s all for today.', 'empty'));
    if (view.next.length) { content.append(element('h3', 'UP NEXT')); for (const s of view.next.slice(0, 4)) content.append(card(s, false)); }
    $('board-note').textContent = view.finished + ' finished session' + (view.finished === 1 ? '' : 's') + ' hidden · ' + (view.next.length > 4 ? 'Showing the next 4 of ' + view.next.length + ' sessions' : 'All remaining sessions shown') + ' · ' + (mode === 'live' ? 'Updates every 15 seconds' : 'Preview only');
  } catch (e) { $('board-content').replaceChildren(element('div', e.message, 'empty')); $('mode').className = 'mode preview'; $('mode').textContent = 'DISPLAY HELD'; $('clock').textContent = 'Choose a valid preview date and time.'; }
}
$('source').addEventListener('input', () => invalidate());
$('load').addEventListener('click', build);
$('example').addEventListener('click', () => { $('source').value = example; $('file').value = ''; build(); });
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; invalidate(file ? 'Reading ' + file.name + '…' : 'Choose a CSV, or paste your schedule.');
  $('source').value = ''; if (!file) return;
  if (file.size > 2000000) { $('status').textContent = 'Use a CSV smaller than 2 MB.'; return; }
  const expected = revision;
  try { const text = await file.text(); if (expected !== revision) return; $('source').value = text; build(); }
  catch (e) { if (expected === revision) $('status').textContent = 'Could not read this file. Export as UTF-8 CSV and try again.'; }
});
$('room').addEventListener('change', render);
$('zone').addEventListener('change', render);
for (const id of ['date', 'time']) $(id).addEventListener('input', () => { mode = 'preview'; render(); });
$('preview').addEventListener('click', () => { mode = 'preview'; render(); });
$('live').addEventListener('click', () => { mode = 'live'; render(); });
$('display').addEventListener('click', () => { render(); document.body.classList.add('displaying'); $('exit').hidden = false; $('exit').focus(); window.scrollTo(0, 0); });
function exitDisplay() { document.body.classList.remove('displaying'); $('exit').hidden = true; $('display').focus(); }
$('exit').addEventListener('click', exitDisplay);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('displaying')) exitDisplay(); });
$('download').addEventListener('click', () => {
  if (!schedule) return;
  const url = URL.createObjectURL(new Blob(['\uFEFF' + C.scheduleCSV(schedule)], { type: 'text/csv;charset=utf-8' }));
  const a = element('a'); a.href = url; a.download = 'room-board-schedule.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
setInterval(() => { if (mode === 'live') render(); }, 15000);
