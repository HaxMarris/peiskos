import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { parseCertList } from '../src/app-links.ts';
import { listening } from './helpers.ts';

const cert = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');
const app = createApp({
  db: openDb(':memory:'),
  publicDir: '/nonexistent',
  appLinks: { appleAppId: 'TEAM123456.app.peiskos', androidPackage: 'app.peiskos', androidCerts: parseCertList(`${cert}, not-a-cert`) },
});
let base = '';
listening(app, (b) => { base = b; });

test('the phones can check that the apps may open invite links', async () => {
  const apple = await fetch(`${base}/.well-known/apple-app-site-association`);
  assert.equal(apple.status, 200);
  assert.match(apple.headers.get('content-type')!, /application\/json/);
  assert.deepEqual(await apple.json(), { applinks: { details: [{ appIDs: ['TEAM123456.app.peiskos'], components: [{ '/': '/invite/*' }] }] } });

  const android = await fetch(`${base}/.well-known/assetlinks.json`);
  assert.equal(android.status, 200);
  const [entry] = await android.json();
  assert.equal(entry.target.package_name, 'app.peiskos');
  assert.deepEqual(entry.target.sha256_cert_fingerprints, [cert.toUpperCase()]);
});

test('without them set up, neither file is there', async () => {
  const bare = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', appLinks: { androidPackage: 'app.peiskos', androidCerts: [] } });
  await new Promise<void>((r) => bare.listen(0, r));
  const port = (bare.address() as { port: number }).port;
  try {
    for (const path of ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json']) {
      const res = await fetch(`http://localhost:${port}${path}`);
      assert.equal(res.status, 404, path);
    }
  } finally {
    bare.closeAllConnections();
    bare.close();
  }
});
