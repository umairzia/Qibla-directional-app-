/*
 * Qibla compass UI. Plain ES5 for older iPhones.
 *
 * Location:  browser Geolocation API (GPS/Wi-Fi, free, on-device)
 *            -> fallback: approximate IP location from GeoJS (free, no key)
 *            -> manual: type a city (OpenStreetMap Nominatim) or tap the map.
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
    search: $('manual'),
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
  var isAndroid = /Android/i.test(navigator.userAgent);
  // Laptops and desktops have no compass sensor, so they need different help.
  var isComputer = !isIOS && !isAndroid && !/Mobi/i.test(navigator.userAgent);
  var locateButtonTimer = null;

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
    var dirText = Math.round(bearing) + '\u00B0 ' + Q.cardinal(bearing);
    setText(el.details, 'Qibla: ' + dirText + ' from North \u00B7 ' + formatDistance(state.distance) + ' to Makkah');

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
    if (t.turn === 'aligned') setText(el.instruction, '\u2713 Facing the Qibla');
    else if (t.turn === 'around') setText(el.instruction, 'Turn around');
    else setText(el.instruction, 'Turn ' + t.turn + ' ' + t.degrees + '\u00B0');
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

    var where = loc.label || (loc.lat.toFixed(3) + '\u00B0, ' + loc.lng.toFixed(3) + '\u00B0');
    var how = {
      gps: 'your location' + (loc.accuracy ? ' (\u00B1' + formatDistance(loc.accuracy / 1000) + ')' : ''),
      saved: 'last known location',
      ip: 'approximate, from your network',
      search: 'searched place',
      map: 'picked on map'
    }[loc.source] || '';
    setText(el.location, '\uD83D\uDCCD ' + where + (how ? ' \u2014 ' + how : ''));

    if (loc.source !== 'saved') saveLocation(loc);
    updateMap();
    requestRender();
  }

  function permissionHelp() {
    if (isIOS) {
      return 'To allow it on iPhone: <b>Settings \u203A Privacy \u203A Location Services \u203A Safari Websites \u203A While Using</b>, then tap \u201CUpdate my location\u201D.';
    }
    if (isAndroid) {
      return 'To allow it: tap the icon to the left of the web address \u203A <b>Permissions</b> \u203A <b>Location</b> \u203A <b>Allow</b>, then tap \u201CUpdate my location\u201D.';
    }
    return 'Your browser will not ask again by itself. To allow it: click the icon to the left of the web address \u203A <b>Location</b> \u203A <b>Allow</b>, then reload the page. ' +
      'On Windows, also check that <b>Settings \u203A Privacy &amp; security \u203A Location</b> is on.';
  }

  // Shows a short result on the button so every tap gives visible feedback.
  function finishLocating(text) {
    el.btnLocate.disabled = false;
    setText(el.btnLocate, text);
    clearTimeout(locateButtonTimer);
    locateButtonTimer = setTimeout(function () { setText(el.btnLocate, 'Update my location'); }, 2500);
  }

  function locate(fresh) {
    el.btnLocate.disabled = true;
    clearTimeout(locateButtonTimer);
    setText(el.btnLocate, 'Locating\u2026');
    if (!window.isSecureContext && location.protocol === 'http:' &&
        !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      showHint('Location and compass need a secure page. Please open this app with <b>https://</b>.');
    }
    if (!navigator.geolocation) { ipFallback('This browser cannot find your location.'); return; }

    navigator.geolocation.getCurrentPosition(function (pos) {
      finishLocating('\u2713 Location updated');
      showHint('');
      show(el.search, false);
      setLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        source: 'gps'
      });
    }, function (err) {
      var msg = err && err.code === 1
        ? 'Location permission is blocked. ' + permissionHelp()
        : 'Could not get your exact location.';
      ipFallback(msg);
    }, {
      enableHighAccuracy: false,
      timeout: 15000,
      // A tap on "Update my location" always asks for a new position.
      maximumAge: fresh ? 0 : 10 * 60 * 1000
    });
  }

  function ipFallback(reason) {
    // Without an exact location, offer a simple city search (no map needed).
    show(el.search, true);
    if (state.loc && (state.loc.source === 'gps' || state.loc.source === 'search' || state.loc.source === 'map')) {
      finishLocating('Could not update');
      showHint(reason + ' Still using your previous location.');
      return; // keep a better location we already have
    }
    getJSON(IP_LOOKUP_URL).then(function (d) {
      var lat = parseFloat(d.latitude), lng = parseFloat(d.longitude);
      if (!Q.isValidCoord(lat, lng)) throw new Error('bad IP location');
      if (state.loc && state.loc.source === 'saved') {
        finishLocating('Using last location');
        showHint(reason + ' Using your last known location.');
        return;
      }
      finishLocating('Approximate location');
      setLocation({
        lat: lat, lng: lng, source: 'ip',
        label: [d.city, d.country].filter(Boolean).join(', ') || null
      });
      showHint(reason + ' Until then the app uses an approximate location from your internet connection, which is usually close enough for the Qibla. ' +
        'If it shows the wrong city (for example because of a VPN), type your city above.');
    }).catch(function () {
      finishLocating('Location not found');
      if (!state.loc) {
        setText(el.location, 'Location unknown');
        setText(el.instruction, 'Set your location');
      }
      showHint(reason + ' You can type your city above instead.');
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
      var msg = isComputer
        ? 'Laptops and desktop computers have no compass, so the arrow cannot turn with you. ' +
          'It shows the Qibla measured from North (the red <b>N</b>). For an arrow that turns as you turn, open this page on your phone.'
        : 'No compass reading yet. Move your phone in a figure-of-8 and hold it flat. Until it works, the arrow shows the Qibla measured from North (the red <b>N</b>).';
      if (isIOS && typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission !== 'function') {
        // iOS 12.2 - 12.x hides motion sensors behind a Safari setting.
        msg = 'Compass is off. On iPhone go to <b>Settings \u203A Safari \u203A Motion &amp; Orientation Access</b>, turn it on, then reload this page.';
      }
      showCompassHint(msg);
    }, NO_COMPASS_TIMEOUT_MS);
  }

  function setupCompass() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      showCompassHint('This browser cannot read a compass. The arrow shows the Qibla measured from North (the red <b>N</b>).');
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
      show(el.search, false);
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
      if (!results || !results.length) { showHint('No place found for \u201C' + escapeHtml(q) + '\u201D.'); return; }
      var r = results[0];
      setLocation({
        lat: parseFloat(r.lat), lng: parseFloat(r.lon), source: 'search',
        label: String(r.display_name || q).split(',').slice(0, 2).join(',')
      });
      show(el.search, false);
      showHint('');
    }).catch(function () {
      showHint('Search failed. Check your internet connection and try again.');
    });
  }

  // ------------------------------------------------------------------ init

  function init() {
    buildTicks();
    el.btnLocate.addEventListener('click', function () { locate(true); }, false);
    el.btnMap.addEventListener('click', toggleMap, false);
    el.search.addEventListener('submit', searchPlace, false);
    window.addEventListener('orientationchange', function () { requestRender(); }, false);

    var saved = loadLocation();
    if (saved) { saved.source = 'saved'; setLocation(saved); }
    locate(false);
    setupCompass();

    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ });
    }
  }

  init();
})();
