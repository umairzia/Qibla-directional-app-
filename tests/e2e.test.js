// End-to-end tests in a real browser (Chromium via Playwright) sized like an
// older iPhone. Location, compass events and network APIs are simulated.
// Run: npm run test:e2e
var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var fs = require('fs');
var playwright = require('playwright');
var createServer = require('./server');

var NYC = { latitude: 40.7128, longitude: -74.0060, accuracy: 30 };
var IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1';
var PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
var SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results');

var server, baseURL, browser;

test.before(async function () {
  server = createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  baseURL = 'http://localhost:' + server.address().port + '/';
  var opts = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) opts.executablePath = '/opt/pw-browsers/chromium';
  try { browser = await playwright.chromium.launch(opts); } catch (e) { browser = await playwright.chromium.launch(); }
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test.after(async function () {
  if (browser) await browser.close();
  if (server) server.close();
});

// Opens the app in an iPhone 8-sized context. External services are mocked
// so tests are deterministic and never hit real APIs.
async function openApp(opts) {
  opts = opts || {};
  var context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: opts.userAgent,
    serviceWorkers: 'block',
    permissions: opts.geo === false ? [] : ['geolocation'],
    geolocation: opts.geo === false ? undefined : (opts.geo || NYC)
  });
  if (opts.initScript) await context.addInitScript(opts.initScript);
  await context.route('https://get.geojs.io/**', function (route) {
    if (opts.ipFails) return route.abort();
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ latitude: '51.5074', longitude: '-0.1278', city: 'London', country: 'United Kingdom' }) });
  });
  await context.route('https://nominatim.openstreetmap.org/**', function (route) {
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: '-33.8688', lon: '151.2093', display_name: 'Sydney, Council of the City of Sydney, New South Wales, Australia' }]) });
  });
  await context.route('https://tile.openstreetmap.org/**', function (route) {
    route.fulfill({ contentType: 'image/png', body: PNG_1PX });
  });
  var page = await context.newPage();
  var errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  await page.goto(baseURL);
  return { context: context, page: page, errors: errors };
}

// Simulates an iOS Safari compass reading.
function iosHeading(page, heading, extra) {
  return page.evaluate(function (a) {
    var e = new Event('deviceorientation');
    Object.defineProperty(e, 'webkitCompassHeading', { value: a.h });
    Object.defineProperty(e, 'webkitCompassAccuracy', { value: a.x.acc === undefined ? 10 : a.x.acc });
    Object.defineProperty(e, 'beta', { value: a.x.beta === undefined ? 0 : a.x.beta });
    window.dispatchEvent(e);
  }, { h: heading, x: extra || {} });
}

// Rotation (degrees) currently applied to the compass dial.
function dialRotation(page) {
  return page.evaluate(function () {
    var m = /rotate\((-?[\d.]+)deg\)/.exec(document.getElementById('dial').style.transform);
    return m ? parseFloat(m[1]) : null;
  });
}

// Waits until the dial's rotation is within `tol` degrees of `expected`.
async function waitForRotation(page, expected, tol) {
  await page.waitForFunction(function (a) {
    var m = /rotate\((-?[\d.]+)deg\)/.exec(document.getElementById('dial').style.transform);
    return m && Math.abs(parseFloat(m[1]) - a.expected) <= a.tol;
  }, { expected: expected, tol: tol === undefined ? 0.01 : tol }, { timeout: 5000 });
}

function text(page, id) { return page.textContent('#' + id); }

async function waitForText(page, id, re) {
  await page.waitForFunction(function (a) {
    return new RegExp(a.re).test(document.getElementById(a.id).textContent);
  }, { id: id, re: re.source }, { timeout: 5000 });
}

