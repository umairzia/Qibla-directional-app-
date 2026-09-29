// Regenerates icons/share.png (the 1200x630 link preview image).
// Run: node tools/share-image.js   (needs: npm install)
var chromium = require('playwright').chromium;
var path = require('path');

var TAG = 'Free · No ads · No app to install';

var html = '<style>' +
  'body{margin:0;width:1200px;height:630px;background:#0f5132;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#fff;display:flex;align-items:center}' +
  '.dial{margin-left:80px;flex:none}.txt{margin-left:64px}' +
  'h1{font-size:76px;margin:0 0 18px;letter-spacing:.5px}' +
  'p{font-size:36px;margin:0 0 12px;color:#d9eee2;line-height:1.3}' +
  '.tag{margin-top:30px;display:inline-block;background:#e0b341;color:#1b1b1b;font-weight:700;font-size:30px;padding:12px 26px;border-radius:40px}' +
  '</style>' +
  '<svg class="dial" width="420" height="420" viewBox="0 0 200 200">' +
  '<circle cx="100" cy="100" r="94" fill="#12301f" stroke="#ffffff" stroke-opacity=".35" stroke-width="4"/>' +
  '<text x="100" y="32" fill="#ff6b5b" font-size="18" font-weight="700" text-anchor="middle" font-family="Arial">N</text>' +
  '<text x="174" y="106" fill="#9fb8aa" font-size="16" font-weight="700" text-anchor="middle" font-family="Arial">E</text>' +
  '<text x="100" y="182" fill="#9fb8aa" font-size="16" font-weight="700" text-anchor="middle" font-family="Arial">S</text>' +
  '<text x="26" y="106" fill="#9fb8aa" font-size="16" font-weight="700" text-anchor="middle" font-family="Arial">W</text>' +
  '<g transform="rotate(58 100 100)">' +
  '<line x1="100" y1="112" x2="100" y2="42" stroke="#e0b341" stroke-width="8" stroke-linecap="round"/>' +
  '<polygon points="100,28 87,52 113,52" fill="#e0b341"/>' +
  '<g transform="translate(100 14)"><rect x="-9" y="-9" width="18" height="18" rx="2" fill="#111"/><rect x="-9" y="-4" width="18" height="3.5" fill="#d4af37"/></g>' +
  '</g><circle cx="100" cy="100" r="7" fill="#fff"/></svg>' +
  '<div class="txt"><h1>Qibla Direction</h1><p>Find the Qibla from anywhere.</p><p>The arrow turns as you turn.</p>' +
  '<span class="tag">' + TAG + '</span></div>';

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html);
  await page.screenshot({ path: path.join(__dirname, '..', 'icons', 'share.png') });
  await browser.close();
})();
