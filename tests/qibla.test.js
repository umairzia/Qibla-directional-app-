// Unit tests for the Qibla math and compass helpers. Run: npm test
var test = require('node:test');
var assert = require('node:assert/strict');
var Q = require('../js/qibla.js');

function near(actual, expected, tol, msg) {
  assert.ok(Math.abs(Q.angleDiff(expected, actual)) <= tol,
    (msg || '') + ' expected ' + expected + ' +/- ' + tol + ', got ' + actual);
}

// Independent check: build a local East/North frame with 3D vectors and
// project the direction to the Kaaba onto it.
function vectorBearing(lat, lng) {
  var r = Math.PI / 180;
  function v(la, lo) { return [Math.cos(la * r) * Math.cos(lo * r), Math.cos(la * r) * Math.sin(lo * r), Math.sin(la * r)]; }
  var p = v(lat, lng), k = v(Q.KAABA.lat, Q.KAABA.lng);
  var east = [-Math.sin(lng * r), Math.cos(lng * r), 0];
  var north = [-Math.sin(lat * r) * Math.cos(lng * r), -Math.sin(lat * r) * Math.sin(lng * r), Math.cos(lat * r)];
  var dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
  return Q.normalize(Math.atan2(dot(k, east), dot(k, north)) * 180 / Math.PI);
}

test('Qibla bearing matches published values for major cities', function () {
  var cases = [
    ['New York', 40.7128, -74.0060, 58.48],
    ['London', 51.5074, -0.1278, 118.99],
    ['Sydney', -33.8688, 151.2093, 277.50],
    ['Jakarta', -6.2088, 106.8456, 295.15],
    ['Tokyo', 35.6762, 139.6503, 293.00],
    ['Karachi', 24.8607, 67.0011, 267.74]
  ];
  cases.forEach(function (c) { near(Q.qiblaBearing(c[1], c[2]), c[3], 0.1, c[0]); });
});

test('Qibla bearing agrees with an independent vector method everywhere', function () {
  for (var lat = -85; lat <= 85; lat += 17) {
    for (var lng = -180; lng <= 180; lng += 23) {
      near(Q.qiblaBearing(lat, lng), vectorBearing(lat, lng), 1e-6, lat + ',' + lng);
    }
  }
});

test('simple geometric sanity checks', function () {
  // Due north of the Kaaba (same longitude) -> face south.
  near(Q.qiblaBearing(40, Q.KAABA.lng), 180, 1e-9);
  // Due south of the Kaaba -> face north.
  near(Q.qiblaBearing(-10, Q.KAABA.lng), 0, 1e-9);
  // Madinah is roughly south of Makkah... Makkah is south of Madinah.
  near(Q.qiblaBearing(24.4686, 39.6142), 176.3, 0.1);
  // Result is always in [0, 360).
  var b = Q.qiblaBearing(-89.9, 10);
  assert.ok(b >= 0 && b < 360);
});

test('distance to the Kaaba', function () {
  assert.ok(Math.abs(Q.distanceToKaaba(40.7128, -74.0060) - 10306) < 15, 'NYC ~10,300 km');
  assert.ok(Math.abs(Q.distanceToKaaba(24.4686, 39.6142) - 339) < 5, 'Madinah ~340 km');
  assert.ok(Q.distanceToKaaba(Q.KAABA.lat, Q.KAABA.lng) < 1e-9);
});

test('invalid coordinates are rejected', function () {
  assert.throws(function () { Q.qiblaBearing(91, 0); });
  assert.throws(function () { Q.qiblaBearing(0, 181); });
  assert.throws(function () { Q.qiblaBearing(NaN, 0); });
  assert.throws(function () { Q.distanceToKaaba('1', 2); });
  assert.equal(Q.isValidCoord(0, 0), true);
});

test('normalize and angleDiff wrap correctly', function () {
  assert.equal(Q.normalize(-10), 350);
  assert.equal(Q.normalize(720), 0);
  assert.equal(Q.normalize(-360), 0);
  assert.equal(Q.angleDiff(350, 10), 20);
  assert.equal(Q.angleDiff(10, 350), -20);
  assert.equal(Q.angleDiff(0, 180), 180);
  assert.equal(Q.angleDiff(90, 90), 0);
});

