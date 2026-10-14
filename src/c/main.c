#include <stddef.h>
#include "state.h"

#define SETTINGS_KEY 1
#define SUN_KEY 2
#define EVENTS_COUNT_KEY 3
#define DATA_HASH_KEY 4  // phone's hash of the events and sun times stored here; 0 = none
#define STATUS_KEY 5
#define EVENTS_KEY_0 10  // events are persisted in chunks: PERSIST_DATA_MAX_LENGTH is 256 bytes
#define EVENTS_PER_CHUNK 4

static Window *s_window;
static Layer *s_layer;
static State s_state;
static int32_t s_data_hash;
static time_t s_seconds_until;

static void update_proc(Layer *layer, GContext *ctx) {
  face_draw(ctx, layer_get_bounds(layer), layer_get_unobstructed_bounds(layer), &s_state);
}

static void redraw(void) {
  if (s_layer) layer_mark_dirty(s_layer);
}

// ---- persistence -----------------------------------------------------------------------------

static void save_events(void) {
  persist_write_int(EVENTS_COUNT_KEY, s_state.n_events);
  for (int i = 0; i * EVENTS_PER_CHUNK < s_state.n_events; i++) {
    int n = s_state.n_events - i * EVENTS_PER_CHUNK;
    if (n > EVENTS_PER_CHUNK) n = EVENTS_PER_CHUNK;
    persist_write_data(EVENTS_KEY_0 + i, &s_state.events[i * EVENTS_PER_CHUNK], n * sizeof(Event));
  }
}

static void load_events(void) {
  int n = persist_exists(EVENTS_COUNT_KEY) ? persist_read_int(EVENTS_COUNT_KEY) : 0;
  if (n < 0 || n > MAX_EVENTS) n = 0;
  for (int i = 0; i * EVENTS_PER_CHUNK < n; i++) {
    int c = n - i * EVENTS_PER_CHUNK;
    if (c > EVENTS_PER_CHUNK) c = EVENTS_PER_CHUNK;
    if (persist_read_data(EVENTS_KEY_0 + i, &s_state.events[i * EVENTS_PER_CHUNK], c * sizeof(Event)) !=
        (int)(c * sizeof(Event))) {
      n = 0;
      persist_delete(DATA_HASH_KEY);  // so the phone resends
      break;
    }
  }
  s_state.n_events = n;
}

static void load_settings(void) {
  s_state.settings = (Settings){
      .theme = THEME_TEAL,
      .accent = GColorFromHEX(0xFFAA00).argb,
      .countdown_at = COUNTDOWN_CARD,
      .hand_stretch = false,
      .refresh_minutes = 30,
      .shake_seconds = 30,
      .dial = GColorFromHEX(0x000055).argb,
  };
  int n = persist_exists(SETTINGS_KEY) ? persist_read_data(SETTINGS_KEY, &s_state.settings, sizeof(Settings)) : 0;
  // Settings saved before `dial` existed keep their teal or black theme.
  if (n > 0 && n <= (int)offsetof(Settings, dial)) {
    s_state.settings.dial = s_state.settings.theme == THEME_BLACK ? GColorBlack.argb : GColorFromHEX(0x005555).argb;
  }

  int16_t sun[2] = {SUN_UNKNOWN, SUN_UNKNOWN};
  if (persist_exists(SUN_KEY)) persist_read_data(SUN_KEY, sun, sizeof(sun));
  s_state.sunrise_min = sun[0];
  s_state.sunset_min = sun[1];
}

// ---- time and status -------------------------------------------------------------------------

static void drop_past_events(void) {
  int w = 0;
  for (int i = 0; i < s_state.n_events; i++) {
    if (s_state.events[i].end > s_state.now) s_state.events[w++] = s_state.events[i];
  }
  if (w != s_state.n_events) {
    s_state.n_events = w;
    save_events();
  }
}

static void request_refresh(void) {
  // The minute tick can repeat within a minute after the clock changes; each request costs the
  // phone a full calendar download.
  static time_t s_last;
  if (s_state.now - s_last < 60) return;
  s_last = s_state.now;
  DictionaryIterator *it;
  if (app_message_outbox_begin(&it) != APP_MSG_OK) return;
  dict_write_uint8(it, MESSAGE_KEY_REQUEST, 1);
  dict_write_int32(it, MESSAGE_KEY_DATA_HASH, s_data_hash);
  app_message_outbox_send();
}

