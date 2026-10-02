/*
 * Visual "button pressed" cue for touch screens.
 *
 * iPhone browsers (Safari, Brave, Chrome: all WebKit) do not show CSS
 * :active styles for finger taps, so buttons gave no feedback. This adds a
 * light yellow ring (class "is-pressed") as soon as a finger touches a
 * button, and keeps it briefly after the tap registers, so people can see
 * their touch was received. If the finger slides away (scrolling), the
 * ring is removed and nothing is pressed.
 *
 * Applies only to elements marked with class "js-press" (the "Update my
 * location", "Show map" and "Help & FAQ" buttons). Other buttons and text
 * links are left as they are.
 * Plain ES5 for older iPhones.
 */
(function () {
  'use strict';

  var HOLD_MS = 600;   // how long the ring stays after a successful tap
  var MOVE_PX = 12;    // finger movement that counts as scrolling, not a tap
  var active = null, startX = 0, startY = 0, timer = null;

  function pressable(el) {
    while (el && el !== document) {
      if (typeof el.className === 'string' &&
          (' ' + el.className + ' ').indexOf(' js-press ') !== -1) {
        return el.disabled ? null : el;
      }
      el = el.parentNode;
    }
    return null;
  }

  function on(el) {
    clearTimeout(timer);
    if (active && active !== el) off();
    active = el;
    if (el.className.indexOf('is-pressed') === -1) el.className += ' is-pressed';
  }

  function off() {
    clearTimeout(timer);
    if (active) active.className = active.className.replace(/\s*is-pressed/g, '');
    active = null;
  }

  function offLater() {
    clearTimeout(timer);
    timer = setTimeout(off, HOLD_MS);
  }

  function point(e) {
    var t = e.touches && e.touches[0] ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  document.addEventListener('touchstart', function (e) {
    var el = pressable(e.target);
    if (!el) return;
    var p = point(e);
    startX = p.x; startY = p.y;
    on(el);
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!active) return;
    var p = point(e);
    if (Math.abs(p.x - startX) > MOVE_PX || Math.abs(p.y - startY) > MOVE_PX) off();
  }, { passive: true });

  document.addEventListener('touchcancel', off, false);
  document.addEventListener('touchend', function () { if (active) offLater(); }, false);

  // Mouse and keyboard users get the same cue.
  document.addEventListener('mousedown', function (e) {
    var el = pressable(e.target);
    if (el) on(el);
  }, false);
  document.addEventListener('mouseup', function () { if (active) offLater(); }, false);

  // The tap went through: show the ring (again) to confirm it.
  document.addEventListener('click', function (e) {
    var el = pressable(e.target);
    if (!el) return;
    on(el);
    offLater();
  }, false);
})();
