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
  uint8_t theme;
  uint8_t accent;  // GColor8 argb
  uint8_t countdown_at;
  bool hand_stretch;
} Settings;

typedef struct {
  time_t now;
  struct tm tm;
  uint8_t battery;
  bool bt_connected;
  bool quiet;
  int16_t sunrise_min;  // minutes after local midnight, or SUN_UNKNOWN
  int16_t sunset_min;
  Event events[MAX_EVENTS];  // sorted by start
  uint8_t n_events;
  Settings settings;
} State;

void face_draw(GContext *ctx, GRect bounds, const State *s);
void face_init(void);
void face_deinit(void);
