/*
 * Qibla compass UI. Plain ES5 for older iPhones.
 *
 * Location:  browser Geolocation API (GPS/Wi-Fi, free, on-device)
 *            -> fallback: approximate IP location from GeoJS (free, no key)
 *            -> manual: OpenStreetMap Nominatim search or tapping the map.
 * Heading:   DeviceOrientation events (iOS webkitCompassHeading, or
 *            absolute alpha on Android).
 * Map:       Leaflet + OpenStreetMap tiles (both FOSS), loaded on demand.
 */
(function () {
  'use strict';

  var Q = window.Qibla;
  var STORAGE_KEY = 'qibla.location.v1';
  var IP_LOOKUP_URL = 'https://get.geojs.io/v1/ip/geo.json';
  var SEARCH_URL = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=';
  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var NO_COMPASS_TIMEOUT_MS = 3000;
  var ALIGN_TOLERANCE = 5;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    body: document.body,
    location: $('location'),
    dial: $('dial'),
    ticks: $('ticks'),
    arrow: $('qibla-arrow'),
    instruction: $('instruction'),
    details: $('details'),
    hint: $('hint'),
    compassHint: $('compass-hint'),
    btnCompass: $('btn-compass'),
    btnLocate: $('btn-locate'),
    btnMap: $('btn-map'),
    mapPanel: $('map-panel'),
    search: $('search'),
    searchInput: $('search-input')
  };

  var state = {
    loc: null,          // { lat, lng, label, source, accuracy }
    bearing: null,      // Qibla bearing, degrees from true north
    distance: null,     // km
    targetHeading: null,
    compassActive: false,
    wasAligned: false,
    lowAccuracy: false,
    tilted: false
  };
  var smoother = new Q.Smoother(0.2);
  var rafPending = false;
  var noCompassTimer = null;
  var map = null;
  var mapLayers = null;

  var isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ---------------------------------------------------------------- utils

  function setText(node, text) { node.textContent = text; }
  function show(node, visible) { node.style.display = visible ? '' : 'none'; }

  function setHint(node, html) {
    if (html) { node.innerHTML = html; show(node, true); } else { show(node, false); }
  }
  // Location / general messages.
  function showHint(html) { setHint(el.hint, html); }
  // Compass messages (calibration, tilt, permissions) update independently.
  function showCompassHint(html) { setHint(el.compassHint, html); }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function rotate(node, deg) {
    var t = 'rotate(' + deg.toFixed(2) + 'deg)';
    node.style.webkitTransform = t;
    node.style.transform = t;
  }

  function formatDistance(km) {
    if (km < 1) return Math.round(km * 1000) + ' m';
    return Math.round(km).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' km';
  }

  function screenAngle() {
    if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
      return window.screen.orientation.angle;
    }
    if (typeof window.orientation === 'number') return window.orientation;
    return 0;
  }

  function saveLocation(loc) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loc)); } catch (e) { /* private mode */ }
  }

  function loadLocation() {
    try {
      var loc = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      if (loc && Q.isValidCoord(loc.lat, loc.lng)) return loc;
    } catch (e) { /* ignore */ }
    return null;
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ------------------------------------------------------------- the dial

  function buildTicks() {
    var ns = 'http://www.w3.org/2000/svg';
    for (var d = 0; d < 360; d += 10) {
      var major = d % 90 === 0;
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '100');
      line.setAttribute('x2', '100');
      line.setAttribute('y1', major ? '4' : '5');
      line.setAttribute('y2', major ? '16' : '12');
      line.setAttribute('class', major ? 'tick tick-major' : 'tick');
      line.setAttribute('transform', 'rotate(' + d + ' 100 100)');
      el.ticks.appendChild(line);
    }
  }

  function render() {
    rafPending = false;
    if (state.bearing === null) return;

    var heading = 0;
    if (state.compassActive && state.targetHeading !== null) {
      heading = smoother.push(state.targetHeading);
      // Keep animating until the smoothed value settles on the target.
      if (!smoother.settled(state.targetHeading)) requestRender();
    }
    // Rotate the whole dial so that "N" points to real north; the Qibla
    // arrow is drawn on the dial so it points to the real Qibla direction.
    rotate(el.dial, -heading);
    updateInstruction(Q.normalize(heading));
  }

  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    (window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); })(render);
  }

  function updateInstruction(heading) {
    var bearing = state.bearing;
    var dirText = Math.round(bearing) + '° ' + Q.cardinal(bearing);
    setText(el.details, 'Qibla: ' + dirText + ' from North · ' + formatDistance(state.distance) + ' to Makkah');

    if (state.distance < 0.05) {
      setText(el.instruction, 'You are at the Kaaba');
      setAligned(false);
      return;
    }
    if (!state.compassActive) {
      setText(el.instruction, 'Face ' + dirText);
      setAligned(false);
      return;
    }
    var t = Q.turnInstruction(heading, bearing, ALIGN_TOLERANCE);
    if (t.turn === 'aligned') setText(el.instruction, '✓ Facing the Qibla');
    else if (t.turn === 'around') setText(el.instruction, 'Turn around');
    else setText(el.instruction, 'Turn ' + t.turn + ' ' + t.degrees + '°');
    setAligned(t.turn === 'aligned');
  }

  function setAligned(aligned) {
    if (aligned === state.wasAligned) return;
    state.wasAligned = aligned;
    if (aligned) {
      el.body.className += ' aligned';
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
    } else {
      el.body.className = el.body.className.replace(/\s*aligned/g, '');
    }
  }

  // -------------------------------------------------------------- location

  function setLocation(loc) {
    if (!Q.isValidCoord(loc.lat, loc.lng)) return;
    state.loc = loc;
    state.bearing = Q.qiblaBearing(loc.lat, loc.lng);
    state.distance = Q.distanceToKaaba(loc.lat, loc.lng);
    el.arrow.setAttribute('transform', 'rotate(' + state.bearing.toFixed(2) + ' 100 100)');
    show(el.arrow, true);

    var where = loc.label || (loc.lat.toFixed(3) + '°, ' + loc.lng.toFixed(3) + '°');
    var how = {
      gps: 'your location' + (loc.accuracy ? ' (±' + formatDistance(loc.accuracy / 1000) + ')' : ''),
      saved: 'last known location',
      ip: 'approximate, from your network',
      search: 'searched place',
      map: 'picked on map'
    }[loc.source] || '';
    setText(el.location, '📍 ' + where + (how ? ' — ' + how : ''));

    if (loc.source !== 'saved') saveLocation(loc);
    updateMap();
    requestRender();
  }

  function locate() {
    setText(el.btnLocate, 'Locating…');
    if (!window.isSecureContext && location.protocol === 'http:' &&
        !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      showHint('Location and compass need a secure page. Please open this app with <b>https://</b>.');
    }
    if (!navigator.geolocation) { ipFallback('Your browser has no location support.'); return; }

    navigator.geolocation.getCurrentPosition(function (pos) {
      setText(el.btnLocate, 'Update my location');
      showHint('');
      setLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        source: 'gps'
      });
    }, function (err) {
      var msg = err && err.code === 1
        ? 'Location permission was denied. To allow it on iPhone: <b>Settings › Privacy › Location Services › Safari Websites › While Using</b>, then tap “Update my location”.'
        : 'Could not get a GPS fix.';
      ipFallback(msg);
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 });
  }

  function ipFallback(reason) {
    setText(el.btnLocate, 'Update my location');
    if (state.loc && state.loc.source !== 'saved' && state.loc.source !== 'ip') {
      showHint(reason);
      return; // keep a better location we already have
    }
    getJSON(IP_LOOKUP_URL).then(function (d) {
      var lat = parseFloat(d.latitude), lng = parseFloat(d.longitude);
      if (!Q.isValidCoord(lat, lng)) throw new Error('bad IP location');
      if (state.loc && state.loc.source === 'saved') {
        showHint(reason + ' Using your last known location. You can also search or tap on the map.');
        return;
      }
      setLocation({
        lat: lat, lng: lng, source: 'ip',
        label: [d.city, d.country].filter(Boolean).join(', ') || null
      });
      showHint(reason + ' Showing an approximate location, which is usually fine for the Qibla. For better accuracy, search your city on the map.');
    }).catch(function () {
      if (!state.loc) {
        setText(el.location, 'Location unknown');
        setText(el.instruction, 'Set your location');
      }
      showHint(reason + ' Tap <b>Show map</b> to search for your city or tap your position on the map.');
    });
  }

  // --------------------------------------------------------------- compass

  function onOrientation(e) {
    var h = Q.headingFromEvent(e, screenAngle());
    if (h === null) return;
    if (!state.compassActive) {
      state.compassActive = true;
      clearTimeout(noCompassTimer);
      show(el.btnCompass, false);
      showCompassHint('');
    }
    state.targetHeading = h;

    // Help the user get a reliable reading.
    var acc = e.webkitCompassAccuracy;
    state.lowAccuracy = typeof acc === 'number' && (acc < 0 || acc > 25);
    state.tilted = typeof e.beta === 'number' && Math.abs(e.beta) > 60;
    if (state.lowAccuracy) {
      showCompassHint('Compass needs calibrating: move your phone in a figure-of-8, away from metal.');
    } else if (state.tilted) {
      showCompassHint('Hold your phone flat (screen facing up) for an accurate reading.');
    } else {
      showCompassHint('');
    }
    requestRender();
  }

  function listenOrientation() {
    // Android Chrome: 'deviceorientationabsolute' gives a north-referenced alpha.
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onOrientation, false);
    }
    // iOS (webkitCompassHeading) and other browsers with absolute alpha.
    window.addEventListener('deviceorientation', onOrientation, false);

    clearTimeout(noCompassTimer);
    noCompassTimer = setTimeout(function () {
      if (state.compassActive) return;
      var msg = 'No compass detected. Face the direction shown on the dial (the red <b>N</b> is North), or use the map.';
      if (isIOS && typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission !== 'function') {
        // iOS 12.2 - 12.x hides motion sensors behind a Safari setting.
        msg = 'Compass is off. On iPhone go to <b>Settings › Safari › Motion &amp; Orientation Access</b>, turn it on, then reload this page.';
      }
      showCompassHint(msg);
    }, NO_COMPASS_TIMEOUT_MS);
  }

  function setupCompass() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      showCompassHint('Your browser has no compass support. Face the direction shown on the dial.');
      return;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+: permission must be requested from a tap.
      show(el.btnCompass, true);
      el.btnCompass.addEventListener('click', function () {
        DeviceOrientationEvent.requestPermission().then(function (result) {
          if (result === 'granted') {
            listenOrientation();
          } else {
            showCompassHint('Compass access was denied. Close and reopen Safari on this page to be asked again.');
          }
        }).catch(function () {
          showCompassHint('Could not enable the compass. Make sure the page is opened with https://.');
        });
      }, false);
      // If permission was already granted earlier this session, events just flow.
      window.addEventListener('deviceorientation', onOrientation, false);
    } else {
      listenOrientation();
    }
  }

  // ------------------------------------------------------------------- map

  function loadLeaflet(cb) {
    if (window.L) { cb(); return; }
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    var s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = cb;
    s.onerror = function () { showHint('The map could not be loaded.'); };
    document.body.appendChild(s);
  }

  function initMap() {
    map = window.L.map('map', { worldCopyJump: true, zoomControl: true });
    window.L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.setView([Q.KAABA.lat, Q.KAABA.lng], 3);
    map.on('click', function (e) {
      var ll = e.latlng.wrap();
      setLocation({ lat: ll.lat, lng: ll.lng, source: 'map' });
      showHint('');
    });
    updateMap();
  }

  function updateMap() {
    if (!map || !state.loc) return;
    var L = window.L;
    if (mapLayers) map.removeLayer(mapLayers);
    var path = Q.greatCirclePoints(state.loc.lat, state.loc.lng, 96);
    var end = path[path.length - 1];
    mapLayers = L.layerGroup([
      L.polyline(path, { color: '#1e9e55', weight: 4, interactive: false }),
      L.circleMarker([state.loc.lat, state.loc.lng], {
        radius: 8, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1
      }).bindTooltip('You'),
      L.circleMarker(end, {
        radius: 8, color: '#d4af37', weight: 3, fillColor: '#111', fillOpacity: 1
      }).bindTooltip('Kaaba')
    ]).addTo(map);
    map.fitBounds(L.latLngBounds(path), { padding: [24, 24], maxZoom: 16 });
  }

  function toggleMap() {
    var open = el.mapPanel.style.display === 'none';
    show(el.mapPanel, open);
    setText(el.btnMap, open ? 'Hide map' : 'Show map');
    el.btnMap.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    loadLeaflet(function () {
      if (!map) initMap(); else map.invalidateSize();
    });
  }

  function searchPlace(ev) {
    ev.preventDefault();
    var q = el.searchInput.value.replace(/^\s+|\s+$/g, '');
    if (!q) return;
    el.searchInput.blur();
    getJSON(SEARCH_URL + encodeURIComponent(q)).then(function (results) {
      if (!results || !results.length) { showHint('No place found for “' + escapeHtml(q) + '”.'); return; }
      var r = results[0];
      setLocation({
        lat: parseFloat(r.lat), lng: parseFloat(r.lon), source: 'search',
        label: String(r.display_name || q).split(',').slice(0, 2).join(',')
      });
      showHint('');
    }).catch(function () {
      showHint('Search failed. Check your internet connection, or tap your position on the map.');
    });
  }

  // ------------------------------------------------------------------ init

  function init() {
    buildTicks();
    el.btnLocate.addEventListener('click', locate, false);
    el.btnMap.addEventListener('click', toggleMap, false);
    el.search.addEventListener('submit', searchPlace, false);
    window.addEventListener('orientationchange', function () { requestRender(); }, false);

    var saved = loadLocation();
    if (saved) { saved.source = 'saved'; setLocation(saved); }
    locate();
    setupCompass();

    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ });
    }
  }

  init();
})();
