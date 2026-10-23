// Talks to App Store Connect for the release workflows, with the API key in the APP_STORE_CONNECT_*
// and APPLE_TEAM_ID secrets. It never prints the key.
//
//   node app-store.mjs check                    says which secret looks wrong, or that the key works
//   node app-store.mjs submit <version> <build> waits for Apple to process that build, adds it to the
//                                               external TestFlight groups and sends it for review;
//                                               prints the build's id
//   node app-store.mjs status <build id>        prints approved, rejected or waiting
import crypto from 'node:crypto';
import { appendFileSync } from 'node:fs';

const { ASC_KEY: key = '', ASC_KEY_ID: keyId = '', ASC_ISSUER_ID: issuer = '', TEAM_ID: team = '' } = process.env;
const BUNDLE_ID = 'app.peiskos';
const fail = (msg) => { console.log(`::error::${msg}`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkSecrets() {
  const pem = key.trim().replace(/\r/g, '');
  if (!/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/.test(pem))
    fail('APP_STORE_CONNECT_KEY should be the whole .p8 file, including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines.');
  if (!/^[A-Z0-9]{10}$/.test(keyId.trim())) fail('APP_STORE_CONNECT_KEY_ID should be the 10-character Key ID (letters and digits), like 2X9R4HXF34.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuer.trim())) fail('APP_STORE_CONNECT_ISSUER_ID should be the Issuer ID shown above the keys list, like 57246542-96fe-1a63-e053-0824d011072a.');
  if (process.argv[2] === 'check' && !/^[A-Z0-9]{10}$/.test(team.trim())) fail('APPLE_TEAM_ID should be the 10-character Team ID from Membership details.');
  try { return crypto.createPrivateKey(pem); } catch { fail("APP_STORE_CONNECT_KEY isn't a readable .p8 key. Copy the whole file again from Notepad."); }
}

const privateKey = checkSecrets();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: 'ES256', kid: keyId.trim(), typ: 'JWT' })}.${b64({ iss: issuer.trim(), iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  return `${head}.${crypto.sign('sha256', Buffer.from(head), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

/** One App Store Connect request. Returns the parsed body, or { status } for the codes in `ok`. */
async function api(path, { method = 'GET', body, ok = [] } = {}) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (ok.includes(r.status)) return { status: r.status };
  if (r.status === 401) fail("Apple turned the key down (401). Check that APP_STORE_CONNECT_KEY_ID and APP_STORE_CONNECT_ISSUER_ID belong to this .p8 file, and that it's a Team key (not an Individual key) that hasn't been revoked.");
  if (r.status === 403) fail('Apple says the key may not do this (403). Make it a Team key with Admin access, and accept any new agreements in App Store Connect.');
  if (!r.ok) fail(`App Store Connect answered ${r.status} to ${method} ${path.split('?')[0]}: ${(await r.text()).slice(0, 500)}`);
  return r.status === 204 ? {} : r.json();
}

async function theApp() {
  const { data } = await api(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  if (!data.length) fail(`The key works, but App Store Connect has no app with the bundle ID ${BUNDLE_ID} yet. Create it (Apps, +, New App) first.`);
  return data[0];
}

async function submit(version, buildNumber) {
  const app = await theApp();
  // Apple takes a while to process an upload before anything can be done with it.
  let build;
  for (let tries = 0; tries < 120; tries++) {
    const { data } = await api(`/v1/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(buildNumber)}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&limit=1`);
    build = data[0];
    const state = build?.attributes.processingState;
    if (state === 'VALID') break;
    if (state === 'FAILED' || state === 'INVALID') fail(`Apple couldn't process build ${version} (${buildNumber}): ${state}. App Store Connect's TestFlight page says why.`);
    console.log(build ? `Apple is processing build ${version} (${buildNumber})…` : `Waiting for build ${version} (${buildNumber}) to show up in App Store Connect…`);
    await sleep(30_000);
  }
  if (build?.attributes.processingState !== 'VALID') fail(`Apple was still processing build ${version} (${buildNumber}) after an hour. Run "Finish release" with this release's tag once it shows in TestFlight.`);
  console.log(`Build ${version} (${buildNumber}) is processed.`);

  // What testers see under "What to Test".
  const notes = process.env.WHATS_NEW || `Peiskos ${version}`;
  const { data: locs } = await api(`/v1/builds/${build.id}/betaBuildLocalizations`);
  const loc = locs.find((l) => l.attributes.locale.startsWith('en')) ?? locs[0];
  if (loc) await api(`/v1/betaBuildLocalizations/${loc.id}`, { method: 'PATCH', body: { data: { type: 'betaBuildLocalizations', id: loc.id, attributes: { whatsNew: notes } } } });
  else await api('/v1/betaBuildLocalizations', { method: 'POST', body: { data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-US', whatsNew: notes }, relationships: { build: { data: { type: 'builds', id: build.id } } } } } });

  // Friends get it through the external groups, which is what Apple reviews.
  const { data: groups } = await api(`/v1/apps/${app.id}/betaGroups?filter[isInternalGroup]=false&limit=50`);
  if (!groups.length) {
    console.log('There is no external TestFlight group yet, so nothing needs Apple\'s review. Internal testers already have the build.');
    return { id: build.id, review: false };
  }
  for (const g of groups) {
    await api(`/v1/betaGroups/${g.id}/relationships/builds`, { method: 'POST', body: { data: [{ type: 'builds', id: build.id }] } });
    console.log(`Added the build to the "${g.attributes.name}" group.`);
  }
  // 409: already submitted, or Apple let it through without a new review.
  const sent = await api('/v1/betaAppReviewSubmissions', { method: 'POST', body: { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } } }, ok: [409] });
  console.log(sent.status === 409 ? 'Apple already has this build for review (or needs none).' : 'Sent the build to Apple for TestFlight review.');
  return { id: build.id, review: true };
}

async function status(buildId) {
  const { data } = await api(`/v1/builds/${buildId}/buildBetaDetail`);
  const state = data.attributes.externalBuildState;
  if (['BETA_APPROVED', 'READY_FOR_BETA_TESTING', 'IN_BETA_TESTING'].includes(state)) return 'approved';
  if (['BETA_REJECTED', 'PROCESSING_EXCEPTION', 'MISSING_EXPORT_COMPLIANCE', 'EXPIRED'].includes(state)) return `rejected (${state})`;
  return `waiting (${state})`;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'check') {
  const app = await theApp();
  console.log(`The key works, and App Store Connect has ${app.attributes.name}.`);
} else if (cmd === 'submit') {
  const { id, review } = await submit(args[0], args[1]);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `build_id=${id}\nreview=${review}\n`);
  console.log(id);
} else if (cmd === 'status') {
  console.log(await status(args[0]));
} else fail(`Unknown command ${cmd}`);
