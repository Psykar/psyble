// Runs inside the settings page (Clay serialises this function into it), so it can't use
// anything from the surrounding module, and must stay ES5 for older phone web views.
module.exports = function () {
  var clay = this;

  // Preview of the face, redrawn as settings change. A cut-down copy of src/c/face.c: same design
  // units and geometry for the dial, ticks, sample events, line and hands; no battery, sun or card.
  function preview() {
    var canvas = document.getElementById('psyble-preview');
    if (!canvas) return;
    var info = clay.meta && clay.meta.activeWatchInfo;
    var platform = (info && info.platform) || 'basalt';
    var round = /chalk|gabbro/.test(platform);
    var W = round ? 260 : 144, H = round ? 260 : 168, cx = W / 2, cy = H / 2;
    // Drawn at the watch's own resolution, then enlarged by a whole number of device pixels
    // without smoothing, so it shows the watch's pixels rather than a crisper ideal.
    var px = { chalk: [180, 180], gabbro: [260, 260], emery: [200, 228] }[platform] || [144, 168];
    var k = Math.min(px[0] / W, px[1] / H), dpr = window.devicePixelRatio || 1;
    var zoom = Math.max(1, Math.floor(220 * dpr / px[0]));
    canvas.width = px[0];
    canvas.height = px[1];
    canvas.style.width = px[0] * zoom / dpr + 'px';
    canvas.style.height = px[1] * zoom / dpr + 'px';
    canvas.style.imageRendering = 'pixelated';
    var g = canvas.getContext('2d');
    g.setTransform(k, 0, 0, k, (px[0] - W * k) / 2, (px[1] - H * k) / 2);

    function val(key, dflt) {
      var item = clay.getItemByMessageKey(key);
      var v = item ? item.get() : dflt;
      return v === undefined || v === null || v === '' ? dflt : v;
    }
    function rgb(v) { return typeof v === 'number' ? v : parseInt(String(v).replace(/^(#|0x)/, ''), 16); }
    function hex(n) { return '#' + ('00000' + n.toString(16)).slice(-6); }
    function levels(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) { return Math.round(c / 85); }); }
    // Each channel moved d of its 4 levels, as step() in face.c.
    function step(n, d) {
      return levels(n).reduce(function (acc, l) { return acc * 256 + Math.max(0, Math.min(3, l + d)) * 85; }, 0);
    }

    var dial = rgb(val('DIAL', 0x000055)), L = levels(dial);
    var grey = L[0] === L[1] && L[1] === L[2];
    var tick = val('TICK_AUTO', true) ? (grey ? 0xFFFFFF : 0xFFFFAA) : rgb(val('TICK', 0xFFFFAA));
    var accent = rgb(val('ACCENT', 0xFFAA00));
    var cal = [rgb(val('CAL_COLOR[0]', 0x00AAFF)), rgb(val('CAL_COLOR[1]', 0x55AA55)), rgb(val('CAL_COLOR[2]', 0xFF5500))];
    var stretch = !round && val('HAND_REACH', false);

    function rad(d) { return d * Math.PI / 180; }
    function ringDist(inset, deg) {
      if (round) return 130 - inset;
      var sx = Math.abs(Math.sin(rad(deg))), sy = Math.abs(Math.cos(rad(deg)));
      return Math.min(sx > 1e-4 ? (cx - inset) / sx : 1e9, sy > 1e-4 ? (cy - inset) / sy : 1e9);
    }
    function ring(inset, deg) {
      var t = ringDist(inset, deg);
      return [cx + t * Math.sin(rad(deg)), cy - t * Math.cos(rad(deg))];
    }
    function band(outer, inner, a, b, color, outline) {
      g.beginPath();
      for (var d = a; d <= b; d += 1.5) g.lineTo.apply(g, ring(outer, d));
      g.lineTo.apply(g, ring(outer, b));
      for (d = b; d >= a; d -= 1.5) g.lineTo.apply(g, ring(inner, d));
      g.lineTo.apply(g, ring(inner, a));
      g.closePath();
      if (outline) { g.strokeStyle = hex(color); g.lineWidth = 1.7; g.stroke(); } else { g.fillStyle = hex(color); g.fill(); }
    }
    function line(p, q, w, color) {
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]);
      g.lineWidth = w; g.lineCap = 'round'; g.strokeStyle = hex(color); g.stroke();
    }
    function hand(ang, tail, len, wb, wt, dx, dy, color) {
      var c = Math.cos(rad(ang)), s = Math.sin(rad(ang));
      var pts = [[-tail, -wb * 0.15], [0, -wb / 2], [len, -wt / 2], [len + wt * 0.6, 0], [len, wt / 2], [0, wb / 2], [-tail, wb * 0.15]];
      g.beginPath();
      pts.forEach(function (p) { g.lineTo(cx + dx + p[0] * s + p[1] * c, cy + dy - p[0] * c + p[1] * s); });
      g.closePath(); g.fillStyle = hex(color); g.fill();
    }
    function disc(x, y, r, color) { g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = hex(color); g.fill(); }

    // 10:09, with sample events at 1pm (next), 4pm and 7pm (tentative).
    var hAng = 304.5, mAng = 54, now = 10.15 * 30;
    g.fillStyle = hex(dial); g.fillRect(0, 0, W, H);
    var evOut = round ? 1 : -1, evIn = round ? 11 : 6;
    var sweepO = round ? 4.75 : 2.5, sweepI = round ? 6.75 : 3.5;
    band(sweepO, sweepI, now + 2.5, 390, 0xAAAAAA);
    for (var i = 0; i < 60; i++) {
      var a = i * 6, edge = round ? 1 : -1;
      if (i % 5) line(ring(round ? 8 : 3.5, a), ring(edge, a), 1, step(dial, 1));
      else if (i % 15) line(ring(round ? 19 : 9, a), ring(edge, a), round ? 2.5 : 2, tick);
      else line(ring(round ? 27 : 14, a), ring(edge, a), round ? 4.5 : 3.5, tick);
    }
    band(evOut, evIn, 390, 420, cal[0]);
    band(evOut, evIn, 480, 510, cal[1]);
    band(evOut, evIn, 570, 600, cal[2], true);

    var dx = 38, slotX = round ? cx + 66 : cx + dx;
    g.textAlign = 'center';
    g.fillStyle = hex(accent); g.font = 'bold ' + (round ? 14 : 12) + 'px sans-serif';
    g.fillText(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date().getDay()], slotX, cy - (round ? 6 : 5));
    g.fillStyle = '#FFFFFF'; g.font = 'bold ' + (round ? 28 : 21) + 'px sans-serif';
    g.fillText(String(new Date().getDate()), slotX, cy + (round ? 20 : 15));

    var k = round ? 1 : 0;
    var hr = [[42, 66][k], [11, 17][k], [6.5, 9][k], [3.6, 5][k]], mn = [[64, 108][k], [15, 23][k], [5, 7][k], [2.5, 3.4][k]];
    if (stretch) { mn[0] = ringDist(0, mAng) - 11; hr[0] = (ringDist(0, hAng) - 11) * 0.64; }
    var sdx = [1.1, 1.6][k], sdy = [1.5, 2.2][k];
    hand(hAng, hr[1], hr[0], hr[2], hr[3], sdx, sdy, 0);
    hand(hAng, hr[1], hr[0], hr[2], hr[3], 0, 0, 0xFFFFFF);
    disc(cx, cy, [5.6, 8][k], 0xFFFFFF);
    hand(mAng, mn[1], mn[0], mn[2], mn[3], 2 * sdx, 2 * sdy, 0);
    hand(mAng, mn[1], mn[0], mn[2], mn[3], 0, 0, 0xFFFFFF);
    disc(cx, cy, [3.9, 5.6][k], 0xFFFFFF);
    disc(cx, cy, [1.7, 2.4][k], accent);
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
    ['DIAL', 'TICK', 'ACCENT', 'HAND_REACH', 'CAL_COLOR[0]', 'CAL_COLOR[1]', 'CAL_COLOR[2]'].forEach(function (key) {
      var item = clay.getItemByMessageKey(key);
      if (item) item.on('change', preview);
    });
  });
};
