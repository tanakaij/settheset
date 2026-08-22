/* IndexedDB wrapper for two stores: songs (library) and setlists (services).
   Not localStorage — arrangements and role lists grow, and localStorage is
   synchronous, ~5 MB, and evicted first under storage pressure. */
(function (global) {
  'use strict';

  var DB_NAME = 'sundayset';
  var DB_VERSION = 2;   // 2 added the 'meta' store for first-run state
  var STORES = ['songs', 'setlists', 'meta'];
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var req = fn(t.objectStore(store));
        t.oncomplete = function () { resolve(req && 'result' in req ? req.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function newId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  global.DB = {
    put: function (store, rec) {
      if (!rec.id) rec.id = newId();
      rec.updatedAt = Date.now();
      return tx(store, 'readwrite', function (s) { return s.put(rec); })
        .then(function () { return rec; });
    },
    get: function (store, id) {
      return tx(store, 'readonly', function (s) { return s.get(id); });
    },
    all: function (store) {
      return tx(store, 'readonly', function (s) { return s.getAll(); })
        .then(function (rows) { return rows || []; });
    },
    remove: function (store, id) {
      return tx(store, 'readwrite', function (s) { return s.delete(id); });
    },

    /* Small key/value helpers over the meta store, for things like "has this
       person seen the welcome". Kept in IndexedDB rather than localStorage so
       there is one storage mechanism to reason about, and one thing to clear. */
    flag: function (key) {
      return tx('meta', 'readonly', function (s) { return s.get(key); })
        .then(function (row) { return row ? row.value : null; });
    },
    setFlag: function (key, value) {
      return tx('meta', 'readwrite', function (s) { return s.put({ id: key, value: value }); });
    },

    newId: newId
  };
})(window);
