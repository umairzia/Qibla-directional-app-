# Qibla Direction App

A free and open source Qibla compass that runs in the browser, including
Safari on older iPhones. Open the page, allow location (and on iOS 13+ tap
**Enable compass**) and the arrow points to the Kaaba in Makkah. It turns as
you turn.

No accounts, no API keys, no tracking, no build step.

## How it works

| Part | What it uses |
| --- | --- |
| Your location | The browser's built-in Geolocation API (GPS/Wi‑Fi, on your device) |
| Fallback location | [GeoJS](https://www.geojs.io/) IP lookup (free, no key), approximate |
| Manual location | [Nominatim](https://nominatim.org/) search or tapping the map (OpenStreetMap, FOSS) |
| Map | [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) tiles (FOSS), loaded only when you open the map |
| Direction to Makkah | Great-circle bearing to the Kaaba (21.422487° N, 39.826206° E), worked out on the device |
| Which way you face | `DeviceOrientation` events: `webkitCompassHeading` on iPhone, absolute `alpha` on Android |

The whole dial turns with the phone so that **N** always points north. The
gold arrow and the Kaaba icon are drawn on the dial, so they always point
to the Qibla. When the Kaaba lines up with the black marker at the top
(within 5°), the dial turns green and says **✓ Facing the Qibla**. Otherwise
it says **Turn left/right N°**.

Other things it does:

- Remembers your last location, so it works straight away next time and offline.
- Works in landscape as well as portrait.
- Warns you when the compass needs calibrating (move the phone in a figure-of-8) or when the phone is tilted too far.
- Explains the iPhone settings to change when location or motion access is turned off.
- Can be added to the home screen and keeps working offline (service worker).
- The JavaScript is plain ES5 (checked by a test), so it runs on older iOS Safari versions.

## Help, feedback and usage limits

- **Help & FAQ** (`faq.html`): fixes for the most common problems (compass not turning, location blocked, wrong city/VPN, compass interference, map limit, privacy). Messages in the app link straight to the matching answer.
- **Report a problem**: an email link with a ready-made report template. The address is put together by `js/contact.js`, so it is not written in the HTML where spam bots could find it.
- **Daily counts** (`js/usage.js`): the app counts anonymous daily totals (devices that opened the app, and devices that opened the map) with the free, open-source [Abacus](https://github.com/JasonLovesDoggo/abacus) counter. No location or personal data is sent. See them at `stats.html`.
- **Map limit**: the OpenStreetMap map switches off for the rest of the day (UTC) after `MAP_DAILY_LIMIT` (300) devices have opened it. Change the number in `js/usage.js`. If the counter cannot be reached, the map is allowed. The compass never depends on the counter.
- **Link preview**: `index.html` has Open Graph tags and `icons/share.png` (1200×630) for WhatsApp, Facebook, X and others.

## Using it on an iPhone

1. Open the app's **https://** address in Safari. Location and compass only work over HTTPS.
2. Tap **Allow** when asked for your location.
3. iOS 13 and later: tap **Enable compass**, then **Allow**.
   iOS 12.2–12.x: turn on **Settings › Safari › Motion & Orientation Access**.
4. Hold the phone flat and turn until the arrow points straight up and the dial turns green.
5. Optional: Share › **Add to Home Screen** to open it like an app.

For the best reading, keep away from metal, magnets and electronics. Phone
compasses are usually accurate to within a few degrees. Depending on the
device, the heading may be measured from magnetic north rather than true
north. Where the difference (magnetic declination) is large, use the map
to check your direction against a landmark.

## Hosting (free)

It is only static files, so any static host works. With **GitHub Pages**:
go to *Settings › Pages*, choose *Deploy from a branch*, pick your branch and
the `/ (root)` folder, and save. The app will be at
`https://<user>.github.io/<repo>/`, which is HTTPS.

## Development

```bash
npm install          # only needed for the browser tests
npm start            # serves the app at http://localhost:8080
npm test             # unit tests for the Qibla maths and compass logic
npm run test:e2e     # browser tests (Playwright/Chromium, iPhone-sized)
npm run test:all     # both
```

The browser tests fake GPS, the iOS and Android compass events, the iOS
permission prompt and all network APIs, so they can run offline.

```
index.html            page layout
faq.html              help & FAQ page
stats.html            daily usage counts
css/style.css         styles (light and dark mode)
js/qibla.js           maths: bearing, distance, great-circle path, heading, smoothing
js/app.js             UI: location, compass events, map
js/usage.js           anonymous daily counts and the map's daily limit
js/contact.js         feedback email link
js/faq.js             opens the FAQ answer named in the link
sw.js                 offline cache
vendor/leaflet/       Leaflet 1.9.4 (BSD-2-Clause)
tests/                unit tests, browser tests, small static server
```

## License

App code: MIT. Leaflet: BSD-2-Clause (see `vendor/leaflet/LICENSE`). Map
data © OpenStreetMap contributors (ODbL).
