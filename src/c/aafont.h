#pragma once
#include <pebble.h>

// Antialiased text from glyphs pre-rendered by tools/gen_aafonts.py, blended straight into the
// frame buffer. Colour platforms only: 1-bit screens can't show the in-between levels.

typedef struct AAFont AAFont;

AAFont *aafont_load(uint32_t resource_id);
void aafont_destroy(AAFont *font);

// Width in px of `str` (UTF-8) with `spacing` px added between glyphs.
int aafont_width(const AAFont *font, const char *str, int spacing);

// Draws `str` with its left edge at `x` and baseline at `baseline`, blending over whatever is
// already drawn. Text wider than `max_w` is cut short with an ellipsis.
void aafont_draw(GContext *ctx, const AAFont *font, const char *str, GColor color, int x, int baseline,
                 int spacing, int max_w);