test('shows Qibla direction from GPS and turns the dial with the phone (iOS)', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  var page = app.page;

  await waitForText(page, 'details', /Qibla: 58° ENE from North · 10,306 km to Makkah/);
  assert.match(await text(page, 'location'), /40\.713°, -74\.006° — your location/);
  assert.match(await text(page, 'instruction'), /Face 58° ENE/); // no compass reading yet
  var arrow = await page.getAttribute('#qibla-arrow', 'transform');
  assert.equal(arrow, 'rotate(58.48 100 100)');

  // Facing north: Qibla is 58 degrees to the right.
  await iosHeading(page, 0);
  await waitForText(page, 'instruction', /Turn right 58°/);
  assert.equal(await page.isVisible('#btn-compass'), false);

  // Turn towards the Qibla: the dial rotates the opposite way so the arrow
  // keeps pointing at the Kaaba, and the UI confirms alignment.
  await iosHeading(page, 58);
  await waitForText(page, 'instruction', /Facing the Qibla/);
  assert.ok(await page.evaluate(function () { return /aligned/.test(document.body.className); }));
  await waitForRotation(page, -58);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'aligned.png') });

  // Overshoot: turn left.
  await iosHeading(page, 100);
  await waitForText(page, 'instruction', /Turn left 42°/);
  assert.ok(!(await page.evaluate(function () { return /aligned/.test(document.body.className); })));
  await waitForRotation(page, -100);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'turn-left.png') });

  // Facing away.
  await iosHeading(page, 240);
  await waitForText(page, 'instruction', /Turn around/);

  assert.deepEqual(app.errors, []);
  await app.context.close();
});

test('dial takes the short way round when crossing north', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  await iosHeading(page, 350);
  await waitForRotation(page, -350);
  // Sample the rotation while it animates from 350 to 10 degrees.
  await iosHeading(page, 10);
  var samples = [];
  for (var i = 0; i < 15; i++) {
    samples.push(await dialRotation(page));
    await page.waitForTimeout(30);
  }
  await waitForRotation(page, -370);
  samples.push(await dialRotation(page));
  samples.forEach(function (r) { assert.ok(r <= -349.5 && r >= -370.01, 'rotation stayed near north: ' + r); });
  await waitForText(page, 'instruction', /Turn right 48°/);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});

test('landscape screen rotation is compensated', async function () {
  var app = await openApp({
    userAgent: IPHONE_UA,
    initScript: function () {
      // Older iPhones only have window.orientation (no screen.orientation).
      Object.defineProperty(Screen.prototype, 'orientation', { value: undefined, configurable: true });
      Object.defineProperty(window, 'orientation', { value: 90, configurable: true });
    }
  });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  // Device top points west (270) but the screen is rotated 90 degrees, so the user faces north.
  await iosHeading(page, 270);
  await waitForText(page, 'instruction', /Turn right 58°/);
  await app.context.close();
});

test('compass calibration and tilt hints', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  await iosHeading(page, 0, { acc: -1 });
  await waitForText(page, 'compass-hint', /figure-of-8/);
  await iosHeading(page, 0, { beta: 80 });
  await waitForText(page, 'compass-hint', /Hold your phone flat/);
  await iosHeading(page, 0);
  await page.waitForFunction(function () { return document.getElementById('compass-hint').style.display === 'none'; });
  await app.context.close();
});

test('iOS 13+ asks for compass permission with a button', async function () {
  var app = await openApp({
    userAgent: IPHONE_UA,
    initScript: function () {
      window.__permissionAsked = 0;
      window.DeviceOrientationEvent.requestPermission = function () {
        window.__permissionAsked++;
        return Promise.resolve('granted');
      };
    }
  });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  assert.equal(await page.isVisible('#btn-compass'), true);
  await page.click('#btn-compass');
  assert.equal(await page.evaluate(function () { return window.__permissionAsked; }), 1);
  await iosHeading(page, 58);
  await waitForText(page, 'instruction', /Facing the Qibla/);
  assert.equal(await page.isVisible('#btn-compass'), false);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});

