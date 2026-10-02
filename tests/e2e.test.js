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
var ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1';
var PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
var SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results');

// The map's daily limit, read from the app so tests follow any change to it.
var MAP_DAILY_LIMIT = Number(/MAP_DAILY_LIMIT = (\d+)/.exec(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'usage.js'), 'utf8'))[1]);

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
    geolocation: opts.geo === false ? undefined : (opts.geo || NYC),
    colorScheme: opts.colorScheme || 'light'
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
    context.tileRequests = (context.tileRequests || 0) + 1;
    route.fulfill({ contentType: 'image/png', body: PNG_1PX });
  });
  // Anonymous usage counter: /hit/<ns>/<kind>-<day> and /get/...
  context.counterHits = [];
  await context.route('https://abacus.jasoncameron.dev/**', function (route) {
    if (opts.counterFails) return route.abort();
    var m = /\/(hit|get)\/[^/]+\/(visits|map)-(\d{8})/.exec(route.request().url());
    if (m && m[1] === 'hit') context.counterHits.push(m[2]);
    var value = m && m[2] === 'map' ? (opts.mapCount || 1) : 1;
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ value: value }) });
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

test('laptop without compass: explains why the arrow cannot turn', async function () {
  var app = await openApp({});
  var page = app.page;
  await waitForText(page, 'instruction', /Face 58° ENE/);
  await waitForText(page, 'compass-hint', /Laptops and desktop computers have no compass/);
  assert.doesNotMatch(await text(page, 'compass-hint'), /map/i); // the map is optional
  assert.equal(await dialRotation(page), 0);
  await app.context.close();
});

test('phone that sends no compass reading gets calibration advice', async function () {
  var app = await openApp({ userAgent: ANDROID_UA });
  await waitForText(app.page, 'compass-hint', /No compass reading yet.*figure-of-8/);
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
  await waitForText(page, 'hint', /permission is blocked.*Safari Websites/);
  assert.doesNotMatch(await text(page, 'hint'), /map/i);
  // The city search is offered directly, without opening the map.
  assert.equal(await page.isVisible('#manual'), true);
  assert.equal(await page.isVisible('#map-panel'), false);
  await page.fill('#search-input', 'Sydney');
  await page.click('#manual button');
  await waitForText(page, 'details', /Qibla: 277° W/);
  assert.equal(await page.isVisible('#manual'), false);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});

test('location denied and offline: asks the user to set a location', async function () {
  var app = await openApp({ geo: false, ipFails: true });
  var page = app.page;
  await waitForText(page, 'instruction', /Set your location/);
  await waitForText(page, 'hint', /type your city/);
  assert.equal(await page.isVisible('#manual'), true);
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

  // Tap on the map to move the location.
  var box0 = await page.locator('#map').boundingBox();
  await page.locator('#map').tap({ position: { x: 20, y: box0.height - 40 } });
  await waitForText(page, 'location', /picked on map/);
  await page.evaluate(function () { document.getElementById('manual').style.display = ''; });
  await page.fill('#search-input', 'Sydney');
  await page.click('#manual button');
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

test('"Update my location" always gives visible feedback', async function () {
  // Location allowed: button confirms the update.
  var app = await openApp({ userAgent: IPHONE_UA });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  await app.context.setGeolocation({ latitude: 51.5074, longitude: -0.1278 });
  await page.click('#btn-locate');
  await waitForText(page, 'btn-locate', /Location updated/);
  await waitForText(page, 'details', /Qibla: 119°/);
  await waitForText(page, 'btn-locate', /^Update my location$/);
  await app.context.close();

  // Location blocked on a laptop: button reports the result and the hint
  // explains how to unblock it in a desktop browser.
  app = await openApp({ geo: false });
  page = app.page;
  await waitForText(page, 'details', /Qibla: 119°/);
  await waitForText(page, 'btn-locate', /^Update my location$/);
  await page.click('#btn-locate');
  await waitForText(page, 'btn-locate', /Approximate location|Location not found|Using last location/);
  await waitForText(page, 'hint', /icon to the left of the web address/);
  assert.match(await text(page, 'hint'), /Windows/);
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
  ['js/qibla.js', 'js/app.js', 'js/usage.js', 'js/contact.js', 'js/faq.js', 'js/theme.js', 'sw.js'].forEach(function (f) {
    var src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.doesNotThrow(function () { acorn.parse(src, { ecmaVersion: 5 }); }, f + ' is not ES5');
  });
});

test('map is switched off after the daily limit and explains why', async function () {
  var app = await openApp({ userAgent: IPHONE_UA, mapCount: MAP_DAILY_LIMIT + 1 });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  await page.click('#btn-map');
  await page.waitForSelector('#map-limit', { state: 'visible' });
  assert.match(await text(page, 'map-limit'), /limit for today.*try again tomorrow/s);
  assert.equal(await page.isVisible('#map'), false);
  assert.equal(await page.isVisible('#map-caption'), false);
  assert.equal(await page.locator('.leaflet-container').count(), 0);
  assert.equal(app.context.tileRequests || 0, 0);
  // The compass keeps working.
  await iosHeading(page, 58);
  await waitForText(page, 'instruction', /Facing the Qibla/);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});

test('map still works for the last device within the daily limit', async function () {
  assert.equal(MAP_DAILY_LIMIT, 300);
  var app = await openApp({ userAgent: IPHONE_UA, mapCount: MAP_DAILY_LIMIT });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  await page.click('#btn-map');
  await page.waitForSelector('.leaflet-overlay-pane path');
  assert.equal(await page.isVisible('#map-limit'), false);
  await app.context.close();
});

test('map still works when the usage counter is unreachable', async function () {
  var app = await openApp({ userAgent: IPHONE_UA, counterFails: true });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  await page.click('#btn-map');
  await page.waitForSelector('.leaflet-overlay-pane path');
  assert.equal(await page.isVisible('#map-limit'), false);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});

test('each device is counted once per day, map only when opened', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  var page = app.page;
  await waitForText(page, 'details', /Qibla: 58°/);
  await page.reload();
  await waitForText(page, 'details', /Qibla: 58°/);
  await page.waitForTimeout(300);
  assert.deepEqual(app.context.counterHits, ['visits']);
  await page.click('#btn-map');
  await page.waitForSelector('.leaflet-container');
  await page.click('#btn-map');
  await page.click('#btn-map');
  assert.deepEqual(app.context.counterHits, ['visits', 'map']);
  await app.context.close();
});

test('footer: privacy note, accuracy note, and feedback email with spam warning', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  var page = app.page;
  var footer = await page.textContent('footer');
  assert.match(footer, /your location stays on your device/);
  assert.match(footer, /If in doubt, check via other Qibla apps to verify/);
  assert.match(footer, /Spam, phishing links and suspicious messages are automatically blocked and filtered/);
  var href = await page.getAttribute('footer .js-feedback', 'href');
  assert.match(href, /^mailto:umairzia81@gmail\.com\?subject=Qibla%20app/);
  assert.match(decodeURIComponent(href), /Phone model[\s\S]*iPhone OS 12_5_7/);
  // The address is not written in the page source (keeps it from spam bots).
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /umairzia81@/);
  await app.context.close();
});

