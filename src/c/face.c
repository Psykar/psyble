#include "state.h"
#include "aafont.h"

// Geometry is written in the mock-up's units (design/round-D.html, design/time-steel-H.html):
// a 260-unit circle for round watches and a 144x168 rectangle for rectangular ones,
// scaled to the actual display. Angles are degrees clockwise from 12 o'clock.

#define FABS(x) ((x) < 0 ? -(x) : (x))
#define FMIN(a, b) ((a) < (b) ? (a) : (b))
#define FMAX(a, b) ((a) > (b) ? (a) : (b))

#define DESIGN_R 130.f
// Insets of the line from now to the next event.
#define SWEEP_OUTER PBL_IF_ROUND_ELSE(5.25f, 7.65f)
#define SWEEP_INNER PBL_IF_ROUND_ELSE(6.25f, 8.65f)
// Barlow Condensed: cap height 0.70em; with CSS line-height 1 the baseline sits 0.90em below the box top.
#define CAP_EM 0.70f
#define BASELINE_EM 0.90f

#define C_GREY GColorFromHEX(0xAAAAAA)
#define C_DARK_GREY GColorFromHEX(0x555555)
#define C_RED GColorFromHEX(0xFF5555)
#define C_AMBER GColorFromHEX(0xFFAA00)
#define C_GREEN GColorFromHEX(0x55AA55)
#define C_SUNRISE GColorFromHEX(0xFFFF55)
#define C_SUNSET GColorFromHEX(0xFFAA55)
#define C_MOUSE GColorFromHEX(0xAAAAFF)

typedef struct { float x, y; } Pt;

typedef struct {
  GColor dial, tick, min_tick, track, shadow;
} Palette;

typedef struct {
#ifdef PBL_COLOR
  AAFont *aa;
#else
  GFont font;
  int baseline;    // px from the draw box top to the baseline; checked against emulator screenshots
#endif
  int em;          // font size in px
} Font;

static struct {
  bool round;
  float cx, cy, k;  // centre, design unit -> px
  float hw, hh;     // half extents (rect)
  float kx, ky;     // per-axis scale (rect)
} g;

static Font s_weekday, s_day, s_time, s_label, s_num, s_countdown;

static float fsin(float deg) {
  int32_t a = (int32_t)DEG_TO_TRIGANGLE(deg) % TRIG_MAX_ANGLE;
  if (a < 0) a += TRIG_MAX_ANGLE;
  return sin_lookup(a) / (float)TRIG_MAX_RATIO;
}
static float fcos(float deg) { return fsin(deg + 90.f); }

static float ang_dist(float a, float b) {
  float d = a - b;
  while (d < 0) d += 360.f;
  while (d >= 360.f) d -= 360.f;
  return FMIN(d, 360.f - d);
}

static int iround(float v) { return (int)(v < 0 ? v - 0.5f : v + 0.5f); }
static GPoint gp(Pt p) { return GPoint(iround(p.x), iround(p.y)); }
static int px(float units) { return FMAX(1, iround(units * g.k)); }

// Distance from the centre to the dial ring at `inset` design units in from the screen edge.
static float ring_dist(float inset, float deg, char *side) {
  if (g.round) return (DESIGN_R - inset) * g.k;
  float sx = fsin(deg), sy = -fcos(deg);
  float ta = FABS(sx) > 1e-4f ? (g.hw - inset * g.k) / FABS(sx) : 1e9f;
  float tb = FABS(sy) > 1e-4f ? (g.hh - inset * g.k) / FABS(sy) : 1e9f;
  if (side) *side = ta < tb ? (sx > 0 ? 'r' : 'l') : (sy < 0 ? 't' : 'b');
  return FMIN(ta, tb);
}

static Pt ring(float inset, float deg) {
  float t = ring_dist(inset, deg, NULL);
  return (Pt){g.cx + t * fsin(deg), g.cy - t * fcos(deg)};
}

static Pt polar(float r_units, float deg) {
  return (Pt){g.cx + r_units * g.k * fsin(deg), g.cy - r_units * g.k * fcos(deg)};
}

// The 8 dodge slots: a circle on round screens, a tall ellipse on rectangular ones.
static Pt slot(float r_round, float deg) {
  if (g.round) return polar(r_round, deg);
  return (Pt){g.cx + 38.f * g.kx * fsin(deg), g.cy - 47.f * g.ky * fcos(deg)};
}

// ---- primitives ------------------------------------------------------------------------------

#define BAND_MAX_STEPS 240
static GPoint s_poly[2 * (BAND_MAX_STEPS + 1)];