#ifdef PSYBLE_DEMO
// Mirrors the sample data in the design mock-ups.
static void demo_state(void) {
  int hhmm = PSYBLE_DEMO;
  time_t t = time(NULL);
  struct tm *lt = localtime(&t);
  time_t midnight = t - (lt->tm_hour * 3600 + lt->tm_min * 60 + lt->tm_sec);
  s_state.now = midnight + (hhmm / 100) * 3600 + (hhmm % 100) * 60;
  s_state.tm = *localtime(&s_state.now);
  s_state.tm.tm_wday = PBL_IF_ROUND_ELSE(2, 3);
  s_state.tm.tm_mday = PBL_IF_ROUND_ELSE(13, 14);
  s_state.battery = hhmm == 1008 ? 18 : 72;
  s_state.bt_connected = false;
  s_state.quiet = true;
  s_state.sunrise_min = 6 * 60 + 31;
  s_state.sunset_min = 19 * 60 + 43;
  static const struct { int s, e; uint32_t c; const char *t; } ev[] = {
      {930, 960, 0x00AAFF, "Standup"}, {1020, 1110, 0x55AA55, "Design review"},
      {1155, 1200, 0xFF5500, "Dinner"}, {1290, 1320, 0xAA00AA, "Call"}, {1980, 2040, 0x0055AA, "Gym"}};
  s_state.n_events = 0;
  for (unsigned i = 0; i < ARRAY_LENGTH(ev); i++) {
    Event *e = &s_state.events[s_state.n_events];
    e->start = midnight + ev[i].s * 60;
    e->end = midnight + ev[i].e * 60;
    if (e->end <= s_state.now) continue;
    e->color = GColorFromHEX(ev[i].c).argb;
    e->tentative = false;
    strncpy(e->title, ev[i].t, TITLE_LEN - 1);
    s_state.n_events++;
  }
}
#endif

static void refresh_time(void) {
  s_state.now = time(NULL);
  s_state.tm = *localtime(&s_state.now);
  s_state.quiet = quiet_time_is_active();
  drop_past_events();
#ifdef PSYBLE_DEMO
  demo_state();
#endif
}

static void tick_handler(struct tm *tick_time, TimeUnits changed) {
  refresh_time();
  if (s_state.show_seconds && s_state.now >= s_seconds_until) {
    s_state.show_seconds = false;
    tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
  }
  int interval = s_state.settings.refresh_minutes ? s_state.settings.refresh_minutes : 30;
  if ((changed & MINUTE_UNIT) && (tick_time->tm_hour * 60 + tick_time->tm_min) % interval == 0) request_refresh();
  redraw();
}

static void unobstructed_change(AnimationProgress progress, void *context) {
  redraw();
}

// A shake shows the second hand for a while, ticking every second only until it hides again.
static void tap_handler(AccelAxisType axis, int32_t direction) {
  if (!s_state.settings.shake_seconds) return;
  s_seconds_until = time(NULL) + s_state.settings.shake_seconds;
  if (!s_state.show_seconds) {
    s_state.show_seconds = true;
    tick_timer_service_subscribe(SECOND_UNIT, tick_handler);
  }
  refresh_time();
  redraw();
}

static void battery_handler(BatteryChargeState charge) {
  s_state.battery = charge.charge_percent;
  redraw();
}

static void bt_handler(bool connected) {
  if (s_state.bt_connected && !connected && s_state.settings.bt_vibe && !quiet_time_is_active()) {
    vibes_double_pulse();
  }
  s_state.bt_connected = connected;
#ifdef PSYBLE_DEMO
  s_state.bt_connected = false;
#endif
  redraw();
}

// ---- phone messages --------------------------------------------------------------------------

// Records are separated by 0x1E and fields by 0x1F: start, end (unix seconds), colour (0xRRGGBB),
// tentative (0/1), title.
static void parse_events(char *str) {
  s_state.n_events = 0;
  char *rec = str;
  while (rec && *rec && s_state.n_events < MAX_EVENTS) {
    char *rec_end = strchr(rec, '\x1e');
    if (rec_end) *rec_end = '\0';
    char *f[5] = {rec, NULL, NULL, NULL, NULL};
    for (int i = 1; i < 5 && f[i - 1]; i++) {
      char *sep = strchr(f[i - 1], '\x1f');
      if (sep) {
        *sep = '\0';
        f[i] = sep + 1;
      }
    }
    if (f[4]) {
      Event *e = &s_state.events[s_state.n_events++];
      e->start = atoi(f[0]);
      e->end = atoi(f[1]);
      e->color = GColorFromHEX(atoi(f[2])).argb;
      e->tentative = atoi(f[3]) != 0;
      strncpy(e->title, f[4], TITLE_LEN - 1);
      e->title[TITLE_LEN - 1] = '\0';
    }
    rec = rec_end ? rec_end + 1 : NULL;
  }
}

