// Runs inside the settings page (Clay serialises this function into it), so it can't use
// anything from the surrounding module, and must stay ES5 for older phone web views. The glyph
// files arrive as clay.meta.userData.fonts (see index.js).
module.exports = function () {
  var clay = this;

  // Screen appearance of each colour, indexed r*16 + g*4 + b in levels 0-3.
  var LCD = [
      0x000000, 0x001E41, 0x004387, 0x0068CA, 0x2B4A2C, 0x27514F, 0x16638D, 0x007DCE,
      0x5E9860, 0x5C9B72, 0x57A5A2, 0x4CB4DB, 0x8EE391, 0x8EE69E, 0x8AEBC0, 0x84F5F1,
      0x4A161B, 0x482748, 0x40488A, 0x2F6BCC, 0x564E36, 0x545454, 0x4F6790, 0x4180D0,
      0x759A64, 0x759D76, 0x71A6A4, 0x69B5DD, 0x9EE594, 0x9DE7A0, 0x9BECC2, 0x95F6F2,
      0x99353F, 0x983E5A, 0x955694, 0x8F74D2, 0x9D5B4D, 0x9D6064, 0x9A7099, 0x9587D5,
      0xAFA072, 0xAEA382, 0xABABAB, 0xA7BAE2, 0xC9E89D, 0xC9EAA7, 0xC7F0C8, 0xC3F9F7,
      0xE35462, 0xE25874, 0xE16AA3, 0xDE83DC, 0xE66E6B, 0xE6727C, 0xE37FA7, 0xE194DF,
      0xF1AA86, 0xF1AD93, 0xEFB5B8, 0xECC3EB, 0xFFEEAB, 0xFFF1B5, 0xFFF6D3, 0xFFFFFF
  ];
  // ---- Glyphs: a port of src/c/aafont.c (same files, same 2-bit blending) ----
  var fontCache = {};
  function font(name, em) {
    if (!fontCache[name]) {
      var b64 = ((clay.meta && clay.meta.userData && clay.meta.userData.fonts) || {})[name];
      if (!b64) return null;
      var bin = atob(b64), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var count = u[2] | (u[3] << 8);
      fontCache[name] = { u: u, count: count, data: 4 + count * 11 };
    }
    return { f: fontCache[name], em: em };
  }
  function glyph(f, cp) {
    var u = f.u, lo = 0, hi = f.count - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1, o = 4 + mid * 11, c = u[o] | (u[o + 1] << 8);
      if (c === cp) {
        return { adv: u[o + 2], w: u[o + 3], h: u[o + 4], left: (u[o + 5] << 24) >> 24, top: (u[o + 6] << 24) >> 24,
          bits: f.data + (u[o + 7] | (u[o + 8] << 8) | (u[o + 9] << 16) | (u[o + 10] << 24)) };
      }
      if (c < cp) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  }
  function anyGlyph(f, cp) { return glyph(f, cp) || glyph(f, 63); }
  function textWidth(str, fnt, spacing) {
    var w = 0;
    for (var i = 0; i < str.length; i++) { var g = anyGlyph(fnt.f, str.charCodeAt(i)); w += g ? g.adv : 0; }
    return str.length ? w + (spacing || 0) * (str.length - 1) : 0;
  }

  function preview() {
    var canvas = document.getElementById('psyble-preview');
    if (!canvas) return;
    var info = clay.meta && clay.meta.activeWatchInfo;
    var platform = (info && info.platform) || 'basalt';
    var round = /chalk|gabbro/.test(platform);
    var size = { chalk: [180, 180], gabbro: [260, 260], emery: [200, 228] }[platform] || [144, 168];
    var SW = size[0], SH = size[1], large = SW >= 200;
    // Drawn at the watch's own resolution, then enlarged by a whole number of device pixels
    // without smoothing, so it shows the watch's pixels rather than a crisper ideal.
    var dpr = window.devicePixelRatio || 1, zoom = Math.max(1, Math.floor(220 * dpr / SW));
    canvas.width = SW;
    canvas.height = SH;
    canvas.style.width = SW * zoom / dpr + 'px';
    canvas.style.height = SH * zoom / dpr + 'px';
    canvas.style.imageRendering = 'pixelated';
    var ctx = canvas.getContext('2d');

    function val(key, dflt) {
      var item = clay.getItemByMessageKey(key);
      var v = item ? item.get() : dflt;
      return v === undefined || v === null || v === '' ? dflt : v;
    }
    function rgb(v) { return typeof v === 'number' ? v : parseInt(String(v).replace(/^(#|0x)/, ''), 16); }
    function hex(n) { return '#' + ('00000' + n.toString(16)).slice(-6); }
    function lv(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) { return Math.round(c / 85); }); }
    function step(n, d) {
      return lv(n).reduce(function (acc, l) { return acc * 256 + Math.max(0, Math.min(3, l + d)) * 85; }, 0);
    }
    function iround(v) { return v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5); }

    // ---- Geometry: as layout(), ring_dist(), ring(), polar(), slot(), edge_xf() in face.c ----
    var cx = SW / 2, cy = SH / 2, hw = SW / 2, hh = SH / 2, kx = SW / 144, ky = SH / 168;
    var k = round ? SW / 260 : Math.min(kx, ky);
    function sin(d) { return Math.sin(d * Math.PI / 180); }
    function cos(d) { return Math.cos(d * Math.PI / 180); }
    function angDist(a, b) { var d = ((a - b) % 360 + 360) % 360; return Math.min(d, 360 - d); }
    function px(u) { return Math.max(1, iround(u * k)); }
    function ringDist(inset, deg) {
      if (round) return { t: (130 - inset) * k, side: 'b' };
      var sx = sin(deg), sy = -cos(deg);
      var ta = Math.abs(sx) > 1e-4 ? (hw - inset * k) / Math.abs(sx) : 1e9;
      var tb = Math.abs(sy) > 1e-4 ? (hh - inset * k) / Math.abs(sy) : 1e9;
      return { t: Math.min(ta, tb), side: ta < tb ? (sx > 0 ? 'r' : 'l') : (sy < 0 ? 't' : 'b') };
    }
    function ring(inset, deg) { var t = ringDist(inset, deg).t; return [cx + t * sin(deg), cy - t * cos(deg)]; }
    function polar(r, deg) { return [cx + r * k * sin(deg), cy - r * k * cos(deg)]; }
    function slot(r, deg) { return round ? polar(r, deg) : [cx + 38 * kx * sin(deg), cy - 47 * ky * cos(deg)]; }
    function gp(p) { return [iround(p[0]), iround(p[1])]; }
    function xf(t, x, y) {
      var c = cos(t.rot), s = sin(t.rot);
      return [t.o[0] + t.s * (x * c - y * s), t.o[1] + t.s * (x * s + y * c)];
    }
    function edgeXf(inset, deg, s) {
      var p = ring(inset, deg), side = ringDist(inset, deg).side;
      var rot = round ? deg - 180 : side === 'b' ? 0 : side === 'l' ? 90 : side === 't' ? 180 : 270;
      return { o: [iround(p[0]), iround(p[1])], s: s, rot: rot };
    }

    // ---- Drawing: Pebble lights the pixel at an integer point, so shapes sit on pixel centres ----
    function P(p) { return [p[0] + 0.5, p[1] + 0.5]; }
    function poly(pts, color) {
      ctx.beginPath();
      pts.forEach(function (p) { var q = P(p); ctx.lineTo(q[0], q[1]); });
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle = hex(color);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.stroke();  // fill_poly's smoothing outline
    }
    function line(a, b, w, color) {
      var p = P(gp(a)), q = P(gp(b));
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
      ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.strokeStyle = hex(color); ctx.stroke();
    }
    function disc(c, r, color) {
      var p = P(gp(c));
      ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1, iround(r)), 0, 2 * Math.PI);
      ctx.fillStyle = hex(color); ctx.fill();
    }
    // graphics_fill_radial: an annulus r px out, `thick` px deep, round the centre (x, y).
    function radial(x, y, r, thick, a, b, color) {
      ctx.beginPath();
      ctx.arc(x, y, r, (a - 90) * Math.PI / 180, (b - 90) * Math.PI / 180);
      ctx.arc(x, y, Math.max(0, r - thick), (b - 90) * Math.PI / 180, (a - 90) * Math.PI / 180, true);
      ctx.closePath(); ctx.fillStyle = hex(color); ctx.fill();
    }
    function band(outer, inner, a, b, color, outlineW) {
      if (b <= a) return;
      if (round) {
        var r = iround((130 - outer) * k), thick = Math.max(1, iround((inner - outer) * k));
        var ox = iround(cx), oy = iround(cy);
        if (!outlineW) { radial(ox, oy, r, thick, a, b, color); return; }
        radial(ox, oy, r, outlineW, a, b, color);
        radial(ox, oy, r - thick + outlineW, outlineW, a, b, color);
        line(polar(130 - outer, a), polar(130 - inner, a), outlineW, color);
        line(polar(130 - outer, b), polar(130 - inner, b), outlineW, color);
        return;
      }
      var half = (outlineW || 0) / 2 / k;
      outer += half; inner -= half;
      var n = Math.max(2, Math.min(240, Math.floor((b - a) / 1.5) + 1)), pts = [], i;
      for (i = 0; i <= n; i++) pts[i] = gp(ring(outer, a + (b - a) * i / n));
      for (i = 0; i <= n; i++) pts[2 * n + 1 - i] = gp(ring(inner, a + (b - a) * i / n));
      if (!outlineW) { poly(pts, color); return; }
      for (i = 0; i < pts.length; i++) line(pts[i], pts[(i + 1) % pts.length], outlineW, color);
    }

    // ---- Settings and sample data ----
    var dial = rgb(val('DIAL', 0x000055)), L = lv(dial);
    var grey = L[0] === L[1] && L[1] === L[2];
    var tick = val('TICK_AUTO', true) ? (grey ? 0xFFFFFF : 0xFFFFAA) : rgb(val('TICK', 0xFFFFAA));
    var minTick = step(dial, 1), track = (L[0] | L[1] | L[2]) ? step(dial, -1) : step(dial, 1);
    var accent = rgb(val('ACCENT', 0xFFAA00));
    var cal = [rgb(val('CAL_COLOR[0]', 0x00AAFF)), rgb(val('CAL_COLOR[1]', 0x55AA55)), rgb(val('CAL_COLOR[2]', 0xFF5500))];
    var stretch = !round && val('HAND_REACH', false);
    var countdownAt = parseInt(val('COUNTDOWN_AT', '0'), 10);
    var GREY = 0xAAAAAA, battery = 72;
    var now = 10 + 9 / 60, hAng = now * 30, mAng = 9 * 6;
    var events = [
      { s: 13, e: 14, c: cal[0], t: 'Quarterly design review' },
      { s: 16, e: 17, c: cal[1] },
      { s: 19, e: 19.5, c: cal[2], tentative: true }
    ];
    var F = large
      ? { weekday: font('WEEKDAY_14', 14), day: font('DAY_28', 28), time: font('TIME_22', 22),
        countdown: font('NUM_14', 14), label: font('LABEL_13', 13), num: font('NUM_12', 12) }
      : { weekday: font('LABEL_12', 12), day: font('DAY_21', 21), time: font('TIME_17', 17),
        countdown: font('NUM_12', 12), label: font('LABEL_12', 12), num: font('NUM_12', 12) };
    var texts = [];  // blended after the shapes beneath them, as aafont_draw does into the frame buffer
    function text(str, fnt, color, x, baseline, maxW, spacing) {
      if (fnt) texts.push({ s: str, f: fnt, c: color, x: x, y: baseline, w: maxW, sp: spacing || 0 });
    }
    function clear(a) { return Math.min(angDist(a, hAng), angDist(a, mAng)); }

    // ---- face_draw(), in its order ----
    ctx.fillStyle = hex(dial);
    ctx.fillRect(0, 0, SW, SH);
    var next = events[0], aNow = now * 30, aNext = next.s * 30;
    var sweepO = round ? 4.75 : 2.5, sweepI = round ? 6.75 : 3.5, lead = round ? 3.5 : 2.5;
    band(sweepO, sweepI, aNow + lead, aNext, GREY, 0);
    var edge = round ? 1 : -1;
    for (var i = 0; i < 60; i++) {
      if (i % 5) line(ring(round ? 8 : 3.5, i * 6), ring(edge, i * 6), 1, minTick);
    }
    for (i = 0; i < 60; i++) {
      if (i % 5 === 0 && i % 15) line(ring(round ? 19 : 9, i * 6), ring(edge, i * 6), px(round ? 2.5 : 2), tick);
    }
    for (i = 0; i < 60; i += 15) line(ring(round ? 27 : 14, i * 6), ring(edge, i * 6), px(round ? 4.5 : 3.5), tick);
    events.forEach(function (e) {
      var a = Math.max(e.s, now) * 30, b = Math.max(a + 1, Math.min(e.e, now + 12) * 30 - 1);
      band(round ? 1 : -1, round ? 11 : 6, a, b, e.c, e.tentative ? px(round ? 2.5 : 1.7) : 0);
    });
    var t = edgeXf((sweepO + sweepI) / 2, aNow + lead, k);
    var back = round ? 7.5 : 4, arm = round ? 4.75 : 3;
    var c1 = xf(t, back, -arm), c2 = xf(t, 0, 0), c3 = xf(t, back, arm);
    var wi = px(sweepI - sweepO) + (round ? 0 : 1), wo = wi + 2;
    line(c1, c2, wo, dial); line(c2, c3, wo, dial); line(c1, c2, wi, GREY); line(c2, c3, wi, GREY);
    band(sweepO, sweepI, aNow + lead, Math.min(aNow + lead + 4, aNext), GREY, 0);
    t = edgeXf(round ? 14 : 8, aNext, k);
    var half = round ? 8 : 3.5, depth = round ? 9 : 6;
    poly([gp(xf(t, 0, 0)), gp(xf(t, -half, -depth)), gp(xf(t, half, -depth))], next.c);

    var batR = (round ? 27 : 17) * k, batW = px(round ? 4 : 3), batRo = iround(batR + batW / 2);
    radial(iround(cx), iround(cy), batRo, batW, 0, 360, track);
    radial(iround(cx), iround(cy), batRo, batW, 0, battery * 3.6, battery <= 15 ? 0xFF5555 : battery <= 30 ? 0xFFAA00 : 0x55AA55);

    var bestA = 0, bestS = -1e9, secondA = 0, secondS = -1e9, a, sc;
    for (i = 0; i < 8; i++) { a = i * 45; sc = clear(a) + (i % 2 ? 0 : 8); if (sc > bestS) { bestS = sc; bestA = a; } }
    for (i = 0; i < 8; i++) {
      a = i * 45; sc = clear(a) + (i % 2 ? 0 : 8);
      if (angDist(a, bestA) >= 90 && sc > secondS) { secondS = sc; secondA = a; }
    }
    var today = new Date(), d = slot(66, bestA), dh = F.weekday.em + 1 + F.day.em, top = d[1] - dh / 2;
    text(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][today.getDay()], F.weekday, accent, d[0],
      top + 0.9 * F.weekday.em, 80, round ? 2 : 1);
    text(String(today.getDate()), F.day, 0xFFFFFF, d[0], top + F.weekday.em + 1 + 0.9 * F.day.em, 60);

    var c = slot(68, secondA), inCard = countdownAt === 0;
    var maxW = round ? iround(90 * k) : iround(64 * kx), title1 = next.t, title2 = null;
    if (!inCard && textWidth(title1, F.label) > maxW) {
      var cut = 0;
      for (i = 1; i < next.t.length; i++) {
        if (textWidth(next.t.slice(0, i), F.label) > maxW) break;
        if (next.t[i] === ' ') cut = i;
      }
      cut = cut || i - 1;
      title1 = next.t.slice(0, cut);
      title2 = next.t.slice(cut).replace(/^ /, '');
    }
    var barH = 3, barGap = round ? 3 : 2, gap = 1;
    var h = barH + barGap + F.time.em + (inCard || title2 ? gap + F.label.em : 0) + gap + F.label.em;
    var y = c[1] - h / 2, barW = iround((round ? 41 : 24) * k);
    ctx.fillStyle = hex(next.c);
    ctx.fillRect(iround(c[0]) - (barW >> 1), iround(y), barW, iround(barH));
    y += barH + barGap;
    text('13:00', F.time, 0xFFFFFF, c[0], y + 0.9 * F.time.em, 80);
    y += F.time.em;
    if (inCard) { y += gap; text('in 2h 51m', F.label, GREY, c[0], y + 0.9 * F.label.em, maxW); y += F.label.em; }
    y += gap;
    text(title1, F.label, GREY, c[0], y + 0.9 * F.label.em, maxW);
    if (title2) { y += F.label.em + gap; text(title2, F.label, GREY, c[0], y + 0.9 * F.label.em, maxW); }
    if (countdownAt === 1 || countdownAt === 2) {
      var atEnd = countdownAt === 2, deg = atEnd ? aNext - 11 : aNow + 9;
      var p = round ? polar(atEnd ? 101 : 104, deg) : ring(24, deg);
      text('2h51', F.countdown, atEnd ? 0xFFFFFF : GREY, p[0], p[1] + 0.35 * F.countdown.em, 60);
    }
    var best = 0, bs = -1;
    for (a = 0; a < 360; a += 5) {
      sc = Math.min(clear(a), Math.min(angDist(a, hAng + 180), angDist(a, mAng + 180)));
      if (sc > bs) { bs = sc; best = a; }
    }
    var bp = polar(round ? 15 : 9.5, best);
    text(String(battery), F.num, 0xFFFFFF, bp[0], bp[1] + 0.35 * F.num.em, 30);

    // Blend the text in the watch's 2-bit-per-channel colour space, as aafont.c's mix() does.
    var img = ctx.getImageData(0, 0, SW, SH), D = img.data;
    for (i = 0; i < D.length; i += 4) { D[i] = Math.round(D[i] / 85) * 85; D[i + 1] = Math.round(D[i + 1] / 85) * 85; D[i + 2] = Math.round(D[i + 2] / 85) * 85; }
    texts.forEach(function (tx) {
      var f = tx.f.f, s = tx.s, sp = tx.sp, fg = lv(tx.c), w = textWidth(s, tx.f, sp), cutAt = -1;
      if (w > tx.w) {
        var el = anyGlyph(f, 0x2026), budget = tx.w - (el ? el.adv : 0), acc = 0;
        for (var j = 0; j < s.length; j++) {
          var adv = anyGlyph(f, s.charCodeAt(j)).adv + sp;
          if (acc + adv > budget) { cutAt = j; break; }
          acc += adv;
        }
        w = tx.w;
      }
      var x = iround(tx.x - w / 2), base = iround(tx.y);
      for (j = 0; j < s.length; j++) {
        var ellipsis = cutAt >= 0 && j >= cutAt, g = anyGlyph(f, ellipsis ? 0x2026 : s.charCodeAt(j));
        if (!g) continue;
        for (var gy = 0; gy < g.h; gy++) {
          for (var gx = 0; gx < g.w; gx++) {
            var bi = gy * g.w + gx, level = (f.u[g.bits + (bi >> 2)] >> (6 - 2 * (bi & 3))) & 3;
            var X = x + g.left + gx, Y = base - g.top + gy;
            if (!level || X < 0 || Y < 0 || X >= SW || Y >= SH) continue;
            var o = (Y * SW + X) * 4;
            for (var ch = 0; ch < 3; ch++) D[o + ch] = Math.floor(((D[o + ch] / 85) * (3 - level) + fg[ch] * level + 1) / 3) * 85;
          }
        }
        x += g.adv + sp;
        if (ellipsis) break;
      }
    });
    ctx.putImageData(img, 0, 0);

    // Hands, centre cap and sun markers go over the text.
    var hr = round ? [66, 17, 9, 5] : [42, 11, 6.5, 3.6], mn = round ? [108, 23, 7, 3.4] : [64, 15, 5, 2.5];
    if (stretch) { mn[0] = ringDist(0, mAng).t / k - 11; hr[0] = (ringDist(0, hAng).t / k - 11) * 0.64; }
    var sdx = round ? 1.6 : 1.1, sdy = round ? 2.2 : 1.5;
    function hand(ang, v, dx, dy, color) {
      var cs = cos(ang), sn = sin(ang), len = v[0], tail = v[1], wb = v[2], wt = v[3];
      var rw = [[-tail, -wb * 0.15], [0, -wb / 2], [len, -wt / 2], [len + wt * 0.6, 0], [len, wt / 2], [0, wb / 2], [-tail, wb * 0.15]];
      poly(rw.map(function (q) {
        var r = q[0] * k, w = q[1] * k;
        return gp([cx + dx * k + r * sn + w * cs, cy + dy * k - r * cs + w * sn]);
      }), color);
    }
    var centre = [cx, cy];
    hand(hAng, hr, sdx, sdy, 0); disc([cx + sdx * k, cy + sdy * k], (round ? 8 : 5.6) * k, 0);
    hand(hAng, hr, 0, 0, 0xFFFFFF); disc(centre, (round ? 8 : 5.6) * k, 0xFFFFFF);
    hand(mAng, mn, 2 * sdx, 2 * sdy, 0);
    disc([cx + 0.875 * sdx * k, cy + 0.865 * sdy * k], (round ? 5.6 : 3.9) * k, GREY);
    hand(mAng, mn, 0, 0, 0xFFFFFF); disc(centre, (round ? 5.6 : 3.9) * k, 0xFFFFFF);
    var cap = round ? 2.4 : 1.7;
    disc([cx + 0.6 * k, cy + 0.8 * k], cap * k, GREY);
    disc(centre, cap * k, accent);
    [[6 * 60 + 31, true], [19 * 60 + 43, false]].forEach(function (sun) {
      var sdeg = (sun[0] % 720) / 2, col = sun[1] ? 0xFFFF55 : 0xFFAA55;
      var e = edgeXf(0, sdeg, k), ch = xf(e, 0, -(round ? 15 : 10.5));
      var tt = { o: [iround(ch[0]), iround(ch[1])], s: (round ? 0.89 : 0.6) * k, rot: e.rot };
      var ri = Math.max(2, iround((round ? 4 : 3.5) * k));
      radial(e.o[0], e.o[1], ri, ri, e.rot - 90, e.rot + 90, col);
      var pts = sun[1] ? [-3, 1.6, 0, -1.6, 3, 1.6] : [-3, -1.6, 0, 1.6, 3, -1.6], lw = Math.max(1, iround(1.6 * tt.s));
      line(xf(tt, pts[0], pts[1]), xf(tt, pts[2], pts[3]), lw, col);
      line(xf(tt, pts[2], pts[3]), xf(tt, pts[4], pts[5]), lw, col);
    });

    // Snap to the watch's 64 colours, then map each to how the colour screen shows it (the table
    // pebble-tool's screenshots use), so the preview looks as washed out as the watch.
    // Round screens have no corners: black outside the circle, as in emulator screenshots.
    img = ctx.getImageData(0, 0, SW, SH); D = img.data;
    for (i = 0; i < D.length; i += 4) {
      var pix = i / 4, mx = pix % SW + 0.5 - cx, my = Math.floor(pix / SW) + 0.5 - cy;
      var col = round && mx * mx + my * my > hw * hw ? 0
        : LCD[Math.round(D[i] / 85) * 16 + Math.round(D[i + 1] / 85) * 4 + Math.round(D[i + 2] / 85)];
      D[i] = col >> 16; D[i + 1] = (col >> 8) & 255; D[i + 2] = col & 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  clay.on(clay.EVENTS.AFTER_BUILD, function () {
    var auto = clay.getItemByMessageKey('TICK_AUTO');
    var tick = clay.getItemByMessageKey('TICK');
    function update() {
      if (auto.get()) tick.hide();
      else tick.show();
      preview();
    }
    auto.on('change', update);
    update();
    ['DIAL', 'TICK', 'ACCENT', 'HAND_REACH', 'COUNTDOWN_AT', 'CAL_COLOR[0]', 'CAL_COLOR[1]', 'CAL_COLOR[2]'].forEach(function (key) {
      var item = clay.getItemByMessageKey(key);
      if (item) item.on('change', preview);
    });
  });
};
