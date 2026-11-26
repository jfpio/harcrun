import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
test('service worker zachowuje aplikację offline i nie buforuje danych API', async () => {
  const events = {};
  const cache = new Map();
  let online = true;
  const requestUrl = (request) => (typeof request === 'string' ? request : request.url);
  const source = (await readFile('public/sw.js', 'utf8')).replace(
    'const PRECACHE = [];',
    'const PRECACHE = ["/assets/app.js", "/assets/font.woff2"];',
  );
  runInNewContext(source, {
    URL,
    Response,
    self: {
      location: { origin: 'https://harcrun.test' },
      clients: { claim: async () => {} },
      addEventListener: (name, callback) => {
        events[name] = callback;
      },
    },
    caches: {
      open: async () => ({
        addAll: async (items) => {
          for (const item of items) cache.set(item, new Response(item));
        },
        put: async (key, value) => cache.set(key, value),
        match: async (request) =>
          cache.get(new URL(requestUrl(request), 'https://harcrun.test').pathname)?.clone(),
      }),
      keys: async () => [],
      delete: async () => {},
    },
    fetch: async (request) => {
      if (!online) throw new Error('offline');
      return new Response(requestUrl(request) === '/index.html' ? '<html>HarcRun</html>' : 'asset');
    },
  });
  let install;
  events.install({
    waitUntil: (promise) => {
      install = promise;
    },
  });
  await install;
  assert.ok(cache.has('/assets/app.js'));
  assert.ok(cache.has('/assets/font.woff2'));
  online = false;
  let navigation;
  events.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://harcrun.test/biegi/test/stoper' },
    respondWith: (p) => {
      navigation = p;
    },
  });
  assert.equal(await (await navigation).text(), '<html>HarcRun</html>');
  let asset;
  events.fetch({
    request: { method: 'GET', mode: 'cors', url: 'https://harcrun.test/assets/app.js' },
    respondWith: (p) => {
      asset = p;
    },
  });
  assert.equal(await (await asset).text(), '/assets/app.js');
  let intercepted = false;
  events.fetch({
    request: { method: 'GET', mode: 'cors', url: 'https://firestore.googleapis.com/private-data' },
    respondWith: () => {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false);
  events.fetch({
    request: { method: 'POST', mode: 'cors', url: 'https://harcrun.test/api' },
    respondWith: () => {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false);
});
