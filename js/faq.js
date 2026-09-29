/* Opens the FAQ answer named in the address (e.g. faq.html#compass). ES5. */
(function () {
  'use strict';

  function openFromHash() {
    var id = window.location.hash.replace(/^#/, '');
    if (!id) return;
    var target = document.getElementById(id);
    if (target && target.tagName === 'DETAILS') {
      target.open = true;
      if (target.scrollIntoView) target.scrollIntoView();
    }
  }

  openFromHash();
  window.addEventListener('hashchange', openFromHash, false);
})();
