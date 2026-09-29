/*
 * Light / dark-green theme toggle. Loaded in <head> so the saved choice is
 * applied before the page is drawn (no flash of the wrong colours).
 * With no saved choice the page follows the phone's own dark mode setting.
 * Plain ES5 for older iPhones.
 */
(function () {
  'use strict';

  var KEY = 'qibla.theme';
  var root = document.documentElement;
  var COLORS = { light: '#0f5132', dark: '#0f4a2e' };

  function saved() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function current() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return systemDark() ? 'dark' : 'light';
  }

  function updateButtons() {
    var dark = current() === 'dark';
    var buttons = document.querySelectorAll('.js-theme-toggle');
    for (var i = 0; i < buttons.length; i++) {
      // The button offers the other theme.
      buttons[i].textContent = dark ? '☀️ Light' : '🌙 Dark';
      buttons[i].setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLORS[current()]);
  }

  function toggle() {
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { window.localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
    updateButtons();
  }

  var choice = saved();
  if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);

  function init() {
    var buttons = document.querySelectorAll('.js-theme-toggle');
    for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener('click', toggle, false);
    updateButtons();
    // Keep the label right if the phone switches dark mode while open.
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addListener) mq.addListener(updateButtons);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, false);
  } else {
    init();
  }
})();
