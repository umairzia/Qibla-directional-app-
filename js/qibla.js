/*
 * Qibla math + compass helpers.
 *
 * Written in plain ES5 (no arrow functions, let/const, optional chaining...)
 * so it runs on older iPhones (iOS 10+ Safari). Works both in the browser
 * (exposed as window.Qibla) and in Node (module.exports) for unit tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Qibla = api;
  }
})(this, function () {
  'use strict';

  // Centre of the Kaaba, Masjid al-Haram, Makkah.
  var KAABA = { lat: 21.422487, lng: 39.826206 };
  var EARTH_RADIUS_KM = 6371.0088;
  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;

  /** Normalise any angle to the range [0, 360). */
  function normalize(deg) {
    var d = deg % 360;
    if (d < 0) d += 360;
    // Guard against -0 and floating point results like 360 - 1e-14 rounding.
    return d === 360 ? 0 : d + 0;
  }

  /** Signed smallest difference target - from, in the range (-180, 180]. */
  function angleDiff(from, to) {
    var d = normalize(to - from);
    return d > 180 ? d - 360 : d;
  }

  function isValidCoord(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number' &&
      isFinite(lat) && isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  /**
   * Initial great-circle bearing (degrees clockwise from true north) from
   * the given point to the Kaaba. This is the standard Qibla direction.
   */
  function qiblaBearing(lat, lng) {
    if (!isValidCoord(lat, lng)) throw new Error('Invalid coordinates');
    var phi1 = lat * RAD;
    var phi2 = KAABA.lat * RAD;
    var dLambda = (KAABA.lng - lng) * RAD;
    var y = Math.sin(dLambda) * Math.cos(phi2);
    var x = Math.cos(phi1) * Math.sin(phi2) -
      Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    return normalize(Math.atan2(y, x) * DEG);
  }

  /** Great-circle (haversine) distance to the Kaaba in kilometres. */
  function distanceToKaaba(lat, lng) {
    if (!isValidCoord(lat, lng)) throw new Error('Invalid coordinates');
    var phi1 = lat * RAD;
    var phi2 = KAABA.lat * RAD;
    var dPhi = (KAABA.lat - lat) * RAD;
    var dLambda = (KAABA.lng - lng) * RAD;
    var a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Points along the great circle from (lat, lng) to the Kaaba, for drawing
   * the true shortest path on a map. Longitudes are unwrapped so the line
   * does not jump across the antimeridian.
   */
  function greatCirclePoints(lat, lng, segments) {
    segments = segments || 64;
    var phi1 = lat * RAD, lam1 = lng * RAD;
    var phi2 = KAABA.lat * RAD, lam2 = KAABA.lng * RAD;
    var d = distanceToKaaba(lat, lng) / EARTH_RADIUS_KM;
    var pts = [];
    var prevLng = null;
    for (var i = 0; i <= segments; i++) {
      var f = i / segments;
      var pLat, pLng;
      if (d < 1e-9) {
        pLat = lat; pLng = lng;
      } else {
        var A = Math.sin((1 - f) * d) / Math.sin(d);
        var B = Math.sin(f * d) / Math.sin(d);
        var x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
        var y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
        var z = A * Math.sin(phi1) + B * Math.sin(phi2);
        pLat = Math.atan2(z, Math.sqrt(x * x + y * y)) * DEG;
        pLng = Math.atan2(y, x) * DEG;
      }
      if (prevLng !== null) {
        while (pLng - prevLng > 180) pLng -= 360;
        while (pLng - prevLng < -180) pLng += 360;
      }
      prevLng = pLng;
      pts.push([pLat, pLng]);
    }
    return pts;
  }

  /** 16-point compass name for a bearing, e.g. 58 -> "ENE". */
  function cardinal(deg) {
    var names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return names[Math.round(normalize(deg) / 22.5) % 16];
  }

  /**
   * Work out which way the top of the screen is pointing (degrees clockwise
   * from north) from a DeviceOrientationEvent-like object.
   *
   *  - iOS Safari provides webkitCompassHeading (already a compass heading).
   *  - Android/others provide an absolute alpha (counter-clockwise), used
   *    only when the event is marked absolute.
   *
   * `screenAngle` is the screen rotation (0, 90, -90/270, 180) so the
   * heading stays correct if the page is shown in landscape.
   * Returns null when no reliable heading is available.
   */
  function headingFromEvent(e, screenAngle) {
    if (!e) return null;
    var heading = null;
    if (typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading) &&
        e.webkitCompassHeading >= 0) {
      heading = e.webkitCompassHeading;
    } else if (e.absolute === true && typeof e.alpha === 'number' && isFinite(e.alpha)) {
      heading = 360 - e.alpha;
    }
    if (heading === null) return null;
    return normalize(heading + (screenAngle || 0));
  }

  /**
   * Smooths noisy compass readings. Keeps an "unwrapped" angle so a CSS
   * rotation never spins the long way round when crossing north (359 -> 0).
   */
  function Smoother(factor, snap) {
    this.factor = factor || 0.25;
    this.snap = snap === undefined ? 0.3 : snap; // settle exactly when this close
    this.value = null; // unwrapped, may be outside [0, 360)
  }
  Smoother.prototype.push = function (target) {
    if (this.value === null) {
      this.value = target;
    } else {
      var delta = angleDiff(normalize(this.value), target);
      this.value += Math.abs(delta) <= this.snap ? delta : delta * this.factor;
    }
    return this.value;
  };
  /** True once the smoothed value has reached the target. */
  Smoother.prototype.settled = function (target) {
    return this.value !== null && Math.abs(angleDiff(normalize(this.value), target)) < 1e-6;
  };
  Smoother.prototype.reset = function () { this.value = null; };

  /**
   * Plain-language instruction for the user.
   *  turn: 'aligned' | 'left' | 'right' | 'around'
   */
  function turnInstruction(heading, bearing, tolerance) {
    tolerance = tolerance || 5;
    var diff = angleDiff(heading, bearing);
    var abs = Math.abs(diff);
    var turn;
    if (abs <= tolerance) turn = 'aligned';
    else if (abs >= 170) turn = 'around';
    else turn = diff > 0 ? 'right' : 'left';
    return { turn: turn, degrees: Math.round(abs), diff: diff };
  }

  return {
    KAABA: KAABA,
    normalize: normalize,
    angleDiff: angleDiff,
    isValidCoord: isValidCoord,
    qiblaBearing: qiblaBearing,
    distanceToKaaba: distanceToKaaba,
    greatCirclePoints: greatCirclePoints,
    cardinal: cardinal,
    headingFromEvent: headingFromEvent,
    Smoother: Smoother,
    turnInstruction: turnInstruction
  };
});
