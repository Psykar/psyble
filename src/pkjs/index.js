var Clay = require('@rebble/clay');
var clayConfig = require('./config');
var calendar = require('./calendar');
var sun = require('./sun');

var clay = new Clay(clayConfig, require('./config-page'), {
  autoHandleEvents: false,
  userData: { fonts: require('./preview-fonts') }
});

// Must match MAX_EVENTS and TITLE_LEN in src/c/state.h.
var MAX_EVENTS = 8;
var TITLE_BYTES = 39;
var WINDOW_HOURS = 24;
var CALENDARS = 3;
var LOCATION_KEY = 'psyble-location';
var LAST_FETCH_KEY = 'psyble-last-fetch';
var WATCH_HASH_KEY = 'psyble-watch-hash';  // DATA_HASH of what the watch last stored
var STATUS_KEY = 'psyble-status';  // STATUS the watch last stored
var STATUS_BYTES = 31;  // Must match State.status in src/c/state.h
// 'ready' fires every time the face opens; a non-Google calendar is downloaded in full each fetch.
var READY_MIN_GAP_MS = 10 * 60 * 1000;

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

// 32-bit string hash; only compared for equality.
function hash(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Messages go one at a time: a send while another is in flight can be rejected as busy.
var queue = [];
var sending = false;

function send(dict, onAck) {
  queue.push({ dict: dict, onAck: onAck });
  pump();
}

function pump() {
  if (sending || !queue.length) return;
  sending = true;
  var item = queue.shift();
  Pebble.sendAppMessage(item.dict, function () {
    sending = false;
    if (item.onAck) item.onAck();
    pump();
  }, function (e) {
    sending = false;
    console.log('send failed: ' + JSON.stringify(e));
    pump();
  });
}

// Shown on the watch when there's no upcoming event; '' when all is well.
function setStatus(s) {
  s = s.slice(0, STATUS_BYTES);
  if (s === (localStorage.getItem(STATUS_KEY) || '')) return;
  send({ STATUS: s }, function () { localStorage.setItem(STATUS_KEY, s); });
}

function clock(d) { return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }

var busy = false;
var again = false;

// Fetches everything and sends it only if it differs from what the watch holds. `watchHash` is
// the watch's DATA_HASH when it asked; otherwise the last one it acknowledged is assumed.
// One fetch at a time: a call during a fetch reruns once it finishes.
function refresh(watchHash) {
  if (watchHash !== undefined) localStorage.setItem(WATCH_HASH_KEY, String(watchHash));
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  localStorage.setItem(LAST_FETCH_KEY, String(Date.now()));
  var now = new Date();
  var pending = 2;
  var errors = [];
  var dict = {};
  var cals = calendars();
  // While the watch has no data or is showing a status, report progress so a stalled or crashed
  // fetch shows where it stopped.
  var fresh = !Number(localStorage.getItem(WATCH_HASH_KEY)) || !!localStorage.getItem(STATUS_KEY);
  function progress(s) { if (fresh) setStatus(s); }
  var finalStatus = cals.length ? '' : 'No calendar set';
  function done() {
    if (--pending) return;
    busy = false;
    if (again) {
      again = false;
      refresh();
      return;
    }
    if (errors.length) {
      setStatus(errors[0]);  // keep the watch's events rather than wiping them
      return;
    }
    dict.DATA_HASH = hash([dict.EVENTS, dict.SUNRISE, dict.SUNSET].join('|'));
    if (String(dict.DATA_HASH) === localStorage.getItem(WATCH_HASH_KEY)) {
      console.log('unchanged; not sending');
      setStatus(finalStatus);
      return;
    }
    send(dict, function () {
      localStorage.setItem(WATCH_HASH_KEY, String(dict.DATA_HASH));
      setStatus(finalStatus);
    });
  }

  withLocation(function (loc) {
    var t = loc && sun.sunTimes(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), loc.lat, loc.lng);
    dict.SUNRISE = t ? minutesAfterMidnight(t.rise) : -1;
    dict.SUNSET = t ? minutesAfterMidnight(t.set) : -1;
    done();
  });

  if (!cals.length) {
    dict.EVENTS = '';
    done();
    return;
  }
  progress('Downloading... ' + clock(now));
  calendar.loadEvents(cals, now, new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000), function (events, errs) {
    errors = errs;
    dict.EVENTS = encodeEvents(events);
    done();
  }, function (s) { progress('Reading ' + s); });
}

Pebble.addEventListener('ready', function () {
  if (Date.now() - Number(localStorage.getItem(LAST_FETCH_KEY) || 0) >= READY_MIN_GAP_MS) refresh();
});

Pebble.addEventListener('appmessage', function (e) {
  if (e.payload.REQUEST) refresh(e.payload.DATA_HASH || 0);
});

Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) return;
  clay.getSettings(e.response);
  var s = settings();
  send({
    DIAL: Number(s.DIAL === undefined ? 0x000055 : s.DIAL),
    TICK: s.TICK_AUTO === false ? Number(s.TICK === undefined ? 0xFFFFAA : s.TICK) : -1,
    ACCENT: Number(s.ACCENT || 0xFFAA00),
    COUNTDOWN_AT: parseInt(s.COUNTDOWN_AT || '0', 10),
    HAND_REACH: s.HAND_REACH ? 1 : 0,
    BT_VIBE: s.BT_VIBE ? 1 : 0,
    REFRESH_MINUTES: parseInt(s.REFRESH_MINUTES || '30', 10),
    SHAKE_SECONDS: parseInt(s.SHAKE_SECONDS === undefined ? '30' : s.SHAKE_SECONDS, 10)
  });
  setTimeout(function () { refresh(); }, 500);
});
