var ICAL = require('ical.js');

// Daily events that started years ago need one iteration per day to reach today.
var MAX_ITERATIONS = 20000;

function fetchText(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) callback(null, xhr.responseText);
    else callback(new Error('HTTP ' + xhr.status));
  };
  xhr.onerror = function () { callback(new Error('network error')); };
  xhr.open('GET', url.replace(/^webcal:\/\//i, 'https://'));
  xhr.send();
}

function isCancelled(component) {
  return String(component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED';
}

// Timed events overlapping [from, to) from one iCalendar document. All-day events are skipped:
// on a 12-hour ring they would shade everything.
function parseEvents(icsText, color, from, to) {
  var root = new ICAL.Component(ICAL.parse(icsText));
  root.getAllSubcomponents('vtimezone').forEach(function (tz) {
    ICAL.TimezoneService.register(tz);
  });

  var masters = [];
  var exceptions = {};
  root.getAllSubcomponents('vevent').forEach(function (v) {
    if (v.hasProperty('recurrence-id')) {
      var uid = v.getFirstPropertyValue('uid');
      (exceptions[uid] = exceptions[uid] || []).push(v);
    } else {
      masters.push(v);
    }
  });

  var out = [];
  function add(start, end, item) {
    if (item.startDate.isDate || isCancelled(item.component)) return;
    if (end > from && start < to) {
      out.push({ start: start, end: end, color: color, title: item.summary || '' });
    }
  }

  masters.forEach(function (v) {
    var ev = new ICAL.Event(v);
    (exceptions[ev.uid] || []).forEach(function (x) { ev.relateException(x); });
    if (!ev.isRecurring()) {
      add(ev.startDate.toJSDate(), ev.endDate.toJSDate(), ev);
      return;
    }
    var it = ev.iterator();
    for (var i = 0, next; i < MAX_ITERATIONS && (next = it.next()); i++) {
      var occ = ev.getOccurrenceDetails(next);
      var start = occ.startDate.toJSDate();
      if (start >= to) break;
      add(start, occ.endDate.toJSDate(), occ.item);
    }
  });
  return out;
}

// Fetches every calendar and returns their events in [from, to), sorted by start.
// `calendars` is [{url, color}]; a failing calendar is logged and skipped.
function loadEvents(calendars, from, to, callback) {
  var pending = calendars.length;
  var all = [];
  if (!pending) return callback(all);
  calendars.forEach(function (cal) {
    fetchText(cal.url, function (err, text) {
      if (err) {
        console.log('calendar fetch failed: ' + err.message);
      } else {
        try {
          all = all.concat(parseEvents(text, cal.color, from, to));
        } catch (e) {
          console.log('calendar parse failed: ' + e);
        }
      }
      if (--pending === 0) {
        all.sort(function (a, b) { return a.start - b.start; });
        callback(all);
      }
    });
  });
}

module.exports = { loadEvents: loadEvents, parseEvents: parseEvents };
