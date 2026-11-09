const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const header = 'date,start,end,room,title,speaker\n';
const line = (start, end, room = 'Maple', title = 'Session') => `2026-11-12,${start},${end},${room},${title},Host\n`;

test('quoted values and logical record numbers remain intact', () => {
  const r = C.readSchedule('\uFEFF' + header.replace(/\n/g, '\r\n') + '\r\n2026-11-12,09:00,10:00,Maple,"Ask, then\nlisten","A ""B"""\r\n');
  assert.deepEqual(r.issues, []); assert.equal(r.sessions[0].sourceRow, 3);
  assert.equal(r.sessions[0].title, 'Ask, then\nlisten'); assert.equal(r.sessions[0].speaker, 'A "B"');
});
test('malformed CSV is rejected without silently merging data', () => {
  for (const s of ['a,b\n"unclosed', 'a,b\n"x"z,y', 'a,b\n x"y,z']) assert.throws(() => C.parseCSV(s));
  assert.throws(() => C.readSchedule('date,date,start,end,room,title\n'), /unique/);
  assert.throws(() => C.readSchedule('date,start,end,title\n'), /Missing column: room/);
  assert.match(C.readSchedule(header + '2026-11-12,09:00,10:00,Maple,Session,Host,extra\n').issues[0].message, /Column count/);
});
test('real calendar dates and 24-hour same-day intervals are required', () => {
  assert.equal(C.dateKey('2024-02-29'), '2024-02-29');
  for (const s of ['2026-02-29','2026-04-31','1999-12-31','2026-1-02']) assert.equal(C.dateKey(s), null);
  for (const s of ['24:00','9:00','10:60','09:00:00']) assert.equal(C.minutes(s), null);
  assert.equal(C.minutes('00:00'), 0);
  assert.match(C.readSchedule(header + line('23:30','00:30')).issues[0].message, /same day/);
});
test('all same-room overlapping participants are reported, including nested ranges', () => {
  const r = C.readSchedule(header + line('09:00','12:00') + line('09:30','10:00',' maple ') + line('10:30','11:00','MAPLE'));
  assert.deepEqual(r.issues.map(x => x.sourceRow), [2,3,4]);
  assert.match(r.issues[0].message, /3, 4/);
});
test('adjacent sessions, parallel rooms and different dates do not conflict', () => {
  const r = C.readSchedule(header + line('09:00','10:00') + line('10:00','11:00') + line('09:00','11:00','Cedar') + line('09:30','10:30').replace('2026-11-12','2026-11-13'));
  assert.deepEqual(r.issues, []); assert.equal(r.sessions.length,4);
});
test('display switches at exact start/end, never shows yesterday or a past session', () => {
  const s = C.readSchedule(header + line('09:00','10:00') + line('10:00','11:00') + line('10:00','11:00','Cedar')).sessions;
  const before = C.viewAt(s,'2026-11-12',539,'maple'); assert.equal(before.current.length,0); assert.equal(before.next.length,2);
  const at = C.viewAt(s,'2026-11-12',600,'maple'); assert.equal(at.current.length,1); assert.equal(at.current[0].sourceRow,3); assert.equal(at.finished,1);
  assert.equal(C.viewAt(s,'2026-11-12',600).current.length,2);
  assert.equal(C.viewAt(s,'2026-11-13',600).total,0);
  assert.equal(C.viewAt(s,'2026-11-12',660).current.length,0);
  assert.throws(() => C.viewAt(s,'2026-11-12',null));
});
test('venue clock handles date boundaries and daylight-saving changes', () => {
  assert.deepEqual(C.clockAt(new Date('2026-11-12T00:10:00Z'),'America/Los_Angeles'), {date:'2026-11-11',minute:970});
  assert.deepEqual(C.clockAt(new Date('2026-11-12T00:00:00Z'),'UTC'), {date:'2026-11-12',minute:0});
  assert.deepEqual(C.clockAt(new Date('2026-11-01T08:30:00Z'),'America/Los_Angeles'), {date:'2026-11-01',minute:90});
  assert.deepEqual(C.clockAt(new Date('2026-11-01T09:30:00Z'),'America/Los_Angeles'), {date:'2026-11-01',minute:90});
  assert.throws(() => C.clockAt(new Date(),'Invalid/Zone'));
});
test('midnight end covers the whole final minute and exports as 24:00', () => {
  const r = C.readSchedule(header + line('23:30','24:00') + line('00:00','00:30').replace('2026-11-12','2026-11-13'));
  assert.deepEqual(r.issues,[]);
  assert.equal(C.viewAt(r.sessions,'2026-11-12',1439,'maple').current[0].end,1440);
  assert.equal(C.viewAt(r.sessions,'2026-11-13',0,'maple').current[0].start,0);
  assert.equal(C.parseCSV(C.scheduleCSV(r.sessions))[1][2],'24:00');
  assert.notEqual(C.readSchedule(header + line('24:00','24:00')).issues.length,0);
});
test('CSV export is chronological, quoted and prevents spreadsheet formulas', () => {
  const r = C.readSchedule(header + line('11:00','12:00','Maple','=1+1') + line('09:00','10:00','Cedar','Normal'));
  const rows = C.parseCSV(C.scheduleCSV(r.sessions));
  assert.equal(rows[1][1], '09:00'); assert.equal(rows[2][4], "'=1+1");
});
test('bounded input and long/control-character fields are held', () => {
  assert.throws(() => C.parseCSV('x'.repeat(500001)), /smaller/);
  assert.throws(() => C.parseCSV('a\n'.repeat(1002)), /1,000/);
  assert.match(C.readSchedule(header + line('09:00','10:00','x'.repeat(101))).issues[0].message, /100/);
  assert.match(C.readSchedule(header + line('09:00','10:00','Maple','Hello\x01')).issues[0].message, /control/);
});