test('Android: uses absolute orientation events', async function () {
  var app = await openApp({});
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  await page.evaluate(function () {
    var e = new Event('deviceorientationabsolute');
    Object.defineProperty(e, 'absolute', { value: true });
    Object.defineProperty(e, 'alpha', { value: 360 - 30 }); // heading 30
    window.dispatchEvent(e);
  });
  await waitForText(page, 'instruction', /Turn right 28°/);
  // A relative (non-absolute) event must not be treated as a compass.
  await page.evaluate(function () {
    var e = new Event('deviceorientation');
    Object.defineProperty(e, 'absolute', { value: false });
    Object.defineProperty(e, 'alpha', { value: 200 });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(200);
  assert.match(await text(page, 'instruction'), /Turn right 28°/);
  await app.context.close();
});

test('no compass: shows a static direction and a helpful hint', async function () {
  var app = await openApp({});
  var page = app.page;
  await waitForText(page, 'instruction', /Face 58° ENE/);
  await waitForText(page, 'compass-hint', /No compass detected/);
  assert.equal(await dialRotation(page), 0);
  await app.context.close();
});

test('iOS 12.2+ with motion access off explains the Safari setting', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  await waitForText(app.page, 'compass-hint', /Motion &? ?Orientation Access/);
  await app.context.close();
});

test('location denied: falls back to approximate IP location', async function () {
  var app = await openApp({ geo: false, userAgent: IPHONE_UA });
  var page = app.page;
  await waitForText(page, 'location', /London, United Kingdom — approximate/);
  await waitForText(page, 'details', /Qibla: 119° ESE from North · 4,794 km/);
  await waitForText(page, 'hint', /permission was denied/);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});

test('location denied and offline: asks the user to set a location', async function () {
  var app = await openApp({ geo: false, ipFails: true });
  var page = app.page;
  await waitForText(page, 'instruction', /Set your location/);
  await waitForText(page, 'hint', /Show map/);
  assert.equal(await page.isVisible('#qibla-arrow'), false);
  await app.context.close();
});

test('map: shows the path, search and tap-to-set location', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  await page.click('#btn-map');
  await page.waitForSelector('.leaflet-container');
  await page.waitForSelector('.leaflet-overlay-pane path');
  assert.equal(await page.locator('.leaflet-overlay-pane path').count(), 3); // line + 2 markers
  assert.match(await page.textContent('.leaflet-control-attribution'), /OpenStreetMap/);
  assert.equal(await text(page, 'btn-map'), 'Hide map');

  await page.fill('#search-input', 'Sydney');
  await page.click('#search button');
  await waitForText(page, 'location', /Sydney, Council of the City of Sydney — searched place/);
  await waitForText(page, 'details', /Qibla: 277° W from North · 13,236 km/);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'map.png'), fullPage: true });

  // Tap on the map (on top of the path line, which must not swallow taps).
  var box = await page.locator('#map').boundingBox();
  await page.locator('#map').tap({ position: { x: box.width / 2, y: box.height / 2 } });
  await waitForText(page, 'location', /picked on map/);

  await page.click('#btn-map');
  assert.equal(await page.isVisible('#map-panel'), false);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});

test('remembers the last location for the next visit', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  await waitForText(app.page, 'details', /Qibla: 58°/);
  var page2 = await app.context.newPage();
  await app.context.clearPermissions();
  await app.context.route('https://get.geojs.io/**', function (r) { r.abort(); });
  await page2.goto(baseURL);
  await waitForText(page2, 'location', /last known location/);
  await waitForText(page2, 'details', /Qibla: 58°/);
  await app.context.close();
});

test('JavaScript is plain ES5 so it runs on older iPhones', function () {
  var acorn = require('acorn');
  ['js/qibla.js', 'js/app.js', 'sw.js'].forEach(function (f) {
    var src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.doesNotThrow(function () { acorn.parse(src, { ecmaVersion: 5 }); }, f + ' is not ES5');
  });
});
