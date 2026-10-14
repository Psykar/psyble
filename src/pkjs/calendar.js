var ICAL = require('ical.js');

// Daily events that started years ago need one iteration per day to reach today.
var MAX_ITERATIONS = 20000;

// A full (unwindowed) feed of a busy calendar can take ~16 s before the first byte, longer than
// some phone apps' default request timeout. Failures report how long they ran, so a fixed limit
// shows up on the watch.
var TIMEOUT_MS = 120000;

function fetchText(url, callback) {
  var xhr = new XMLHttpRequest();
  var started = Date.now();
  function fail(what) { callback(new Error(what + ' ' + Math.round((Date.now() - started) / 1000) + 's')); }
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) callback(null, xhr.responseText);
    else callback(new Error('HTTP ' + xhr.status));
  };
  xhr.onerror = function () { fail('network error'); };
  xhr.ontimeout = function () { fail('timed out'); };
  xhr.open('GET', url);
  xhr.timeout = TIMEOUT_MS;
  xhr.send();
}

function isCancelled(component) {
  return String(component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED';
}

// The calendar owner's reply to an event. Events they aren't invited to (their own) count as
// accepted, as does everything when the owner is unknown.
function partstat(component, owner) {
  if (!owner) return 'ACCEPTED';
  var me = component.getAllProperties('attendee').filter(function (p) {
    return String(p.getFirstValue()).toLowerCase() === 'mailto:' + owner;
  })[0];
  return me ? String(me.getParameter('partstat') || 'NEEDS-ACTION').toUpperCase() : 'ACCEPTED';
}

// Google's address embeds the calendar ID, which is the owner's email for their own calendar:
// https://calendar.google.com/calendar/ical/<id>/private-…/basic.ics
function calendarOwner(url) {
  var m = /\/calendar\/ical\/([^\/]+)\//.exec(url);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

// Google's iCal feeds still honour the old GData start-min/start-max parameters (undocumented):
// a busy calendar drops from ~25 MB / ~15 s to ~15 KB / <1 s, keeping recurring series that have
// an occurrence in the window. If Google stops honouring them the full feed still parses.
// (singleevents=true is also accepted but drops recurring series, so isn't used.)
function feedUrl(url, from, to) {
  url = url.replace(/^webcal:\/\//i, 'https://');
  if (!calendarOwner(url) || !/^https:\/\/calendar\.google\.com\//i.test(url)) return url;
  function iso(d) { return d.toISOString().replace(/\.\d+Z$/, 'Z'); }
  return url + (url.indexOf('?') < 0 ? '?' : '&') + 'start-min=' + iso(from) + '&start-max=' + iso(to);
}

// Full feeds carry the whole calendar history (a busy Google calendar: ~25 MB, ~10k events), too
// slow for ical.js to parse and expand on the phone. A text scan drops what can't reach `from`:
// one-off events that ended, series whose UNTIL passed, and exceptions that both replaced and moved
// to a past slot.
// Dates are compared as YYYYMMDD with a 2-day margin so TZID offsets never drop a live event.
// Anything without a parseable date (DURATION, COUNT, RDATE) is kept.
function dropPastEvents(icsText, from) {
  var cutoff = new Date(from.getTime() - 2 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  function past(re, block) {
    var m = re.exec(block);
    return !!m && m[1] < cutoff;
  }
  return icsText.replace(/\r?\n[ \t]/g, '').replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r?\n?/g, function (block) {
    if (/^RDATE[;:]/m.test(block)) return block;
    var gone = /^RRULE[;:]/m.test(block)
      ? past(/^RRULE[;:].*UNTIL=(\d{8})/m, block)
      : past(/^DTEND[^:\r\n]*:(\d{8})/m, block) &&
        (!/^RECURRENCE-ID[;:]/m.test(block) || past(/^RECURRENCE-ID[^:\r\n]*:(\d{8})/m, block));
    return gone ? '' : block;
  });
}

// Timed events overlapping [from, to) from one iCalendar document. All-day events are skipped:
// on a 12-hour ring they would shade everything. Events `owner` declined are skipped; ones they
// haven't accepted are marked tentative.
function parseEvents(icsText, color, from, to, owner) {
  var root = new ICAL.Component(ICAL.parse(dropPastEvents(icsText, from)));
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
    var reply = partstat(item.component, owner);
    if (reply === 'DECLINED') return;
    if (end > from && start < to) {
      out.push({ start: start, end: end, color: color, title: item.summary || '', tentative: reply !== 'ACCEPTED' });
    }
  }

  masters.forEach(function (v) {
    // Without `exceptions`, ical.js relates every exception in the calendar to this event, matched
    // by local time alone, so another series' moved meeting replaces this one's occurrence.
    var ev = new ICAL.Event(v, { exceptions: exceptions[v.getFirstPropertyValue('uid')] || [] });
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

// Fetches every calendar and calls back with their events in [from, to), sorted by start, and a
// short message per calendar that failed. `calendars` is [{url, color}]. `progress`, if given,
// gets a message as each download finishes, before the (slow) parse.
function loadEvents(calendars, from, to, callback, progress) {
  var pending = calendars.length;
  var all = [];
  var errors = [];
  if (!pending) return callback(all, errors);
  calendars.forEach(function (cal, i) {
    var name = 'Calendar ' + (i + 1) + ': ';
    fetchText(feedUrl(cal.url, from, to), function (err, text) {
      if (err) {
        console.log('calendar fetch failed: ' + err.message);
        errors.push(name + err.message);
      } else {
        var n = text.length;
        if (progress) progress(name + (n < 1e6 ? Math.ceil(n / 1e3) + ' KB' : (n / 1e6).toFixed(1) + ' MB'));
        try {
          all = all.concat(parseEvents(text, cal.color, from, to, calendarOwner(cal.url)));
        } catch (e) {
          console.log('calendar parse failed: ' + e);
          errors.push(name + "can't read");
        }
      }
      if (--pending === 0) {
        all.sort(function (a, b) { return a.start - b.start; });
        callback(all, errors);
      }
    });
  });
}

module.exports = { loadEvents: loadEvents, parseEvents: parseEvents, dropPastEvents: dropPastEvents, feedUrl: feedUrl };
