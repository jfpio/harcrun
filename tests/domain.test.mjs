import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceSession,
  formatTime,
  isZhrEmail,
  parseCode,
  parseTime,
  reconcile,
  validateBody,
  validateCorrections,
} from '../functions/lib/shared/domain.js';
const alice = 'abcdefghijklmnop',
  bob = 'qrstuvwxyzABCDEF';
const people = { [alice]: 'Alicja Kowalska', [bob]: 'Jan Nowak' };
const finish = (seq, elapsedMs) => ({
  kind: 'finish',
  seq,
  elapsedMs,
  sessionId: 'timer',
  role: 'timer',
});
const scan = (seq, position, participantId, sessionId = 'scanner_a') => ({
  kind: 'scan',
  seq,
  position,
  participantId,
  sessionId,
  role: 'scanner',
});
const timer = () => ({
  id: 'timer',
  uid: 'a',
  role: 'timer',
  closed: false,
  lastSeq: 0,
  started: false,
  stopped: false,
  lastElapsedMs: 0,
  finishCount: 0,
});
test('domena jest dokładna, adresy podobne i subdomeny są odrzucane', () => {
  for (const email of ['a@zhr.pl', 'A@ZHR.PL']) assert.equal(isZhrEmail(email), true);
  for (const email of ['a@fakezhr.pl', 'a@zhr.pl.evil', 'a@sub.zhr.pl', 'a@@zhr.pl', 'a @zhr.pl'])
    assert.equal(isZhrEmail(email), false);
});
test('QR rozróżnia token i uczestnika oraz odrzuca obce formaty', () => {
  assert.deepEqual(parseCode(`HR1:P:${alice}`), { type: 'participant', id: alice });
  assert.deepEqual(parseCode('HR1:F:500'), { type: 'finish', position: 500 });
  for (const value of [
    'HR1:F:0',
    'HR1:F:501',
    'HR1:F:01',
    'HR1:P:a',
    'https://evil.test',
    'HR1:F:1extra',
  ])
    assert.equal(parseCode(value), null);
});
test('format i parser czasu obsługują godziny i walidują sekundy', () => {
  assert.equal(formatTime(3599999), '59:59');
  assert.equal(formatTime(3600000), '1:00:00');
  assert.equal(parseTime('25:03'), 1503000);
  assert.equal(parseTime('1:02:03'), 3723000);
  assert.throws(() => parseTime('1:99'));
  assert.throws(() => parseTime('-1:10'));
});
test('pomiar wymaga startu, rosnącego czasu i jednego zakończenia', () => {
  assert.throws(() => advanceSession(timer(), { kind: 'finish', elapsedMs: 1 }));
  let s = advanceSession(timer(), { kind: 'start', epochMs: 123456 });
  assert.throws(() => advanceSession(s, { kind: 'start', epochMs: 123456 }));
  s = advanceSession(s, { kind: 'finish', elapsedMs: 100 });
  assert.equal(s.finishCount, 1);
  assert.throws(() => advanceSession(s, { kind: 'finish', elapsedMs: 99 }));
  s = advanceSession(s, { kind: 'stop', elapsedMs: 100 });
  assert.equal(s.stopped, true);
  assert.throws(() => advanceSession(s, { kind: 'finish', elapsedMs: 101 }));
});
test('role i zamknięcie sesji ograniczają operacje', () => {
  assert.throws(() => advanceSession(timer(), { kind: 'scan', position: 1, participantId: alice }));
  assert.throws(() =>
    advanceSession({ ...timer(), role: 'scanner' }, { kind: 'start', epochMs: 1 }),
  );
  assert.throws(() => advanceSession({ ...timer(), closed: true }, { kind: 'start', epochMs: 1 }));
});
test('walidacja odrzuca niepoprawne i nadmierne dane', () => {
  assert.throws(() => validateBody({ kind: 'finish', elapsedMs: -1 }));
  assert.throws(() => validateBody({ kind: 'scan', position: 501, participantId: alice }));
  assert.throws(() =>
    validateCorrections([{ kind: 'setPair', position: 0, participantId: alice }]),
  );
  assert.throws(() => validateCorrections([{ kind: 'setTime', position: 1, elapsedMs: NaN }]));
  assert.deepEqual(
    validateBody({ kind: 'scan', position: 1, participantId: alice, role: 'timer', uid: 'evil' }),
    { kind: 'scan', position: 1, participantId: alice },
  );
});
test('łączy według numerów miejsc niezależnie od kolejności skanowania', () => {
  const result = reconcile(
    [finish(3, 2000), scan(1, 2, bob), finish(2, 1000), scan(2, 1, alice)],
    [],
    people,
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.rows.map((r) => r.name),
    ['Alicja Kowalska', 'Jan Nowak'],
  );
});
test('wielokrotne zeskanowanie tej samej pary jest nieszkodliwe', () => {
  assert.deepEqual(
    reconcile([finish(2, 1000), scan(1, 1, alice), scan(1, 1, alice, 'scanner_b')], [], people)
      .issues,
    [],
  );
});
test('sprzeczne przypisania wielu skanerów blokują publikację', () => {
  const ops = [finish(2, 1000), scan(1, 1, alice), scan(1, 1, bob, 'scanner_b')];
  assert.match(reconcile(ops, [], people).issues.join(' '), /sprzeczne/);
  assert.deepEqual(
    reconcile(ops, [{ kind: 'setPair', position: 1, participantId: bob }], people).issues,
    [],
  );
});
test('jedna osoba na wielu miejscach wymaga korekty', () => {
  const ops = [finish(2, 1000), finish(3, 2000), scan(1, 1, alice), scan(2, 2, alice)];
  assert.match(reconcile(ops, [], people).issues.join(' '), /więcej niż raz/);
  const fixed = reconcile(ops, [{ kind: 'setPair', position: 2, participantId: null }], people);
  assert.deepEqual(fixed.issues, []);
  assert.equal(fixed.rows[1].name, 'Nieznany uczestnik');
});
test('skan bez czasu i nieznany kod są raportowane', () => {
  assert.match(
    reconcile([finish(2, 1000), scan(1, 2, alice)], [], people).issues.join(' '),
    /skan bez/,
  );
  assert.match(
    reconcile([finish(2, 1000), scan(1, 1, alice)], [], {}).issues.join(' '),
    /nieznany kod/,
  );
});
test('usunięcie pomiaru przesuwa czasy, ale zachowuje tokeny', () => {
  const result = reconcile(
    [finish(2, 10), finish(3, 1000), finish(4, 2000), scan(1, 1, alice), scan(2, 2, bob)],
    [{ kind: 'removeTime', position: 1 }],
    people,
  );
  assert.deepEqual(
    result.rows.map((r) => [r.elapsedMs, r.name]),
    [
      [1000, 'Alicja Kowalska'],
      [2000, 'Jan Nowak'],
    ],
  );
  assert.deepEqual(result.issues, []);
});
test('dodanie i poprawienie pomiaru oraz błędna korekta', () => {
  const result = reconcile(
    [finish(2, 2000)],
    [
      { kind: 'insertTime', position: 1, elapsedMs: 1000 },
      { kind: 'setTime', position: 2, elapsedMs: 3000 },
    ],
    people,
  );
  assert.deepEqual(
    result.rows.map((r) => r.elapsedMs),
    [1000, 3000],
  );
  assert.deepEqual(result.issues, []);
  assert.match(
    reconcile([], [{ kind: 'removeTime', position: 3 }], people).issues.join(' '),
    /brak pomiaru/,
  );
});
test('czasy malejące po korekcie i puste wyniki blokują publikację', () => {
  assert.match(
    reconcile(
      [finish(2, 1000), finish(3, 2000)],
      [{ kind: 'setTime', position: 2, elapsedMs: 10 }],
      people,
    ).issues.join(' '),
    /wcześniejszy/,
  );
  assert.match(reconcile([], [], people).issues.join(' '), /Brak czasów/);
});
test('500 finiszów i trzy skanery: kompletna tabela oraz limit stopera', () => {
  let session = advanceSession(timer(), { kind: 'start', epochMs: 123456 });
  const operations = [];
  const names = {};
  for (let i = 1; i <= 500; i++) {
    const id = `runner${String(i).padStart(10, '0')}`;
    names[id] = `Uczestnik ${i}`;
    session = advanceSession(session, { kind: 'finish', elapsedMs: i * 1000 });
    operations.push(finish(i + 1, i * 1000), scan(i, i, id, `scanner_${i % 3}`));
  }
  assert.throws(() => advanceSession(session, { kind: 'finish', elapsedMs: 501000 }));
  const result = reconcile(operations.reverse(), [], names);
  assert.equal(result.rows.length, 500);
  assert.deepEqual(result.issues, []);
  assert.equal(result.rows[499].name, 'Uczestnik 500');
});
