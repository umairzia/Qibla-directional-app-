/*
 * Anonymous daily usage counts, kept with the free open-source Abacus
 * counting service (https://github.com/JasonLovesDoggo/abacus).
 *
 * Only two numbers per day are stored: how many devices opened the app and
 * how many opened the map. No location, IP address or other personal data
 * is sent by this app. Each count is a separate key per UTC day, so old
 * days simply expire on the service.
 *
 * The map uses free OpenStreetMap tiles, so it is limited to
 * MAP_DAILY_LIMIT devices per day to stay a light, polite user of that
 * service. If the counting service cannot be reached, the map is allowed
 * (the compass never depends on any of this).
 *
 * Plain ES5 for older iPhones. Exposed as window.Usage.
 */
(function (root) {
  'use strict';

  var COUNTER_URL = 'https://abacus.jasoncameron.dev';
  var NAMESPACE = 'umairzia-qibla-app';
  var MAP_DAILY_LIMIT = 100;
  var TIMEOUT_MS = 4000;

  /** UTC day as YYYYMMDD, so everyone worldwide shares the same "day". */
  function dayKey(date) {
    date = date || new Date();
    var m = date.getUTCMonth() + 1, d = date.getUTCDate();
    return date.getUTCFullYear() + (m < 10 ? '0' : '') + m + (d < 10 ? '0' : '') + d;
  }

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) { /* private browsing: ignore */ }
    return null;
  }

  // fetch() with a timeout (AbortController is missing on older iPhones).
  function getJSON(url) {
    var request = fetch(url).then(function (r) {
      if (r.status === 404) return { value: 0 };
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    var timeout = new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_MS);
    });
    return Promise.race([request, timeout]);
  }

  function counterUrl(action, kind, day) {
    return COUNTER_URL + '/' + action + '/' + NAMESPACE + '/' + kind + '-' + day;
  }

  /** Adds 1 to today's count for `kind`, once per device per day. */
  function hitOncePerDay(kind) {
    var day = dayKey();
    var marker = 'qibla.counted.' + kind;
    if (store(marker) === day) return Promise.resolve(null);
    return getJSON(counterUrl('hit', kind, day)).then(function (d) {
      store(marker, day);
      return typeof d.value === 'number' ? d.value : null;
    });
  }

  /** Counts this device as today's visitor. Never throws. */
  function countVisit() {
    return hitOncePerDay('visits').catch(function () { return null; });
  }

  /**
   * Decides if the map may be shown today. Resolves to
   *   { allowed: true|false, count: number|null, limit: number }
   * A device that got the map earlier today keeps it for the rest of the day.
   */
  function checkMap() {
    var day = dayKey();
    if (store('qibla.map.allowed') === day) {
      return Promise.resolve({ allowed: true, count: null, limit: MAP_DAILY_LIMIT });
    }
    return hitOncePerDay('map').then(function (count) {
      if (count === null) {
        // Already counted today but was over the limit then: check again.
        return getJSON(counterUrl('get', 'map', day)).then(function (d) {
          return typeof d.value === 'number' ? d.value : 0;
        });
      }
      return count;
    }).then(function (count) {
      var allowed = count <= MAP_DAILY_LIMIT;
      if (allowed) store('qibla.map.allowed', day);
      return { allowed: allowed, count: count, limit: MAP_DAILY_LIMIT };
    }, function () {
      // Counter unreachable: do not punish the user, show the map.
      return { allowed: true, count: null, limit: MAP_DAILY_LIMIT };
    });
  }

  /** Reads one day's count (for the stats page). Resolves to a number. */
  function getCount(kind, date) {
    return getJSON(counterUrl('get', kind, dayKey(date))).then(function (d) {
      return typeof d.value === 'number' ? d.value : 0;
    });
  }

  root.Usage = {
    MAP_DAILY_LIMIT: MAP_DAILY_LIMIT,
    dayKey: dayKey,
    countVisit: countVisit,
    checkMap: checkMap,
    getCount: getCount
  };
})(this);