static void inbox_received(DictionaryIterator *it, void *ctx) {
  Tuple *t;
  bool settings_changed = false;
  if ((t = dict_find(it, MESSAGE_KEY_EVENTS))) {
    parse_events(t->value->cstring);
    save_events();
  }
  Tuple *rise = dict_find(it, MESSAGE_KEY_SUNRISE), *set = dict_find(it, MESSAGE_KEY_SUNSET);
  if (rise && set) {
    int16_t sun[2] = {(int16_t)rise->value->int32, (int16_t)set->value->int32};
    s_state.sunrise_min = sun[0];
    s_state.sunset_min = sun[1];
    persist_write_data(SUN_KEY, sun, sizeof(sun));
  }
  if ((t = dict_find(it, MESSAGE_KEY_DATA_HASH))) {
    s_data_hash = t->value->int32;
    s_state.has_data = s_data_hash != 0;
    persist_write_int(DATA_HASH_KEY, s_data_hash);
  }
  if ((t = dict_find(it, MESSAGE_KEY_STATUS))) {
    strncpy(s_state.status, t->value->cstring, sizeof(s_state.status) - 1);
    persist_write_string(STATUS_KEY, s_state.status);
  }
  if ((t = dict_find(it, MESSAGE_KEY_DIAL))) {
    s_state.settings.dial = GColorFromHEX(t->value->int32).argb;
    settings_changed = true;
  }
  if ((t = dict_find(it, MESSAGE_KEY_TICK))) {  // < 0 = automatic
    s_state.settings.tick = t->value->int32 < 0 ? 0 : GColorFromHEX(t->value->int32).argb;
    settings_changed = true;
  }
  if ((t = dict_find(it, MESSAGE_KEY_ACCENT))) {
    s_state.settings.accent = GColorFromHEX(t->value->int32).argb;
    settings_changed = true;
  }
  if ((t = dict_find(it, MESSAGE_KEY_COUNTDOWN_AT))) {
    s_state.settings.countdown_at = t->value->int32;
    settings_changed = true;
  }
  if ((t = dict_find(it, MESSAGE_KEY_HAND_REACH))) {
    s_state.settings.hand_stretch = t->value->int32 != 0;
    settings_changed = true;
  }
  if ((t = dict_find(it, MESSAGE_KEY_BT_VIBE))) {
    s_state.settings.bt_vibe = t->value->int32 != 0;
    settings_changed = true;
  }
  if ((t = dict_find(it, MESSAGE_KEY_SHAKE_SECONDS))) {
    s_state.settings.shake_seconds = t->value->int32;
    settings_changed = true;
  }
  if ((t = dict_find(it, MESSAGE_KEY_REFRESH_MINUTES))) {
    s_state.settings.refresh_minutes = t->value->int32;
    settings_changed = true;
  }
  if (settings_changed) persist_write_data(SETTINGS_KEY, &s_state.settings, sizeof(Settings));
  refresh_time();
  redraw();
}

// ---- lifecycle -------------------------------------------------------------------------------

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer, update_proc);
  layer_add_child(root, s_layer);
}

static void window_unload(Window *window) {
  layer_destroy(s_layer);
  s_layer = NULL;
}

static void init(void) {
  load_settings();
  load_events();
  s_data_hash = persist_exists(DATA_HASH_KEY) ? persist_read_int(DATA_HASH_KEY) : 0;
  s_state.has_data = s_data_hash != 0;
  if (persist_exists(STATUS_KEY)) persist_read_string(STATUS_KEY, s_state.status, sizeof(s_state.status));
  face_init();
  s_state.battery = battery_state_service_peek().charge_percent;
  bt_handler(connection_service_peek_pebble_app_connection());
  refresh_time();

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){.load = window_load, .unload = window_unload});
  window_stack_push(s_window, true);

  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
  battery_state_service_subscribe(battery_handler);
  accel_tap_service_subscribe(tap_handler);
  unobstructed_area_service_subscribe((UnobstructedAreaHandlers){.change = unobstructed_change}, NULL);
  connection_service_subscribe((ConnectionHandlers){.pebble_app_connection_handler = bt_handler});

  app_message_register_inbox_received(inbox_received);
  app_message_open(1024, 64);
}

static void deinit(void) {
  tick_timer_service_unsubscribe();
  battery_state_service_unsubscribe();
  accel_tap_service_unsubscribe();
  unobstructed_area_service_unsubscribe();
  connection_service_unsubscribe();
  window_destroy(s_window);
  face_deinit();
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
