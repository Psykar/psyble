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
