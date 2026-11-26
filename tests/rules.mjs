import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-harcrun',
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'profiles/alice'), { name: 'Alicja', email: 'a@zhr.pl' }),
      setDoc(doc(db, 'runs/a'), { ownerUid: 'alice', memberUids: ['alice', 'bob'] }),
      setDoc(doc(db, 'runs/b'), { ownerUid: 'charlie', memberUids: ['charlie'] }),
      setDoc(doc(db, 'runs/a/sessions/timer'), { uid: 'alice' }),
      setDoc(doc(db, 'runs/a/operations/timer_1'), { kind: 'start' }),
      setDoc(doc(db, 'participantCodes/abcdefghijklmnop'), { uid: 'alice' }),
      setDoc(doc(db, 'publicRuns/a'), { name: 'Bieg', activeVersion: 'v2' }),
      setDoc(doc(db, 'publicRuns/a/versions/v1'), { rows: [] }),
      setDoc(doc(db, 'publicRuns/a/versions/v2'), { rows: [] }),
    ]);
  });
});
after(async () => {
  await env?.cleanup();
});
const user = (uid, email = `${uid}@zhr.pl`, verified = true) =>
  env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
test('anonimowy widzi wyłącznie publiczną aktywną wersję', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(collection(db, 'publicRuns')));
  await assertSucceeds(getDoc(doc(db, 'publicRuns/a/versions/v2')));
  await assertFails(getDoc(doc(db, 'publicRuns/a/versions/v1')));
  await assertFails(getDoc(doc(db, 'runs/a')));
  await assertFails(getDoc(doc(db, 'profiles/alice')));
});
test('domena i weryfikacja adresu są wymagane', async () => {
  for (const db of [
    user('alice', 'alice@example.com'),
    user('alice', 'alice@fakezhr.pl'),
    user('alice', 'alice@sub.zhr.pl'),
    user('alice', 'alice@zhr.pl', false),
  ])
    await assertFails(getDoc(doc(db, 'runs/a')));
  await assertSucceeds(getDoc(doc(user('alice', 'ALICE@ZHR.PL'), 'runs/a')));
});
test('członkostwo ogranicza biegi, odczyt profilu i sesje', async () => {
  const db = user('bob');
  await assertSucceeds(getDoc(doc(db, 'runs/a')));
  await assertSucceeds(getDoc(doc(db, 'runs/a/sessions/timer')));
  await assertFails(getDoc(doc(db, 'runs/b')));
  await assertFails(getDoc(doc(db, 'profiles/alice')));
  await assertSucceeds(
    getDocs(query(collection(db, 'runs'), where('memberUids', 'array-contains', 'bob'))),
  );
  await assertFails(getDocs(collection(db, 'runs')));
  await assertSucceeds(getDoc(doc(user('alice'), 'profiles/alice')));
});
test('zapisy klienta i surowe operacje są zablokowane', async () => {
  const db = user('alice');
  for (const path of [
    'runs/a',
    'profiles/alice',
    'publicRuns/a',
    'runs/a/sessions/timer',
    'participantCodes/abcdefghijklmnop',
  ])
    await assertFails(setDoc(doc(db, path), { evil: true }));
  await assertFails(getDoc(doc(db, 'participantCodes/abcdefghijklmnop')));
  await assertFails(getDoc(doc(db, 'runs/a/operations/timer_1')));
});