static void fill_poly(GContext *ctx, GPoint *pts, int n, GColor c) {
  GPath path = {.num_points = n, .points = pts, .rotation = 0, .offset = GPointZero};
  graphics_context_set_fill_color(ctx, c);
  gpath_draw_filled(ctx, &path);
  // Path fills are not antialiased; a 1px outline in the same colour smooths the edges.
  graphics_context_set_stroke_color(ctx, c);
  graphics_context_set_stroke_width(ctx, 1);
  gpath_draw_outline(ctx, &path);
}

// Arc of radius r px and thickness px round the screen centre, from angle a to b (may exceed 360).
static void fill_arc(GContext *ctx, int r, int thick, float a, float b) {
  GRect rect = GRect(iround(g.cx) - r, iround(g.cy) - r, 2 * r, 2 * r);
  while (a < 0) { a += 360.f; b += 360.f; }
  while (a >= 360.f) { a -= 360.f; b -= 360.f; }
  if (b > 360.f) {
    graphics_fill_radial(ctx, rect, GOvalScaleModeFitCircle, thick, DEG_TO_TRIGANGLE(a), TRIG_MAX_ANGLE);
    a = 0.f;
    b -= 360.f;
  }
  graphics_fill_radial(ctx, rect, GOvalScaleModeFitCircle, thick, DEG_TO_TRIGANGLE(a), DEG_TO_TRIGANGLE(b));
}

// Ring segment between two insets, from angle a to b (b > a, may exceed 360): filled when
// outline_w is 0, else outlined with strokes outline_w px wide, kept inside the segment.
static void fill_band(GContext *ctx, float in_outer, float in_inner, float a, float b, GColor c, int outline_w) {
  if (b <= a) return;
  if (g.round) {
    int r = iround((DESIGN_R - in_outer) * g.k);
    int thick = FMAX(1, iround((in_inner - in_outer) * g.k));
    graphics_context_set_fill_color(ctx, c);
    if (!outline_w) {
      fill_arc(ctx, r, thick, a, b);
      return;
    }
    fill_arc(ctx, r, outline_w, a, b);
    fill_arc(ctx, r - thick + outline_w, outline_w, a, b);
    graphics_context_set_stroke_color(ctx, c);
    graphics_context_set_stroke_width(ctx, outline_w);
    graphics_draw_line(ctx, gp(polar(DESIGN_R - in_outer, a)), gp(polar(DESIGN_R - in_inner, a)));
    graphics_draw_line(ctx, gp(polar(DESIGN_R - in_outer, b)), gp(polar(DESIGN_R - in_inner, b)));
    return;
  }
  float half = outline_w / 2.f / g.k;
  in_outer += half;
  in_inner -= half;
  int n = (int)((b - a) / 1.5f) + 1;
  if (n < 2) n = 2;
  if (n > BAND_MAX_STEPS) n = BAND_MAX_STEPS;
  for (int i = 0; i <= n; i++) {
    float d = a + (b - a) * i / n;
    s_poly[i] = gp(ring(in_outer, d));
    s_poly[2 * n + 1 - i] = gp(ring(in_inner, d));
  }
  int m = 2 * (n + 1);
  if (!outline_w) {
    fill_poly(ctx, s_poly, m, c);
    return;
  }
  graphics_context_set_stroke_color(ctx, c);
  graphics_context_set_stroke_width(ctx, outline_w);
  for (int i = 0; i < m; i++) graphics_draw_line(ctx, s_poly[i], s_poly[(i + 1) % m]);
}

static void fill_disc_ring(GContext *ctx, Pt c, float r_outer, int thick, float a, float b, GColor col) {
  int r = iround(r_outer);
  GRect rect = GRect(iround(c.x) - r, iround(c.y) - r, 2 * r, 2 * r);
  graphics_context_set_fill_color(ctx, col);
  graphics_fill_radial(ctx, rect, GOvalScaleModeFitCircle, thick, DEG_TO_TRIGANGLE(a), DEG_TO_TRIGANGLE(b));
}

static void line(GContext *ctx, Pt a, Pt b, int w, GColor c) {
  graphics_context_set_stroke_color(ctx, c);
  graphics_context_set_stroke_width(ctx, w);
  graphics_draw_line(ctx, gp(a), gp(b));
}

static void disc(GContext *ctx, Pt c, float r, GColor col) {
  graphics_context_set_fill_color(ctx, col);
  graphics_fill_circle(ctx, gp(c), FMAX(1, iround(r)));
}