test('cardinal names', function () {
  assert.equal(Q.cardinal(0), 'N');
  assert.equal(Q.cardinal(58.48), 'ENE');
  assert.equal(Q.cardinal(118.99), 'ESE');
  assert.equal(Q.cardinal(277.5), 'W');
  assert.equal(Q.cardinal(359), 'N');
});

test('heading from iOS events (webkitCompassHeading)', function () {
  assert.equal(Q.headingFromEvent({ webkitCompassHeading: 42, alpha: 7 }, 0), 42);
  // Landscape: screen rotated 90 degrees counter-clockwise.
  assert.equal(Q.headingFromEvent({ webkitCompassHeading: 270 }, 90), 0);
  assert.equal(Q.headingFromEvent({ webkitCompassHeading: 10 }, -90), 280);
  // iOS reports -1 when heading is unavailable.
  assert.equal(Q.headingFromEvent({ webkitCompassHeading: -1, alpha: 10 }, 0), null);
});

test('heading from Android absolute events (alpha)', function () {
  assert.equal(Q.headingFromEvent({ absolute: true, alpha: 0 }, 0), 0);
  assert.equal(Q.headingFromEvent({ absolute: true, alpha: 90 }, 0), 270); // alpha is counter-clockwise
  assert.equal(Q.headingFromEvent({ absolute: true, alpha: 270 }, 0), 90);
  // Relative (non-north-referenced) alpha is not a compass heading.
  assert.equal(Q.headingFromEvent({ absolute: false, alpha: 90 }, 0), null);
  assert.equal(Q.headingFromEvent({ alpha: null, absolute: true }, 0), null);
  assert.equal(Q.headingFromEvent(null, 0), null);
});

test('smoother takes the short way round north', function () {
  var s = new Q.Smoother(0.5);
  assert.equal(s.push(350), 350);
  var v = s.push(10); // should move +10 towards 370, not -170
  assert.equal(v, 360);
  v = s.push(10);
  assert.equal(v, 365);
  for (var i = 0; i < 50; i++) v = s.push(10);
  assert.equal(Q.normalize(v), 10); // snaps exactly onto the target
  assert.equal(s.settled(10), true);
  assert.equal(s.settled(20), false);
});

test('turn instructions', function () {
  assert.equal(Q.turnInstruction(58, 58.48).turn, 'aligned');
  assert.equal(Q.turnInstruction(0, 4).turn, 'aligned');
  var r = Q.turnInstruction(0, 58.48);
  assert.equal(r.turn, 'right');
  assert.equal(r.degrees, 58);
  var l = Q.turnInstruction(100, 58.48);
  assert.equal(l.turn, 'left');
  assert.equal(l.degrees, 42);
  assert.equal(Q.turnInstruction(358, 2).turn, 'aligned'); // across north
  assert.equal(Q.turnInstruction(355, 3).turn, 'right'); // 8 degrees, across north
  assert.equal(Q.turnInstruction(240, 58.48).turn, 'around');
});

test('great circle path starts at the user and ends at the Kaaba', function () {
  var pts = Q.greatCirclePoints(40.7128, -74.0060, 32);
  assert.equal(pts.length, 33);
  assert.ok(Math.abs(pts[0][0] - 40.7128) < 1e-9 && Math.abs(pts[0][1] + 74.006) < 1e-9);
  var end = pts[pts.length - 1];
  assert.ok(Math.abs(end[0] - Q.KAABA.lat) < 1e-6);
  assert.ok(Math.abs(Q.normalize(end[1]) - Q.KAABA.lng) < 1e-6);
  // From New York the great circle arcs north-east over the Atlantic.
  var maxLat = Math.max.apply(null, pts.map(function (p) { return p[0]; }));
  assert.ok(maxLat > 45);
  // No jumps across the antimeridian (e.g. from Hawaii / Fiji).
  var fiji = Q.greatCirclePoints(-17.7, 178.0, 64);
  for (var i = 1; i < fiji.length; i++) assert.ok(Math.abs(fiji[i][1] - fiji[i - 1][1]) < 30);
});
