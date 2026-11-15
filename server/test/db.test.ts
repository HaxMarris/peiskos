import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, openDb, runMigrations } from '../src/db.ts';

const version = (db: ReturnType<typeof openDb>) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

test('a new database has had every numbered change', () => {
  assert.equal(version(openDb(':memory:')), MIGRATIONS.length);
});

test('numbered changes run once each, in order, and a failed one changes nothing', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'peiskos-db-')), 'db.sqlite');
  const db = openDb(file);
  const ran: number[] = [];
  const steps = [
    ...MIGRATIONS,
    { why: 'a table', run: (d: typeof db) => { ran.push(1); d.exec('CREATE TABLE extra (x INTEGER)'); } },
    { why: 'a row', run: (d: typeof db) => { ran.push(2); d.exec('INSERT INTO extra VALUES (1)'); } },
  ];
  runMigrations(db, steps);
  runMigrations(db, steps);
  assert.deepEqual(ran, [1, 2]);
  assert.equal(version(db), steps.length);

  const broken = [...steps, { why: 'half done', run: (d: typeof db) => { d.exec('INSERT INTO extra VALUES (2)'); throw new Error('boom'); } }];
  assert.throws(() => runMigrations(db, broken), /boom/);
  assert.equal(version(db), steps.length);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM extra').get() as { n: number }).n, 1);
  db.close();
  // Opening it again with the shipped list leaves the extra steps' work alone.
  assert.equal(version(openDb(file)), steps.length);
});
