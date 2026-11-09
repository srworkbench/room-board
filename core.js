(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoomBoard = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function parseCSV(text) {
    if (typeof text !== 'string' || text.length > 500000) throw Error('Use a CSV smaller than 500,000 characters.');
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const records = []; let row = [], field = '', quoted = false, closed = false;
    function cell() { row.push(field); field = ''; closed = false; }
    function record() { cell(); records.push(row); row = []; }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else field += c;
      } else if (c === ',') cell();
      else if (c === '\n') record();
      else if (closed) throw Error('Unexpected text after a closing quote. Export the sheet as CSV again.');
      else if (c === '"') {
        if (field) throw Error('A quote must start a CSV field.');
        quoted = true;
      } else field += c;
    }
    if (quoted) throw Error('A quoted CSV field was not closed.');
    if (field || row.length || closed) record();
    if (records.length > 1001) throw Error('Use at most 1,000 session records.');
    return records;
  }
  function dateKey(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    const v = new Date(Date.UTC(y, m - 1, d));
    return y >= 2000 && y <= 2199 && v.getUTCFullYear() === y && v.getUTCMonth() + 1 === m && v.getUTCDate() === d ? s : null;
  }
  function minutes(s) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return null;
    return Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  }
  const normalize = s => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  const label = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  function readSchedule(text) {
    const rows = parseCSV(text);
    if (!rows.length) throw Error('Add the header and at least one session.');
    const headers = rows.shift().map(normalize);
    if (new Set(headers).size !== headers.length || headers.some(x => !x)) throw Error('CSV column names must be unique and non-empty.');
    for (const key of ['date', 'start', 'end', 'room', 'title']) if (!headers.includes(key)) throw Error('Missing column: ' + key + '. Use the example header.');
    const sessions = [], issues = [];
    rows.forEach((row, i) => {
      const sourceRow = i + 2;
      if (row.every(v => !v.trim())) return;
      const problem = message => issues.push({ sourceRow, message });
      if (row.length !== headers.length) { problem('Column count does not match the header.'); return; }
      const get = key => (row[headers.indexOf(key)] || '').trim();
      const date = dateKey(get('date')), start = minutes(get('start')), end = minutes(get('end'));
      const room = get('room'), title = get('title'), speaker = get('speaker');
      if (!date) problem('Date must be a real date in YYYY-MM-DD format (2000–2199).');
      if (start === null || end === null) problem('Start and end must use 24-hour HH:MM.');
      else if (end <= start) problem('End must be after start on the same day. Split sessions that cross midnight.');
      if (!room || !title) problem('Room and title are required.');
      if (room.length > 100 || title.length > 240 || speaker.length > 160) problem('Keep rooms to 100, titles to 240 and speakers to 160 characters.');
      if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(row.join(''))) problem('Remove control characters from the record.');
      if (!issues.some(x => x.sourceRow === sourceRow)) sessions.push({ sourceRow, date, start, end, room, roomKey: normalize(room), title, speaker });
    });
    sessions.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.roomKey.localeCompare(b.roomKey) || a.sourceRow - b.sourceRow);
    const conflicts = new Map();
    for (let i = 0; i < sessions.length; i++) for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i], b = sessions[j];
      if (a.date !== b.date || a.roomKey !== b.roomKey || a.start >= b.end || b.start >= a.end) continue;
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!conflicts.has(x.sourceRow)) conflicts.set(x.sourceRow, new Set());
        conflicts.get(x.sourceRow).add(y.sourceRow);
      }
    }
    for (const [sourceRow, peers] of conflicts) issues.push({ sourceRow, message: 'Same-room overlap with record ' + [...peers].sort((a, b) => a - b).join(', ') + '.' });
    return { sessions, issues: issues.sort((a, b) => a.sourceRow - b.sourceRow) };
  }
  function viewAt(sessions, date, minute, roomKey = '') {
    if (!dateKey(date) || !Number.isInteger(minute) || minute < 0 || minute > 1439) throw Error('Choose a valid date and time.');
    const day = sessions.filter(s => s.date === date && (!roomKey || s.roomKey === roomKey));
    return {
      current: day.filter(s => s.start <= minute && minute < s.end),
      next: day.filter(s => s.start > minute),
      finished: day.filter(s => s.end <= minute).length,
      total: day.length
    };
  }
  function clockAt(instant, timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    const value = key => parts.find(p => p.type === key).value;
    return { date: value('year') + '-' + value('month') + '-' + value('day'), minute: Number(value('hour')) * 60 + Number(value('minute')) };
  }
  function scheduleCSV(sessions) {
    const cell = value => '"' + (/^[\s]*[=+@-]/.test(String(value)) ? "'" : '') + String(value).replace(/"/g, '""') + '"';
    return [['date', 'start', 'end', 'room', 'title', 'speaker'], ...sessions.map(s => [s.date, label(s.start), label(s.end), s.room, s.title, s.speaker])].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  return { parseCSV, dateKey, minutes, normalize, label, readSchedule, viewAt, clockAt, scheduleCSV };
});
