#pragma once
#include <pebble.h>

#define MAX_EVENTS 8
#define TITLE_LEN 40  // 4 * sizeof(Event) must fit PERSIST_DATA_MAX_LENGTH (see main.c)
#define SUN_UNKNOWN -1

typedef enum { THEME_BLACK = 0, THEME_TEAL = 1 } Theme;
typedef enum { COUNTDOWN_CARD = 0, COUNTDOWN_START = 1, COUNTDOWN_END = 2, COUNTDOWN_OFF = 3 } CountdownAt;

typedef struct {
  int32_t start;  // unix seconds
  int32_t end;
  uint8_t color;  // GColor8 argb
  char title[TITLE_LEN];
  bool tentative;  // not accepted: drawn as an outline
} Event;

// Persisted as one blob; append fields only, or bump SETTINGS_KEY.
typedef struct {
  uint8_t theme;   // Theme; superseded by `dial`, read only to migrate older settings
  uint8_t accent;  // GColor8 argb
  uint8_t countdown_at;
  bool hand_stretch;
  uint8_t refresh_minutes;  // calendar check interval; divides 1440
  uint8_t shake_seconds;    // how long a shake shows the second hand; 0 = never
  uint8_t dial;             // GColor8 argb
  uint8_t tick;             // major ticks, GColor8 argb; 0 (never a real colour) = derive from dial
  bool bt_vibe;             // buzz when the phone disconnects (not in Quiet Time)
} Settings;

typedef struct {
  time_t now;
  struct tm tm;
  uint8_t battery;
  bool bt_connected;
  bool quiet;
  bool show_seconds;
  int16_t sunrise_min;  // minutes after local midnight, or SUN_UNKNOWN
  int16_t sunset_min;
  Event events[MAX_EVENTS];  // sorted by start
  char status[32];  // phone's calendar status, shown when there's no upcoming event; "" = fine
  bool has_data;    // the phone has synced at least once
  uint8_t n_events;
  Settings settings;
} State;

// `visible` is the part not covered by Timeline Quick View.
void face_draw(GContext *ctx, GRect bounds, GRect visible, const State *s);
void face_init(void);
void face_deinit(void);
