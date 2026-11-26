import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from 'firebase/firestore';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error('Ten test wolno uruchamiać wyłącznie w emulatorach.');
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp: adminApp } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore: adminDb } = require('firebase-admin/firestore');
const admin = adminApp({ projectId: 'demo-harcrun' });
const apps = [];
async function client(name, email) {
  const app = initializeApp(
    { apiKey: 'demo-key', projectId: 'demo-harcrun', appId: 'demo-app' },
    name,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fn = getFunctions(app, 'europe-central2');
  connectFunctionsEmulator(fn, '127.0.0.1', 5001);
  if (email) {
    await adminAuth(admin).createUser({
      email,
      password: 'Emulator-only-123!',
      emailVerified: true,
    });
    await signInWithEmailAndPassword(auth, email, 'Emulator-only-123!');
  }
  return { db, call: async (name, data = {}) => (await httpsCallable(fn, name)(data)).data };
}
test(
  'pełny przepływ: role, idempotencja, publikacja, prywatność i historia po korekcie',
  { timeout: 120000 },
  async () => {
    try {
      const suffix = Date.now();
      const alice = await client(`alice${suffix}`, `alice${suffix}@zhr.pl`);
      const bob = await client(`bob${suffix}`, `bob${suffix}@zhr.pl`);
      const other = await client(`other${suffix}`, `other${suffix}@example.com`);
      const anon = await client(`anon${suffix}`);
      await assert.rejects(
        other.call('saveProfile', { name: 'Obce Konto', publicAcknowledged: true }),
      );
      const p1 = await alice.call('saveProfile', {
        name: 'Alicja Kowalska',
        publicAcknowledged: true,
      });
      const p2 = await bob.call('saveProfile', { name: 'Jan Nowak', publicAcknowledged: true });
      const again = await alice.call('saveProfile', {
        name: 'Alicja Kowalska',
        publicAcknowledged: true,
      });
      assert.equal(again.participantId, p1.participantId);
      const { id: runId } = await alice.call('createRun', {
        name: 'Próba integracyjna',
        date: '2026-11-25',
        distanceKm: 5,
      });
      const timerDevice = 'timer_test';
      const scannerDevice = 'scanner_test';
      await assert.rejects(
        bob.call('openSession', { runId, role: 'scanner', deviceId: scannerDevice }),
      );
      await alice.call('assignVolunteer', { runId, email: p2.email, role: 'scanner' });
      const timer = await alice.call('openSession', {
        runId,
        role: 'timer',
        deviceId: timerDevice,
      });
      const scanner = await bob.call('openSession', {
        runId,
        role: 'scanner',
        deviceId: scannerDevice,
      });
      await assert.rejects(
        alice.call('openSession', { runId, role: 'timer', deviceId: 'other_device' }),
      );
      const timing = [
        { seq: 1, kind: 'start', epochMs: Date.now() },
        { seq: 2, kind: 'finish', elapsedMs: 1000 },
        { seq: 3, kind: 'finish', elapsedMs: 2000 },
        { seq: 4, kind: 'stop', elapsedMs: 3000 },
      ];
      const timerPayload = {
        runId,
        sessionId: timer.id,
        deviceId: timerDevice,
        operations: timing,
      };
      assert.equal((await alice.call('syncOperations', timerPayload)).lastSeq, 4);
      assert.equal((await alice.call('syncOperations', timerPayload)).lastSeq, 4);
      assert.equal((await adminDb(admin).collection(`runs/${runId}/operations`).get()).size, 4);
      await assert.rejects(
        bob.call('closeSession', {
          runId,
          sessionId: scanner.id,
          deviceId: scannerDevice,
          lastSeq: 2,
        }),
      );
      const scanPayload = {
        runId,
        sessionId: scanner.id,
        deviceId: scannerDevice,
        operations: [
          { seq: 1, kind: 'scan', position: 2, participantId: p2.participantId },
          { seq: 2, kind: 'scan', position: 1, participantId: p1.participantId },
        ],
      };
      await bob.call('syncOperations', scanPayload);
      await bob.call('syncOperations', scanPayload);
      let preview = await alice.call('previewResults', { runId });
      assert.ok(preview.issues.length > 0);
      await assert.rejects(alice.call('publishResults', { runId, revision: preview.run.revision }));
      await assert.rejects(bob.call('previewResults', { runId }));
      await alice.call('closeSession', {
        runId,
        sessionId: timer.id,
        deviceId: timerDevice,
        lastSeq: 4,
      });
      await bob.call('closeSession', {
        runId,
        sessionId: scanner.id,
        deviceId: scannerDevice,
        lastSeq: 2,
      });
      preview = await alice.call('previewResults', { runId });
      assert.deepEqual(preview.issues, []);
      assert.equal(preview.rows[0].name, p1.name);
      await assert.rejects(
        alice.call('publishResults', { runId, revision: preview.run.revision - 1 }),
      );
      assert.equal(
        (await alice.call('publishResults', { runId, revision: preview.run.revision })).version,
        1,
      );
      const published = await getDoc(doc(anon.db, 'publicRuns', runId));
      const firstVersion = published.get('activeVersion');
      const snapshot = await getDoc(doc(anon.db, 'publicRuns', runId, 'versions', firstVersion));
      const rows = snapshot.get('rows');
      assert.equal(rows.length, 2);
      assert.deepEqual(Object.keys(rows[0]).sort(), ['elapsedMs', 'name', 'position']);
      await assert.rejects(getDoc(doc(anon.db, 'runs', runId)));
      assert.equal((await alice.call('listHistory')).length, 1);
      assert.equal((await bob.call('listHistory')).length, 1);
      preview = await alice.call('previewResults', { runId });
      await alice.call('saveCorrections', {
        runId,
        revision: preview.run.revision,
        corrections: [{ kind: 'setPair', position: 2, participantId: null }],
        clockReviewed: false,
      });
      preview = await alice.call('previewResults', { runId });
      assert.deepEqual(preview.issues, []);
      assert.equal(
        (await alice.call('publishResults', { runId, revision: preview.run.revision })).version,
        2,
      );
      assert.equal((await alice.call('listHistory')).length, 1);
      assert.equal((await bob.call('listHistory')).length, 0);
      await assert.rejects(getDoc(doc(anon.db, 'publicRuns', runId, 'versions', firstVersion)));
      await assert.rejects(
        bob.call('syncOperations', {
          ...scanPayload,
          operations: [{ seq: 3, kind: 'scan', position: 3, participantId: p2.participantId }],
        }),
      );
    } finally {
      await Promise.all(apps.map(deleteApp));
    }
  },
);
