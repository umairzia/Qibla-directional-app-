/*
 * Fills in the feedback email links. The address is assembled here rather
 * than written in the HTML, which keeps it away from simple spam bots.
 * Any element with class "js-feedback" becomes a mailto: link with a
 * ready-made report template; class "js-feedback-address" shows the address.
 */
(function () {
  'use strict';

  var address = ['umairzia81', 'gmail.com'].join('@');
  var subject = 'Qibla app: problem report';
  var body = [
    'Phone model (e.g. iPhone 12):',
    'iOS / Android version:',
    'Browser (Safari, Chrome...):',
    'City you were in:',
    'What happened:',
    'What you expected:',
    '',
    'Please attach a screenshot if you can.',
    '',
    '--- Technical details (filled in automatically) ---',
    navigator.userAgent
  ].join('\n');
  var href = 'mailto:' + address + '?subject=' + encodeURIComponent(subject) +
    '&body=' + encodeURIComponent(body);

  var links = document.querySelectorAll('.js-feedback');
  for (var i = 0; i < links.length; i++) links[i].setAttribute('href', href);
  var texts = document.querySelectorAll('.js-feedback-address');
  for (var j = 0; j < texts.length; j++) texts[j].textContent = address;
})();