test('help links in messages lead to FAQ answers that open automatically', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  var page = app.page;
  // Every FAQ anchor used by the app exists on the FAQ page.
  var appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  var anchors = [];
  appSrc.replace(/helpLink\('([\w-]+)'\)/g, function (m, a) { anchors.push(a); });
  assert.ok(anchors.length >= 4);
  await page.goto(baseURL + 'faq.html');
  for (var i = 0; i < anchors.length; i++) {
    assert.equal(await page.locator('#' + anchors[i]).count(), 1, 'faq.html#' + anchors[i]);
  }
  assert.equal(await page.evaluate(function () { return document.getElementById('compass').open; }), false);
  await page.goto(baseURL + 'faq.html#compass');
  assert.equal(await page.evaluate(function () { return document.getElementById('compass').open; }), true);
  assert.match(await page.textContent('#compass'), /Enable compass/);
  // Contact section.
  assert.match(await page.getAttribute('#contact ~ p .js-feedback', 'href'), /^mailto:umairzia81@gmail\.com/);
  assert.match(await page.textContent('.js-feedback-address'), /umairzia81@gmail\.com/);
  assert.match(await page.textContent('main'), /phishing links.*automatically blocked and filtered/s);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'faq.png'), fullPage: true });
  await app.context.close();
});

test('share preview tags point to a real 1200x630 image', async function () {
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card'].forEach(function (t) {
    assert.ok(html.indexOf(t) !== -1, t);
  });
  var png = fs.readFileSync(path.join(__dirname, '..', 'icons', 'share.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('stats page shows daily counts', async function () {
  var app = await openApp({});
  var page = app.page;
  await page.goto(baseURL + 'stats.html');
  await page.waitForFunction(function () { return document.querySelectorAll('#rows tr').length === 7; });
  assert.match(await page.textContent('#rows'), /\(today\)/);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});

function bodyBackground(page) {
  return page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; });
}
var DARK_GREEN = 'rgb(15, 74, 46)'; // #0f4a2e
var LIGHT_BG = 'rgb(246, 245, 240)'; // #f6f5f0

test('dark mode toggle switches to dark green and is remembered', async function () {
  var app = await openApp({ userAgent: IPHONE_UA });
  var page = app.page;
  assert.equal(await bodyBackground(page), LIGHT_BG);
  assert.match(await page.textContent('.js-theme-toggle'), /Dark/);
  await page.click('.js-theme-toggle');
  assert.equal(await bodyBackground(page), DARK_GREEN);
  assert.match(await page.textContent('.js-theme-toggle'), /Light/);
  assert.equal(await page.getAttribute('meta[name="theme-color"]', 'content'), '#0f4a2e');
  // Remembered on reload and on the FAQ page.
  await page.reload();
  assert.equal(await bodyBackground(page), DARK_GREEN);
  await page.goto(baseURL + 'faq.html');
  assert.equal(await bodyBackground(page), DARK_GREEN);
  await page.click('.js-theme-toggle');
  assert.equal(await bodyBackground(page), LIGHT_BG);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});

test('follows the phone dark mode until the user picks a theme', async function () {
  var app = await openApp({ userAgent: IPHONE_UA, colorScheme: 'dark' });
  var page = app.page;
  assert.equal(await bodyBackground(page), DARK_GREEN);
  assert.match(await page.textContent('.js-theme-toggle'), /Light/);
  await page.click('.js-theme-toggle');
  assert.equal(await bodyBackground(page), LIGHT_BG);
  await page.reload();
  assert.equal(await bodyBackground(page), LIGHT_BG);
  await app.context.close();
});
