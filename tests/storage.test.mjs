import 'fake-indexeddb/auto';
import { build } from 'esbuild';
import test from 'node:test';
import assert from 'node:assert/strict';
const built = await build({
  entryPoints: ['src/storage.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { appendLocal, mutateLocal, readLocal } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`
);
function local(key, role = 'timer') {
  return {
    key,
    runId: 'test',
    session: {
      id: role,
      uid: 'owner',
      role,
      closed: false,
      lastSeq: 0,
      started: false,
      stopped: false,
      lastElapsedMs: 0,
      finishCount: 0,
    },
    operations: [],
    ack: 0,
    done: false,
    serverClosed: false,
  };
}
test(
  'IndexedDB zachowuje 500 pomiarów bez sieci, z ciągłą numeracją',
  { timeout: 10000 },
  async () => {
    const key = 'offline-timer';
    await mutateLocal(key, () => local(key));
    await appendLocal(key, { kind: 'start', epochMs: Date.now() });
    await Promise.all(
      Array.from({ length: 500 }, (_, i) =>
        appendLocal(key, { kind: 'finish', elapsedMs: (i + 1) * 1000 }),
      ),
    );
    const saved = await readLocal(key);
    assert.equal(saved.operations.length, 501);
    assert.equal(saved.ack, 0);
    assert.equal(saved.session.finishCount, 500);
    assert.equal(saved.startEpoch > 0, true);
    assert.deepEqual(
      saved.operations.map((o) => o.seq),
      Array.from({ length: 501 }, (_, i) => i + 1),
    );
  },
);
test('potwierdzenie serwera podczas dopisywania skanu nie usuwa nowego zapisu', async () => {
  const key = 'scanner';
  await mutateLocal(key, () => local(key, 'scanner'));
  await appendLocal(key, { kind: 'scan', position: 1, participantId: 'abcdefghijklmnop' });
  await Promise.all([
    mutateLocal(key, (p) => ({ ...p, ack: 1 })),
    appendLocal(key, { kind: 'scan', position: 2, participantId: 'qrstuvwxyzABCDEF' }),
  ]);
  const saved = await readLocal(key);
  assert.equal(saved.operations.length, 2);
  assert.equal(saved.ack, 1);
  assert.equal(saved.operations[1].position, 2);
});
test('zamknięcie dziennika blokuje dopisywanie, a błąd zapisu nie zmienia stanu', async () => {
  const key = 'closed';
  await mutateLocal(key, () => local(key, 'scanner'));
  await mutateLocal(key, (p) => ({ ...p, done: true }));
  await assert.rejects(
    appendLocal(key, { kind: 'scan', position: 1, participantId: 'abcdefghijklmnop' }),
  );
  assert.equal((await readLocal(key)).operations.length, 0);
});
