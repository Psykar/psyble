var Clay = require('@rebble/clay');
var clayConfig = require('./config');
var calendar = require('./calendar');
var sun = require('./sun');

var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

// Must match MAX_EVENTS and TITLE_LEN in src/c/state.h.
var MAX_EVENTS = 8;
var TITLE_BYTES = 39;
var WINDOW_HOURS = 24;
var CALENDARS = 3;
var LOCATION_KEY = 'psyble-location';

function settings() {
  try {
    return JSON.parse(localStorage.getItem('clay-settings')) || {};
  } catch (e) {
    return {};
  }
}

function utf8Length(s) { return unescape(encodeURIComponent(s)).length; }

// The watch font covers printable ASCII and Latin-1; titles are truncated to fit Event.title.
function cleanTitle(s) {
  s = String(s).replace(/[^ -~¡-ÿ]/g, ' ').replace(/\s+/g, ' ').trim();
  while (utf8Length(s) > TITLE_BYTES) s = s.slice(0, -1);
  return s;
}

function encodeEvents(events) {
  return events.slice(0, MAX_EVENTS).map(function (e) {
    return [Math.floor(e.start / 1000), Math.floor(e.end / 1000), e.color, e.tentative ? 1 : 0, cleanTitle(e.title)]
      .join('\x1f');
  }).join('\x1e');
}

function minutesAfterMidnight(date) { return date.getHours() * 60 + date.getMinutes(); }

function withLocation(callback) {
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(LOCATION_KEY)); } catch (e) { /* none */ }
  navigator.geolocation.getCurrentPosition(function (pos) {
    var loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    localStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
    callback(loc);
  }, function () {
    callback(cached);
  }, { timeout: 15000, maximumAge: 3 * 3600 * 1000 });
}

function calendars() {
  var s = settings();
  var out = [];
  for (var i = 0; i < CALENDARS; i++) {
    var url = (s['CAL_URL[' + i + ']'] || '').trim();
    if (url) out.push({ url: url, color: Number(s['CAL_COLOR[' + i + ']'] || 0x00AAFF) });
  }
  return out;
}

function send(dict) {
  Pebble.sendAppMessage(dict, function () {}, function (e) {
    console.log('send failed: ' + JSON.stringify(e));
  });
}

function refresh() {
  var now = new Date();
  var pending = 2;
  var dict = {};
  function done() { if (--pending === 0) send(dict); }

  withLocation(function (loc) {
    var t = loc && sun.sunTimes(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), loc.lat, loc.lng);
    dict.SUNRISE = t ? minutesAfterMidnight(t.rise) : -1;
    dict.SUNSET = t ? minutesAfterMidnight(t.set) : -1;
    done();
  });

  var cals = calendars();
  if (!cals.length) {
    dict.EVENTS = '';
    done();
    return;
  }
  calendar.loadEvents(cals, now, new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000), function (events) {
    dict.EVENTS = encodeEvents(events);
    done();
  });
}

Pebble.addEventListener('ready', refresh);

Pebble.addEventListener('appmessage', function (e) {
  if (e.payload.REQUEST) refresh();
});

Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) return;
  clay.getSettings(e.response);
  var s = settings();
  send({
    THEME: parseInt(s.THEME || '1', 10),
    ACCENT: Number(s.ACCENT || 0xFFAA00),
    COUNTDOWN_AT: parseInt(s.COUNTDOWN_AT || '0', 10),
    HAND_REACH: s.HAND_REACH ? 1 : 0
  });
  setTimeout(refresh, 500);
});
