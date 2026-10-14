// Run with: node --test test/
var test = require('node:test');
var assert = require('node:assert');
var calendar = require('../src/pkjs/calendar');
var sun = require('../src/pkjs/sun');

var ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test',
  'BEGIN:VTIMEZONE', 'TZID:Australia/Adelaide',
  'BEGIN:STANDARD', 'DTSTART:19700405T030000', 'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
  'TZOFFSETFROM:+1030', 'TZOFFSETTO:+0930', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:19701004T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU',
  'TZOFFSETFROM:+0930', 'TZOFFSETTO:+1030', 'END:DAYLIGHT', 'END:VTIMEZONE',
  // Daily standup since 2020, 09:30 Adelaide time
  'BEGIN:VEVENT', 'UID:standup', 'DTSTART;TZID=Australia/Adelaide:20200101T093000',
  'DTEND;TZID=Australia/Adelaide:20200101T094500', 'RRULE:FREQ=DAILY', 'SUMMARY:Standup', 'END:VEVENT',
  // ...moved to 10:00 on 14/10/2026
  'BEGIN:VEVENT', 'UID:standup', 'RECURRENCE-ID;TZID=Australia/Adelaide:20261014T093000',
  'DTSTART;TZID=Australia/Adelaide:20261014T100000', 'DTEND;TZID=Australia/Adelaide:20261014T101500',
  'SUMMARY:Standup (moved)', 'END:VEVENT',
  // ...and cancelled on 15/10/2026
  'BEGIN:VEVENT', 'UID:standup', 'RECURRENCE-ID;TZID=Australia/Adelaide:20261015T093000',
  'DTSTART;TZID=Australia/Adelaide:20261015T093000', 'DTEND;TZID=Australia/Adelaide:20261015T094500',
  'STATUS:CANCELLED', 'SUMMARY:Standup', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:review', 'DTSTART:20261014T033000Z', 'DTEND:20261014T050000Z',
  'SUMMARY:Design review', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:holiday', 'DTSTART;VALUE=DATE:20261014', 'DTEND;VALUE=DATE:20261015',
  'SUMMARY:All day', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

test('parses timed, recurring, moved and cancelled events', function () {
  var from = new Date('2026-10-13T12:00:00Z');
  var to = new Date('2026-10-15T12:00:00Z');
  var events = calendar.parseEvents(ICS, 0x00AAFF, from, to);
  events.sort(function (a, b) { return a.start - b.start; });
  var got = events.map(function (e) { return e.start.toISOString() + ' ' + e.title; });
  assert.deepStrictEqual(got, [
    // 10:00 ACDT (+10:30) = 23:30Z the day before
    '2026-10-13T23:30:00.000Z Standup (moved)',
    '2026-10-14T03:30:00.000Z Design review'
  ]);
  assert.strictEqual(events[0].color, 0x00AAFF);
});

test('drops events that cannot reach the window before parsing', function () {
  var ics = ICS.replace('BEGIN:VEVENT', [
    'BEGIN:VEVENT', 'UID:old', 'DTSTART;TZID=Australia/Adelaide:20250301T100000',
    'DTEND;TZID=Australia/Adelaide:', ' 20250301T110000', 'SUMMARY:Old', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:ended', 'DTSTART:20240101T000000Z', 'DTEND:20240101T010000Z',
    'RRULE:FREQ=WEEKLY;UNTIL=20250101T000000Z', 'SUMMARY:Ended series', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:standup', 'RECURRENCE-ID;TZID=Australia/Adelaide:20250601T093000',
    'DTSTART;TZID=Australia/Adelaide:20250601T100000', 'DTEND;TZID=Australia/Adelaide:20250601T101500',
    'SUMMARY:Past edit', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:standup', 'RECURRENCE-ID;TZID=Australia/Adelaide:20250602T093000',
    'DTSTART;TZID=Australia/Adelaide:20261014T120000', 'DTEND;TZID=Australia/Adelaide:20261014T121500',
    'SUMMARY:Moved forward', 'END:VEVENT', 'BEGIN:VEVENT'
  ].join('\r\n'));
  var kept = calendar.dropPastEvents(ics, new Date('2026-10-13T12:00:00Z'));
  ['UID:old', 'UID:ended', 'Past edit'].forEach(function (s) {
    assert.ok(kept.indexOf(s) < 0, s + ' dropped');
  });
  ['Moved forward', 'SUMMARY:Standup', 'Standup (moved)', 'UID:review', 'UID:holiday', 'END:VCALENDAR'].forEach(function (s) {
    assert.ok(kept.indexOf(s) >= 0, s + ' kept');
  });
});