static void ticks(GContext *ctx, float inner, float outer, int width, GColor c, bool (*want)(int)) {
  for (int i = 0; i < 60; i++) {
    if (!want(i)) continue;
    line(ctx, ring(inner, i * 6.f), ring(outer, i * 6.f), width, c);
  }
}
static bool is_minute(int i) { return i % 5 != 0; }
static bool is_hour(int i) { return i % 5 == 0 && i % 15 != 0; }
static bool is_quarter(int i) { return i % 15 == 0; }

// Icon drawing in an 18x18 viewBox centred on `o`, scaled by `s` px per unit and rotated by `rot`.
typedef struct { Pt o; float s, rot; } Xf;
static Pt xf(const Xf *t, float x, float y) {
  float c = fcos(t->rot), sn = fsin(t->rot);
  return (Pt){t->o.x + t->s * (x * c - y * sn), t->o.y + t->s * (x * sn + y * c)};
}
static void xf_polyline(GContext *ctx, const Xf *t, const float *xy, int n, int w, GColor c) {
  for (int i = 0; i + 1 < n; i++) {
    line(ctx, xf(t, xy[2 * i], xy[2 * i + 1]), xf(t, xy[2 * i + 2], xy[2 * i + 3]), w, c);
  }
}

// Frame for a marker on the ring at `inset`: +y points out through the nearest screen edge (radially
// on round screens) and -x runs clockwise. Squared to the edge on rectangular screens so markers keep
// their shape near the corners, and snapped to a pixel so small shapes stay symmetric.
static Xf edge_xf(float inset, float deg, float s) {
  char side = 'b';
  Pt p = ring(inset, deg);
  if (!g.round) ring_dist(inset, deg, &side);
  float rot = g.round ? deg - 180.f : side == 'b' ? 0 : side == 'l' ? 90 : side == 't' ? 180 : 270;
  return (Xf){{iround(p.x), iround(p.y)}, s, rot};
}

// ---- text ------------------------------------------------------------------------------------

