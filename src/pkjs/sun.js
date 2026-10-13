// Sunrise and sunset after the NOAA approximations popularised by suncalc (github.com/mourner/suncalc).
var rad = Math.PI / 180;
var DAY_MS = 86400000;
var J1970 = 2440588;
var J2000 = 2451545;
var J0 = 0.0009;
var OBLIQUITY = rad * 23.4397;

function toDays(date) { return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000; }
function fromJulian(j) { return new Date((j + 0.5 - J1970) * DAY_MS); }
function meanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(M) {
  var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + Math.PI;
}
function transitJ(ds, M, L) { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L); }

// Returns {rise, set} as Dates for the day containing `date`, or null when the sun doesn't
// rise or set (polar day/night).
function sunTimes(date, lat, lng) {
  var lw = rad * -lng;
  var phi = rad * lat;
  var d = toDays(date);
  var n = Math.round(d - J0 - lw / (2 * Math.PI));
  var ds = J0 + lw / (2 * Math.PI) + n;
  var M = meanAnomaly(ds);
  var L = eclipticLongitude(M);
  var dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  var noon = transitJ(ds, M, L);
  var h0 = -0.833 * rad;
  var cosW = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return null;
  var w = Math.acos(cosW);
  var set = transitJ(J0 + (w + lw) / (2 * Math.PI) + n, M, L);
  return { rise: fromJulian(noon - (set - noon)), set: fromJulian(set) };
}

module.exports = { sunTimes: sunTimes };