test('exceptions only replace occurrences of their own series', function () {
  // A different series moved its 09:30 occurrence on 14/10, the same local time as the standup.
  var ics = ICS.replace('END:VCALENDAR', [
    'BEGIN:VEVENT', 'UID:other', 'DTSTART;TZID=Australia/Adelaide:20261001T093000',
    'DTEND;TZID=Australia/Adelaide:20261001T100000', 'RRULE:FREQ=DAILY', 'SUMMARY:Other', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:other', 'RECURRENCE-ID;TZID=Australia/Adelaide:20261013T093000',
    'DTSTART;TZID=Australia/Adelaide:20261013T120000', 'DTEND;TZID=Australia/Adelaide:20261013T123000',
    'SUMMARY:Other (moved)', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:third', 'DTSTART;TZID=Australia/Adelaide:20261013T093000',
    'DTEND;TZID=Australia/Adelaide:20261013T094500', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Third', 'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'));
  var events = calendar.parseEvents(ics, 0, new Date('2026-10-12T12:30:00Z'), new Date('2026-10-13T12:30:00Z'));
  var titles = events.map(function (e) { return e.title; }).sort();
  // 13/10 09:30 ACDT: the standup, Third, and Other's moved occurrence at 12:00. Neither Standup nor
  // Third may be swapped for "Other (moved)".
  assert.deepStrictEqual(titles, ['Other (moved)', 'Standup', 'Third']);
});

test('hides declined events and marks unaccepted ones tentative', function () {
  function invite(uid, partstat) {
    return ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTART:20261014T010000Z', 'DTEND:20261014T020000Z', 'SUMMARY:' + uid,
      'ATTENDEE;CN=Someone;PARTSTAT=ACCEPTED:mailto:someone@example.com',
      'ATTENDEE;PARTSTAT=' + partstat + ':mailto:Me@Example.com', 'END:VEVENT'].join('\r\n');
  }
  var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
    invite('accepted', 'ACCEPTED'), invite('declined', 'DECLINED'),
    invite('pending', 'NEEDS-ACTION'), invite('maybe', 'TENTATIVE'),
    'BEGIN:VEVENT', 'UID:mine', 'DTSTART:20261014T010000Z', 'DTEND:20261014T020000Z', 'SUMMARY:mine', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  var from = new Date('2026-10-14T00:00:00Z'), to = new Date('2026-10-15T00:00:00Z');
  function got(owner) {
    return calendar.parseEvents(ics, 0, from, to, owner).map(function (e) {
      return e.title + (e.tentative ? '?' : '');
    }).sort();
  }
  assert.deepStrictEqual(got('me@example.com'), ['accepted', 'maybe?', 'mine', 'pending?']);
  assert.deepStrictEqual(got(null), ['accepted', 'declined', 'maybe', 'mine', 'pending']);
});

test('limits Google feeds to the window', function () {
  var from = new Date('2026-10-15T01:02:03.456Z'), to = new Date('2026-10-16T01:02:03.456Z');
  var g = 'https://calendar.google.com/calendar/ical/me%40example.com/private-abc/basic.ics';
  assert.strictEqual(calendar.feedUrl(g, from, to),
    g + '?start-min=2026-10-15T01:02:03Z&start-max=2026-10-16T01:02:03Z');
  assert.strictEqual(calendar.feedUrl('webcal://calendar.google.com/calendar/ical/me%40example.com/private-abc/basic.ics', from, to),
    g + '?start-min=2026-10-15T01:02:03Z&start-max=2026-10-16T01:02:03Z');
  assert.strictEqual(calendar.feedUrl('https://example.com/cal.ics', from, to), 'https://example.com/cal.ics');
});

test('sunrise and sunset in Adelaide', function () {
  var t = sun.sunTimes(new Date('2026-10-14T02:30:00Z'), -34.93, 138.6);
  // Expected ~06:39 and ~19:32 ACDT (UTC+10:30), within 5 minutes
  var rise = (t.rise.getUTCHours() * 60 + t.rise.getUTCMinutes() + 630) % 1440;
  var set = (t.set.getUTCHours() * 60 + t.set.getUTCMinutes() + 630) % 1440;
  assert.ok(Math.abs(rise - (6 * 60 + 39)) <= 5, 'sunrise ' + rise);
  assert.ok(Math.abs(set - (19 * 60 + 32)) <= 5, 'sunset ' + set);
});

test('no sunrise in polar night', function () {
  assert.strictEqual(sun.sunTimes(new Date('2026-12-21T12:00:00Z'), 78.2, 15.6), null);
});
