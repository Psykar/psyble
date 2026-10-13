#include "aafont.h"

#ifdef PBL_COLOR

#define HEADER_SIZE 4
#define GLYPH_SIZE 11
#define ELLIPSIS 0x2026

struct AAFont {
  uint8_t *blob;
  uint16_t count;
  const uint8_t *glyphs;
  const uint8_t *data;
};

typedef struct {
  uint8_t advance, w, h;
  int8_t left, top;
  const uint8_t *bits;
} Glyph;

static uint16_t rd16(const uint8_t *p) { return p[0] | (p[1] << 8); }
static uint32_t rd32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }

AAFont *aafont_load(uint32_t resource_id) {
  ResHandle h = resource_get_handle(resource_id);
  size_t size = resource_size(h);
  AAFont *f = malloc(sizeof(AAFont));
  f->blob = malloc(size);
  resource_load(h, f->blob, size);
  f->count = rd16(f->blob + 2);
  f->glyphs = f->blob + HEADER_SIZE;
  f->data = f->glyphs + f->count * GLYPH_SIZE;
  return f;
}

void aafont_destroy(AAFont *f) {
  if (!f) return;
  free(f->blob);
  free(f);
}

static bool find(const AAFont *f, uint16_t cp, Glyph *out) {
  int lo = 0, hi = f->count - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    const uint8_t *g = f->glyphs + mid * GLYPH_SIZE;
    uint16_t c = rd16(g);
    if (c == cp) {
      *out = (Glyph){g[2], g[3], g[4], (int8_t)g[5], (int8_t)g[6], f->data + rd32(g + 7)};
      return true;
    }
    if (c < cp) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

// Decodes one codepoint (up to 3 bytes, enough for Latin-1 and the ellipsis) and advances *s.
static uint16_t next_cp(const char **s) {
  const uint8_t *p = (const uint8_t *)*s;
  uint16_t cp;
  if (p[0] < 0x80) { cp = p[0]; *s += 1; }
  else if ((p[0] & 0xE0) == 0xC0 && p[1]) { cp = ((p[0] & 0x1F) << 6) | (p[1] & 0x3F); *s += 2; }
  else if ((p[0] & 0xF0) == 0xE0 && p[1] && p[2]) {
    cp = ((p[0] & 0x0F) << 12) | ((p[1] & 0x3F) << 6) | (p[2] & 0x3F);
    *s += 3;
  } else { cp = '?'; *s += 1; while ((**s & 0xC0) == 0x80) *s += 1; }
  return cp;
}

static int glyph_advance(const AAFont *f, uint16_t cp) {
  Glyph g;
  if (find(f, cp, &g) || find(f, '?', &g)) return g.advance;
  return 0;
}

int aafont_width(const AAFont *f, const char *str, int spacing) {
  int w = 0, n = 0;
  while (*str) {
    w += glyph_advance(f, next_cp(&str));
    n++;
  }
  return n ? w + spacing * (n - 1) : 0;
}

static uint8_t mix(uint8_t bg, uint8_t fg, uint8_t level) {
  return (bg * (3 - level) + fg * level + 1) / 3;
}

static void blit(GBitmap *fb, const Glyph *g, GColor color, int x0, int y0) {
  GRect bounds = gbitmap_get_bounds(fb);
  for (int y = 0; y < g->h; y++) {
    int py = y0 + y;
    if (py < 0 || py >= bounds.size.h) continue;
    GBitmapDataRowInfo row = gbitmap_get_data_row_info(fb, py);
    for (int x = 0; x < g->w; x++) {
      int i = y * g->w + x;
      uint8_t level = (g->bits[i >> 2] >> (6 - 2 * (i & 3))) & 3;
      int px = x0 + x;
      if (!level || px < row.min_x || px > row.max_x) continue;
      GColor bg = (GColor){.argb = row.data[px]};
      GColor out = {.a = 3,
                    .r = mix(bg.r, color.r, level),
                    .g = mix(bg.g, color.g, level),
                    .b = mix(bg.b, color.b, level)};
      row.data[px] = out.argb;
    }
  }
}

void aafont_draw(GContext *ctx, const AAFont *f, const char *str, GColor color, int x, int baseline,
                 int spacing, int max_w) {
  int ellipsis_at = -1;  // byte offset after which to stop and draw an ellipsis
  if (aafont_width(f, str, spacing) > max_w) {
    int budget = max_w - glyph_advance(f, ELLIPSIS), w = 0;
    const char *s = str;
    while (*s) {
      const char *before = s;
      int adv = glyph_advance(f, next_cp(&s)) + spacing;
      if (w + adv > budget) { ellipsis_at = before - str; break; }
      w += adv;
    }
  }

  GBitmap *fb = graphics_capture_frame_buffer(ctx);
  if (!fb) return;
  const char *s = str;
  while (*s) {
    uint16_t cp = (ellipsis_at >= 0 && s - str >= ellipsis_at) ? ELLIPSIS : next_cp(&s);
    Glyph g;
    if (find(f, cp, &g) || find(f, '?', &g)) {
      blit(fb, &g, color, x + g.left, baseline - g.top);
      x += g.advance + spacing;
    }
    if (cp == ELLIPSIS) break;
  }
  graphics_release_frame_buffer(ctx, fb);
}

#endif