// Draws `str` centred on cx with its baseline at `baseline_y`, `spacing` px between glyphs.
static void text_tracked(GContext *ctx, const char *str, const Font *f, GColor c, float cx, float baseline_y,
                         int max_w, int spacing) {
#ifdef PBL_COLOR
  int w = aafont_width(f->aa, str, spacing);
  if (w > max_w) w = max_w;
  aafont_draw(ctx, f->aa, str, c, iround(cx - w / 2.f), iround(baseline_y), spacing, max_w);
#else
  // 1-bit screens use the SDK's font renderer, which has no letter spacing.
  graphics_context_set_text_color(ctx, c);
  GRect box = GRect(iround(cx) - max_w / 2, iround(baseline_y) - f->baseline, max_w, f->em * 2);
  graphics_draw_text(ctx, str, f->font, box, GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
#endif
}

static void text(GContext *ctx, const char *str, const Font *f, GColor c, float cx, float baseline_y,
                 int max_w) {
  text_tracked(ctx, str, f, c, cx, baseline_y, max_w, 0);
}

static int text_width(const char *str, const Font *f) {
#ifdef PBL_COLOR
  return aafont_width(f->aa, str, 0);
#else
  return graphics_text_layout_get_content_size(str, f->font, GRect(0, 0, 1000, 2 * f->em),
                                               GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).w;
#endif
}

// Splits `str` into `line1` and the remainder `*rest` (NULL if it fits on one line): at the last
// space that fits in max_w, else at the last whole UTF-8 character that does.
static void wrap(const char *str, const Font *f, int max_w, char *line1, size_t size, const char **rest) {
  strncpy(line1, str, size - 1);
  line1[size - 1] = '\0';
  *rest = NULL;
  if (text_width(line1, f) <= max_w) return;
  size_t fit_space = 0, fit_char = 0;
  for (size_t i = 1; str[i - 1] && i < size; i++) {
    if ((str[i] & 0xC0) == 0x80) continue;
    line1[i] = '\0';
    if (text_width(line1, f) > max_w) break;
    fit_char = i;
    if (str[i] == ' ') fit_space = i;
    line1[i] = str[i];
  }
  size_t cut = fit_space ? fit_space : fit_char;
  if (!cut) cut = 1;
  line1[cut] = '\0';
  *rest = str + cut + (str[cut] == ' ');
  if (!**rest) *rest = NULL;
}

// ---- components ------------------------------------------------------------------------------

static void draw_bt_off(GContext *ctx, Pt at, float s, GColor dial) {
  Xf t = {at, s, 0};
  static const float rune[] = {-3.5f, -3.5f, 3.5f, 3.5f, 0, 7, 0, -7, 3.5f, -3.5f, -3.5f, 3.5f};
  xf_polyline(ctx, &t, rune, 6, FMAX(1, iround(1.6f * s)), C_GREY);
  line(ctx, xf(&t, -4, -8), xf(&t, 4, 8), FMAX(2, iround(4.5f * s)), dial);
  line(ctx, xf(&t, -4, -8), xf(&t, 4, 8), FMAX(1, iround(2.f * s)), C_RED);
}

// Tiptoeing mouse (quiet time).
static void draw_mouse(GContext *ctx, Pt at, float s) {
  Xf t = {at, s, 0};
  int w = FMAX(1, iround(1.2f * s));
  static const float tail[] = {-4.6f, 3.2f, -6.4f, 2.8f, -7.5f, 1.5f, -7.9f, -0.2f, -7.6f, -2.4f};
  static const float leg1[] = {-1.8f, 4.4f, -2.8f, 7.6f, -1.6f, 7.8f};
  static const float leg2[] = {0.8f, 4.6f, 1.6f, 7.6f, 2.8f, 7.8f};
  static const float arm[] = {1.6f, -1.4f, 5.8f, -2.4f};
  xf_polyline(ctx, &t, tail, 5, w, C_MOUSE);
  xf_polyline(ctx, &t, leg1, 3, w, C_MOUSE);
  xf_polyline(ctx, &t, leg2, 3, w, C_MOUSE);
  xf_polyline(ctx, &t, arm, 2, w, C_MOUSE);
  // Body: ellipse rx 3.8, ry 4.6 at (-1, 0.6), rotated -20deg.
  GPoint body[16];
  for (int i = 0; i < 16; i++) {
    float d = i * 22.5f, ex = 3.8f * fcos(d), ey = 4.6f * fsin(d);
    float c = fcos(-20.f), sn = fsin(-20.f);
    body[i] = gp(xf(&t, -1.f + ex * c - ey * sn, 0.6f + ex * sn + ey * c));
  }
  fill_poly(ctx, body, 16, C_MOUSE);
  disc(ctx, xf(&t, 2.8f, -4.8f), 2.5f * s, C_MOUSE);
  GPoint nose[3] = {gp(xf(&t, 4.6f, -6)), gp(xf(&t, 7.2f, -4.2f)), gp(xf(&t, 4.8f, -3.2f))};
  fill_poly(ctx, nose, 3, C_MOUSE);
  disc(ctx, xf(&t, 1.4f, -7.2f), 1.5f * s, C_MOUSE);
  disc(ctx, xf(&t, 3.4f, -5.2f), FMAX(0.5f, 0.55f * s), GColorBlack);
}

// Half sun with its flat edge on the screen edge, plus a chevron just inside the calendar ring
// (pointing inwards for sunrise, outwards for sunset).
static void draw_sun(GContext *ctx, int minutes, bool rise) {
  if (minutes == SUN_UNKNOWN) return;
  float deg = (minutes % 720) / 2.f;
  GColor c = rise ? C_SUNRISE : C_SUNSET;
  Xf t = edge_xf(PBL_IF_ROUND_ELSE(15, 10.5f), deg, PBL_IF_ROUND_ELSE(0.89f, 0.6f) * g.k);
  float rot = t.rot;
  Pt edge = ring(0, deg);
  int ri = FMAX(2, iround(PBL_IF_ROUND_ELSE(4.f, 3.5f) * g.k));
  GRect rect = GRect(iround(edge.x) - ri, iround(edge.y) - ri, 2 * ri, 2 * ri);
  graphics_context_set_fill_color(ctx, c);
  float a0 = rot - 90.f;
  while (a0 < 0) a0 += 360.f;
  graphics_fill_radial(ctx, rect, GOvalScaleModeFitCircle, ri, DEG_TO_TRIGANGLE(a0), DEG_TO_TRIGANGLE(a0 + 180.f));
  float up[] = {-3, 1.6f, 0, -1.6f, 3, 1.6f};
  float down[] = {-3, -1.6f, 0, 1.6f, 3, -1.6f};
  xf_polyline(ctx, &t, rise ? up : down, 3, FMAX(1, iround(1.6f * t.s)), c);
}

// Tapered hand running through the centre into a short tail.
static void hand_poly(GPoint out[7], float ang, float tail, float len, float wb, float wt, float dx, float dy) {
  float cs = fcos(ang), sn = fsin(ang), k = g.k;
  const float rw[7][2] = {{-tail, -wb * 0.35f}, {0, -wb / 2}, {len, -wt / 2}, {len + wt * 0.6f, 0},
                          {len, wt / 2},        {0, wb / 2},  {-tail, wb * 0.35f}};
  for (int i = 0; i < 7; i++) {
    float r = rw[i][0] * k, w = rw[i][1] * k;
    out[i] = gp((Pt){g.cx + dx * k + r * sn + w * cs, g.cy + dy * k - r * cs + w * sn});
  }
}

// ---- face ------------------------------------------------------------------------------------

static void layout(GRect b) {
  g.round = PBL_IF_ROUND_ELSE(true, false);
  g.cx = b.origin.x + b.size.w / 2.f;
  g.cy = b.origin.y + b.size.h / 2.f;
  g.hw = b.size.w / 2.f;
  g.hh = b.size.h / 2.f;
  if (g.round) {
    g.k = b.size.w / 260.f;
  } else {
    g.kx = b.size.w / 144.f;
    g.ky = b.size.h / 168.f;
    g.k = FMIN(g.kx, g.ky);
  }
}

static float hours_since_midnight(const State *s, time_t t) {
  time_t midnight = s->now - (s->tm.tm_hour * 3600 + s->tm.tm_min * 60 + s->tm.tm_sec);
  return (t - midnight) / 3600.f;
}

void face_draw(GContext *ctx, GRect bounds, const State *s) {
  layout(bounds);
  graphics_context_set_antialiased(ctx, true);

  const Settings *st = &s->settings;
  Palette th = st->theme == THEME_TEAL
                   ? (Palette){GColorFromHEX(0x005555), GColorFromHEX(0xFFFFAA), GColorFromHEX(0x55AAAA),
                               GColorBlack, GColorBlack}
                   : (Palette){GColorBlack, GColorWhite, C_DARK_GREY, C_DARK_GREY, GColorBlack};
  GColor accent = (GColor){.argb = st->accent};

  graphics_context_set_fill_color(ctx, th.dial);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  float now = s->tm.tm_hour + s->tm.tm_min / 60.f;
  float h_ang = (now - 12.f * (int)(now / 12.f)) * 30.f;
  float m_ang = s->tm.tm_min * 6.f;
#define CLEAR(a) FMIN(ang_dist((a), h_ang), ang_dist((a), m_ang))

  const Event *next = NULL;
  float next_s = 0;
  for (int i = 0; i < s->n_events && !next; i++) {
    float es = hours_since_midnight(s, s->events[i].start);
    if (es >= now && es < now + 12.f) {
      next = &s->events[i];
      next_s = es;
    }
  }

  // Progress line from now to the next event, starting at a chevron.
  float a_now = now * 30.f, a_next = next_s * 30.f;
  bool sweep = next && a_next - a_now > 5.f;
  if (sweep) {
    float lead = PBL_IF_ROUND_ELSE(3.5f, 2.5f);
    // Runs into the next-event triangle, whose tip sits on this line on rectangular screens.
    fill_band(ctx, SWEEP_OUTER, SWEEP_INNER, a_now + lead, a_next, C_GREY, 0);
  }

  ticks(ctx, PBL_IF_ROUND_ELSE(8, 3.5f), PBL_IF_ROUND_ELSE(1, -1), 1, th.min_tick, is_minute);
  ticks(ctx, PBL_IF_ROUND_ELSE(19, 9), PBL_IF_ROUND_ELSE(1, -1), px(PBL_IF_ROUND_ELSE(2.5f, 2.f)), th.tick, is_hour);
  ticks(ctx, PBL_IF_ROUND_ELSE(27, 14), PBL_IF_ROUND_ELSE(1, -1), px(PBL_IF_ROUND_ELSE(4.5f, 3.5f)), th.tick, is_quarter);

  // Calendar: the next 12 hours shaded round the ring, over the ticks.
  for (int i = 0; i < s->n_events; i++) {
    const Event *e = &s->events[i];
    float s0 = FMAX(hours_since_midnight(s, e->start), now), e0 = FMIN(hours_since_midnight(s, e->end), now + 12.f);
    if (e0 > s0) {
      float a = s0 * 30.f, b = FMAX(a + 1.f, e0 * 30.f - 1.f);
      fill_band(ctx, PBL_IF_ROUND_ELSE(1, -1), PBL_IF_ROUND_ELSE(11, 6), a, b, (GColor){.argb = e->color},
                e->tentative ? px(PBL_IF_ROUND_ELSE(2.5f, 1.7f)) : 0);
    }
  }

  if (sweep) {
    // Tip where the sweep starts; the arms reach back anticlockwise along the edge.
    float lead = PBL_IF_ROUND_ELSE(3.5f, 2.5f), back = PBL_IF_ROUND_ELSE(7.5f, 4.f), arm = PBL_IF_ROUND_ELSE(4.75f, 3.f);
    Xf t = edge_xf(PBL_IF_ROUND_ELSE(5.75f, 8.15f), a_now + lead, g.k);
    Pt c1 = xf(&t, back, -arm), c2 = xf(&t, 0, 0), c3 = xf(&t, back, arm);
    // As wide as the line, which fill_poly's smoothing outline widens by 1px on rectangular screens.
    int wi = px(SWEEP_INNER - SWEEP_OUTER) + PBL_IF_ROUND_ELSE(0, 1), wo = wi + 2;
    line(ctx, c1, c2, wo, th.dial);
    line(ctx, c2, c3, wo, th.dial);
    line(ctx, c1, c2, wi, C_GREY);
    line(ctx, c2, c3, wi, C_GREY);
    // The halo above cuts into the start of the line; redraw it so the line grows out of the tip.
    fill_band(ctx, SWEEP_OUTER, SWEEP_INNER, a_now + lead, FMIN(a_now + lead + 4.f, a_next), C_GREY, 0);
  }

  GColor next_c = next ? (GColor){.argb = next->color} : C_GREY;
  if (next) {
    // Tip kept ~2px inside the event band so it doesn't merge with the band of the same colour.
    float half = PBL_IF_ROUND_ELSE(8.f, 3.5f), depth = PBL_IF_ROUND_ELSE(9.f, 6.f);
    Xf t = edge_xf(PBL_IF_ROUND_ELSE(14, 8), a_next, g.k);
    GPoint tri[3] = {gp(xf(&t, 0, 0)), gp(xf(&t, -half, -depth)), gp(xf(&t, half, -depth))};
    fill_poly(ctx, tri, 3, next_c);
  }

  // Battery ring under the hands: green, amber at 30%, red at 15%.
  Pt centre = {g.cx, g.cy};
  float bat_r = PBL_IF_ROUND_ELSE(27, 17) * g.k;
  int bat_w = px(PBL_IF_ROUND_ELSE(4, 3));
  GColor bat_c = s->battery <= 15 ? C_RED : s->battery <= 30 ? C_AMBER : C_GREEN;
  fill_disc_ring(ctx, centre, bat_r + bat_w / 2.f, bat_w, 0, 360, th.track);
  if (s->battery > 0) fill_disc_ring(ctx, centre, bat_r + bat_w / 2.f, bat_w, 0, s->battery * 3.6f, bat_c);

  // Dodge: date and next-event card take the clearest of 8 slots, at least 90deg apart.
  float best_a = 0, best_s = -1, second_a = 0, second_s = -1;
  for (int i = 0; i < 8; i++) {
    float a = i * 45.f, sc = CLEAR(a) + (i % 2 == 0 ? 8.f : 0.f);
    if (sc > best_s) { best_s = sc; best_a = a; }
  }
  for (int i = 0; i < 8; i++) {
    float a = i * 45.f, sc = CLEAR(a) + (i % 2 == 0 ? 8.f : 0.f);
    if (ang_dist(a, best_a) >= 90.f && sc > second_s) { second_s = sc; second_a = a; }
  }

  static const char *const WEEKDAYS[] = {"SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"};
  char day_buf[4];
  snprintf(day_buf, sizeof(day_buf), "%d", s->tm.tm_mday);
  {
    Pt d = slot(66, best_a);
    float gap = 1.f;
    float h = s_weekday.em + gap + s_day.em;
    float top = d.y - h / 2.f;
    text_tracked(ctx, WEEKDAYS[s->tm.tm_wday], &s_weekday, accent, d.x, top + BASELINE_EM * s_weekday.em, 80,
                 PBL_IF_ROUND_ELSE(2, 1));
    text(ctx, day_buf, &s_day, GColorWhite, d.x, top + s_weekday.em + gap + BASELINE_EM * s_day.em, 60);
  }

  char when[8] = "", in_buf[16] = "", short_buf[12] = "";
  if (next) {
    time_t t = next->start;
    struct tm *lt = localtime(&t);
    strftime(when, sizeof(when), clock_is_24h_style() ? "%H:%M" : "%I:%M", lt);
    if (!clock_is_24h_style() && when[0] == '0') memmove(when, when + 1, strlen(when));
    int dm = (int)((next->start - s->now + 30) / 60);
    if (dm < 0) dm = 0;
    if (dm < 60) {
      snprintf(in_buf, sizeof(in_buf), "in %dm", dm);
      snprintf(short_buf, sizeof(short_buf), "%dm", dm);
    } else {
      snprintf(in_buf, sizeof(in_buf), "in %dh %dm", dm / 60, dm % 60);
      snprintf(short_buf, sizeof(short_buf), "%dh%02d", dm / 60, dm % 60);
    }

    Pt c = slot(68, second_a);
    bool in_card = st->countdown_at == COUNTDOWN_CARD;
    int max_w = PBL_IF_ROUND_ELSE(iround(90 * g.k), iround(64 * g.kx));
    // Without the countdown line the title may wrap onto a second line.
    char title1[TITLE_LEN];
    const char *title2 = NULL;
    if (in_card) {
      strncpy(title1, next->title, TITLE_LEN);
    } else {
      wrap(next->title, &s_label, max_w, title1, sizeof(title1), &title2);
    }
    float bar_h = 3.f, bar_gap = PBL_IF_ROUND_ELSE(3.f, 2.f), gap = 1.f;
    float h = bar_h + bar_gap + s_time.em + (in_card || title2 ? gap + s_label.em : 0) + gap + s_label.em;
    float y = c.y - h / 2.f;
    int bar_w = PBL_IF_ROUND_ELSE(iround(41 * g.k), iround(24 * g.k));
    graphics_context_set_fill_color(ctx, next_c);
    graphics_fill_rect(ctx, GRect(iround(c.x) - bar_w / 2, iround(y), bar_w, iround(bar_h)), 1, GCornersAll);
    y += bar_h + bar_gap;
    text(ctx, when, &s_time, GColorWhite, c.x, y + BASELINE_EM * s_time.em, 80);
    y += s_time.em;
    if (in_card) {
      y += gap;
      text(ctx, in_buf, &s_label, C_GREY, c.x, y + BASELINE_EM * s_label.em, max_w);
      y += s_label.em;
    }
    y += gap;
    text(ctx, title1, &s_label, C_GREY, c.x, y + BASELINE_EM * s_label.em, max_w);
    if (title2) {
      y += s_label.em + gap;
      text(ctx, title2, &s_label, C_GREY, c.x, y + BASELINE_EM * s_label.em, max_w);
    }

    if (st->countdown_at == COUNTDOWN_START || st->countdown_at == COUNTDOWN_END) {
      bool at_end = st->countdown_at == COUNTDOWN_END;
      float deg = at_end ? a_next - 11.f : a_now + 9.f;
      Pt p = g.round ? polar(at_end ? 101 : 104, deg) : ring(24, deg);
      text(ctx, short_buf, &s_countdown, at_end ? GColorWhite : C_GREY, p.x,
           p.y + (CAP_EM / 2.f) * s_countdown.em, 60);
    }
  }

  // Status icons: beside the date on round screens; fixed in the top corners on rectangular ones,
  // where the hands never reach.
  if (g.round) {
    int n = (!s->bt_connected) + s->quiet;
    float off = n == 2 ? 8.f : 0.f;
    if (!s->bt_connected) draw_bt_off(ctx, polar(95, best_a - off), 0.83f * g.k, th.dial);
    if (s->quiet) draw_mouse(ctx, polar(95, best_a + (s->bt_connected ? 0 : off)), 0.89f * g.k);
  } else {
    if (!s->bt_connected) draw_bt_off(ctx, (Pt){13 * g.kx, 15 * g.ky}, 0.7f * g.k, th.dial);
    if (s->quiet) draw_mouse(ctx, (Pt){bounds.size.w - 13 * g.kx, 15 * g.ky}, 0.7f * g.k);
  }

  // Battery number orbits inside the ring, away from both hands and their tails.
  {
    float best = 0, bs = -1;
    for (int a = 0; a < 360; a += 5) {
      float sc = FMIN(CLEAR(a), FMIN(ang_dist(a, h_ang + 180.f), ang_dist(a, m_ang + 180.f)));
      if (sc > bs) { bs = sc; best = a; }
    }
    char buf[4];
    snprintf(buf, sizeof(buf), "%d", s->battery);
    // Three digits are wider than the gap between the centre pin and the ring.
    float r = PBL_IF_ROUND_ELSE(15, 9.5f) + (s->battery >= 100 ? PBL_IF_ROUND_ELSE(3, 2) : 0);
    Pt p = polar(r, best);
    text(ctx, buf, &s_num, GColorWhite, p.x, p.y + (CAP_EM / 2.f) * s_num.em, 30);
  }

  // Hands with solid shadows; the minute hand's falls further to suggest it sits higher.
  GPoint hp[7];
  float hr_len = PBL_IF_ROUND_ELSE(66, 42), mn_len = PBL_IF_ROUND_ELSE(108, 64);
  if (!g.round && st->hand_stretch) {
    mn_len = ring_dist(0, m_ang, NULL) / g.k - 11.f;
    hr_len = (ring_dist(0, h_ang, NULL) / g.k - 11.f) * 0.64f;
  }
  float hr_tail = PBL_IF_ROUND_ELSE(17, 11), hr_wb = PBL_IF_ROUND_ELSE(9, 6.5f), hr_wt = PBL_IF_ROUND_ELSE(5, 3.6f);
  float mn_tail = PBL_IF_ROUND_ELSE(23, 15), mn_wb = PBL_IF_ROUND_ELSE(7, 5), mn_wt = PBL_IF_ROUND_ELSE(3.4f, 2.5f);
  float hs_dx = PBL_IF_ROUND_ELSE(1.6f, 1.1f), hs_dy = PBL_IF_ROUND_ELSE(2.2f, 1.5f);
  float hr_pin = PBL_IF_ROUND_ELSE(8, 5.6f), mn_pin = PBL_IF_ROUND_ELSE(5.6f, 3.9f), cap = PBL_IF_ROUND_ELSE(2.4f, 1.7f);

  hand_poly(hp, h_ang, hr_tail, hr_len, hr_wb, hr_wt, hs_dx, hs_dy);
  fill_poly(ctx, hp, 7, th.shadow);
  disc(ctx, (Pt){g.cx + hs_dx * g.k, g.cy + hs_dy * g.k}, hr_pin * g.k, th.shadow);
  hand_poly(hp, h_ang, hr_tail, hr_len, hr_wb, hr_wt, 0, 0);
  fill_poly(ctx, hp, 7, GColorWhite);
  disc(ctx, centre, hr_pin * g.k, GColorWhite);

  hand_poly(hp, m_ang, mn_tail, mn_len, mn_wb, mn_wt, 2 * hs_dx, 2 * hs_dy);
  fill_poly(ctx, hp, 7, th.shadow);
  // Grey pin shadows dither into noise on black-and-white screens.
  GColor pin_shadow = PBL_IF_COLOR_ELSE(C_GREY, th.shadow);
  disc(ctx, (Pt){g.cx + 0.875f * hs_dx * g.k, g.cy + 0.865f * hs_dy * g.k}, mn_pin * g.k, pin_shadow);
  hand_poly(hp, m_ang, mn_tail, mn_len, mn_wb, mn_wt, 0, 0);
  fill_poly(ctx, hp, 7, GColorWhite);
  disc(ctx, centre, mn_pin * g.k, GColorWhite);
  disc(ctx, (Pt){g.cx + 0.6f * g.k, g.cy + 0.8f * g.k}, cap * g.k, pin_shadow);
  disc(ctx, centre, cap * g.k, accent);

  // Sunrise and sunset sit on top of everything.
  draw_sun(ctx, s->sunrise_min, true);
  draw_sun(ctx, s->sunset_min, false);
#undef CLEAR
}

#ifdef PBL_COLOR
#define LOAD(name, em, baseline) ((Font){aafont_load(RESOURCE_ID_AA_##name), em})
#else
#define LOAD(name, em, baseline) \
  ((Font){fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_##name)), baseline, em})
#endif

void face_init(void) {
#if PBL_DISPLAY_WIDTH >= 200
  s_weekday = LOAD(WEEKDAY_14, 14, 13);
  s_day = LOAD(DAY_28, 28, 26);
  s_time = LOAD(TIME_22, 22, 20);
  s_countdown = LOAD(NUM_14, 14, 13);
#else
  s_weekday = LOAD(LABEL_12, 12, 11);
  s_day = LOAD(DAY_21, 21, 19);
  s_time = LOAD(TIME_17, 17, 15);
  s_countdown = LOAD(NUM_12, 12, 11);
#endif
#if PBL_DISPLAY_WIDTH >= 200 && defined(PBL_COLOR)
  s_label = LOAD(LABEL_13, 13, 12);
#else
  s_label = LOAD(LABEL_12, 12, 11);
#endif
  s_num = LOAD(NUM_12, 12, 11);
}

void face_deinit(void) {
  Font *all[] = {&s_weekday, &s_day, &s_time, &s_countdown, &s_label, &s_num};
  for (unsigned i = 0; i < ARRAY_LENGTH(all); i++) {
#ifdef PBL_COLOR
    aafont_destroy(all[i]->aa);
#else
    fonts_unload_custom_font(all[i]->font);
#endif
  }
}
