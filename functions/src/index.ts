import { randomBytes, randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import {
  advanceSession,
  isZhrEmail,
  reconcile,
  validateBody,
  validateCorrections,
  type DeviceSession,
  type Operation,
  type Run,
  type Profile,
  type Role,
} from '../../shared/domain.js';
initializeApp();
// Callable endpoints accept browser traffic; identity() checks Firebase Auth and @zhr.pl.
setGlobalOptions({ region: 'europe-central2', maxInstances: 10, invoker: 'public' });
const db = getFirestore();
function identity(req: CallableRequest) {
  if (
    !req.auth ||
    req.auth.token.email_verified !== true ||
    !isZhrEmail(String(req.auth.token.email ?? ''))
  )
    throw new HttpsError('permission-denied', 'Wymagane zweryfikowane konto @zhr.pl.');
  return { uid: req.auth.uid, email: String(req.auth.token.email).toLowerCase() };
}
const callable = (handler: (req: CallableRequest<any>) => Promise<unknown>) =>
  onCall(async (req) => {
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof Error) throw new HttpsError('failed-precondition', error.message);
      throw new HttpsError('internal', 'Nie udało się wykonać operacji.');
    }
  });
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value))
    throw new HttpsError('invalid-argument', 'Niepoprawny identyfikator.');
  return value;
}
function owner(run: any, uid: string) {
  if (run.ownerUid !== uid)
    throw new HttpsError('permission-denied', 'Tylko koordynator może wykonać tę operację.');
}
function member(run: any, uid: string) {
  if (!run.memberUids.includes(uid))
    throw new HttpsError('permission-denied', 'Nie jesteś wolontariuszem tego biegu.');
}
function getRunData(snapshot: FirebaseFirestore.DocumentSnapshot) {
  if (!snapshot.exists) throw new HttpsError('not-found', 'Nie znaleziono biegu.');
  return snapshot.data()!;
}
function fields(data: any, requireName = false) {
  const name = String(data.name ?? '').trim();
  const date = String(data.date ?? '');
  const distanceKm = Number(data.distanceKm);
  if (name.length > 120 || (requireName && !name))
    throw new Error('Podaj nazwę biegu (do 120 znaków).');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error('Podaj poprawną datę.');
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 200)
    throw new Error('Dystans musi wynosić od 0 do 200 km (bez zera).');
  return { name: name || 'Bieg bez nazwy', date, distanceKm };
}
export const saveProfile = callable(async (req) => {
  const { uid, email } = identity(req);
  const name = String(req.data.name ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 100 || req.data.publicAcknowledged !== true)
    throw new Error('Podaj imię i nazwisko oraz potwierdź informację o publicznych wynikach.');
  const ref = db.doc(`profiles/${uid}`);
  const generated = randomBytes(12).toString('base64url');
  return db.runTransaction(async (tx) => {
    const previous = await tx.get(ref);
    const participantId = previous.get('participantId') ?? generated;
    const profile = { uid, email, name, participantId };
    tx.set(ref, { ...profile, publicAcknowledgedAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`participantCodes/${participantId}`), { uid, name });
    return profile;
  });
});
export const createRun = callable(async (req) => {
  const { uid } = identity(req);
  const profile = await db.doc(`profiles/${uid}`).get();
  if (!profile.exists) throw new Error('Najpierw uzupełnij profil.');
  const ref = db.collection('runs').doc();
  await ref.set({
    ...fields(req.data),
    ownerUid: uid,
    memberUids: [uid],
    assignments: { [uid]: ['timer', 'scanner'] },
    volunteers: {
      [uid]: {
        name: profile.get('name'),
        email: profile.get('email'),
        roles: ['timer', 'scanner'],
      },
    },
    status: 'draft',
    revision: 0,
    version: 0,
    corrections: [],
    clockReviewed: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id };
});
export const updateRun = callable(async (req) => {
  const { uid } = identity(req);
  const ref = db.doc(`runs/${id(req.data.runId)}`);
  return db.runTransaction(async (tx) => {
    const run = getRunData(await tx.get(ref));
    owner(run, uid);
    tx.update(ref, { ...fields(req.data), revision: run.revision + 1 });
    return { ok: true };
  });
});
export const assignVolunteer = callable(async (req) => {
  const { uid } = identity(req);
  const email = String(req.data.email ?? '')
    .trim()
    .toLowerCase();
  if (!isZhrEmail(email) || !['timer', 'scanner'].includes(req.data.role))
    throw new Error('Podaj adres @zhr.pl i funkcję.');
  const role = req.data.role as Role;
  let user;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch {
    throw new Error('Ta osoba musi najpierw zalogować się i utworzyć profil w HarcRun.');
  }
  const profile = await db.doc(`profiles/${user.uid}`).get();
  if (!profile.exists || !user.emailVerified)
    throw new Error('Ta osoba musi najpierw utworzyć profil.');
  const ref = db.doc(`runs/${id(req.data.runId)}`);
  await db.runTransaction(async (tx) => {
    const run = getRunData(await tx.get(ref));
    owner(run, uid);
    if (run.status !== 'draft') throw new Error('Nie można zmieniać obsady opublikowanego biegu.');
    const assignments = { ...run.assignments };
    assignments[user.uid] = [...new Set([...(assignments[user.uid] ?? []), role])];
    tx.update(ref, {
      assignments,
      memberUids: [...new Set([...run.memberUids, user.uid])],
      volunteers: {
        ...run.volunteers,
        [user.uid]: { email, name: profile.get('name'), roles: assignments[user.uid] },
      },
      revision: run.revision + 1,
    });
  });
  return { ok: true };
});
export const openSession = callable(async (req) => {
  const { uid } = identity(req);
  const runId = id(req.data.runId);
  const role = req.data.role as Role;
  if (!['timer', 'scanner'].includes(role)) throw new Error('Niepoprawna funkcja.');
  const runRef = db.doc(`runs/${runId}`);
  // One scanner session per volunteer, one timer for the entire event.
  const ref = runRef.collection('sessions').doc(role === 'timer' ? 'timer' : `scanner_${uid}`);
  const deviceId = id(req.data.deviceId);
  return db.runTransaction(async (tx) => {
    const run = getRunData(await tx.get(runRef));
    const existing = await tx.get(ref);
    member(run, uid);
    if (run.status !== 'draft' || !run.assignments[uid]?.includes(role))
      throw new HttpsError('permission-denied', 'Brak uprawnień do tej funkcji.');
    if (existing.exists) {
      if (existing.get('uid') !== uid || existing.get('deviceId') !== deviceId)
        throw new Error(
          'Ta funkcja jest już przypisana do innego urządzenia. Wróć na przygotowany telefon.',
        );
      return { id: ref.id, ...existing.data() };
    }
    const session = {
      id: ref.id,
      uid,
      role,
      closed: false,
      lastSeq: 0,
      started: false,
      stopped: false,
      lastElapsedMs: 0,
      finishCount: 0,
      deviceId,
    };
    tx.set(ref, session);
    tx.update(runRef, { revision: run.revision + 1 });
    return session;
  });
});
export const syncOperations = callable(async (req) => {
  const { uid } = identity(req);
  const runRef = db.doc(`runs/${id(req.data.runId)}`);
  const sessionId = id(req.data.sessionId);
  const sessionRef = runRef.collection('sessions').doc(sessionId);
  if (!Array.isArray(req.data.operations) || req.data.operations.length > 100)
    throw new Error('Niepoprawna paczka operacji.');
  const incoming = req.data.operations.map((raw: any) => {
    if (!Number.isInteger(raw.seq) || raw.seq < 1 || raw.seq > 10000)
      throw new Error('Niepoprawny numer operacji.');
    return { seq: raw.seq, ...validateBody(raw) };
  });
  return db.runTransaction(async (tx) => {
    const run = getRunData(await tx.get(runRef));
    const snapshot = await tx.get(sessionRef);
    member(run, uid);
    if (
      !snapshot.exists ||
      snapshot.get('uid') !== uid ||
      snapshot.get('deviceId') !== req.data.deviceId
    )
      throw new HttpsError('permission-denied', 'Nieprawidłowe urządzenie lub sesja.');
    let session = snapshot.data() as DeviceSession;
    let count = 0;
    for (const raw of incoming) {
      if (raw.seq <= session.lastSeq) continue; // Already committed; retries after a lost response are safe.
      if (run.status !== 'draft') throw new Error('Bieg został już opublikowany.');
      if (raw.seq !== session.lastSeq + 1) throw new Error('Brakuje wcześniejszej operacji.');
      session = advanceSession(session, raw);
      session.lastSeq = raw.seq;
      count++;
      tx.create(runRef.collection('operations').doc(`${sessionId}_${raw.seq}`), {
        ...raw,
        sessionId,
        role: session.role,
      });
    }
    if (count) {
      tx.update(sessionRef, { ...session });
      tx.update(runRef, { revision: run.revision + 1 });
    }
    return { lastSeq: session.lastSeq };
  });
});
export const closeSession = callable(async (req) => {
  const { uid } = identity(req);
  const runRef = db.doc(`runs/${id(req.data.runId)}`);
  const ref = runRef.collection('sessions').doc(id(req.data.sessionId));
  return db.runTransaction(async (tx) => {
    const run = getRunData(await tx.get(runRef));
    const s = await tx.get(ref);
    member(run, uid);
    if (!s.exists || s.get('uid') !== uid || s.get('deviceId') !== req.data.deviceId)
      throw new HttpsError('permission-denied', 'Brak uprawnień do sesji.');
    if (s.get('closed')) return { ok: true };
    if (req.data.lastSeq !== s.get('lastSeq'))
      throw new Error('Najpierw wyślij wszystkie operacje.');
    if (s.get('role') === 'timer' && !s.get('stopped')) throw new Error('Najpierw zakończ pomiar.');
    tx.update(ref, { closed: true });
    tx.update(runRef, { revision: run.revision + 1 });
    return { ok: true };
  });
});
async function loadPreview(runId: string, uid: string) {
  const ref = db.doc(`runs/${runId}`);
  const run = getRunData(await ref.get());
  owner(run, uid);
  const [ops, sessions] = await Promise.all([
    ref.collection('operations').get(),
    ref.collection('sessions').get(),
  ]);
  const operations = ops.docs.map((d) => d.data() as Operation);
  const ids = new Set<string>();
  for (const op of operations) if (op.kind === 'scan') ids.add(op.participantId);
  for (const edit of run.corrections)
    if (edit.kind === 'setPair' && edit.participantId) ids.add(edit.participantId);
  const codes = ids.size
    ? await db.getAll(...[...ids].map((code) => db.doc(`participantCodes/${code}`)))
    : [];
  const people: Record<string, string> = {};
  const uids: Record<string, string> = {};
  for (const code of codes)
    if (code.exists) {
      people[code.id] = code.get('name');
      uids[code.id] = code.get('uid');
    }
  const result = reconcile(operations, run.corrections, people);
  const sessionRows = sessions.docs.map((d) => ({ id: d.id, ...d.data() }) as DeviceSession);
  const issues = [...result.issues];
  if (!sessionRows.some((s) => s.role === 'timer' && s.stopped && s.closed))
    issues.push('Stoper musi zakończyć pomiar i zamknąć sesję.');
  if (sessionRows.some((s) => !s.closed))
    issues.push('Wszystkie sesje skanerów i stopera muszą zostać zsynchronizowane i zamknięte.');
  if (operations.some((o) => o.kind === 'clockWarning') && !run.clockReviewed)
    issues.push('Wymagane sprawdzenie pomiaru po zmianie zegara lub odświeżeniu.');
  return { run, rows: result.rows, issues, sessions: sessionRows, operations, people, uids };
}
export const previewResults = callable(async (req) => {
  const { uid } = identity(req);
  const result = await loadPreview(id(req.data.runId), uid);
  const { uids, ...safe } = result;
  return safe;
});
export const saveCorrections = callable(async (req) => {
  const { uid } = identity(req);
  const ref = db.doc(`runs/${id(req.data.runId)}`);
  const corrections = validateCorrections(req.data.corrections);
  return db.runTransaction(async (tx) => {
    const run = getRunData(await tx.get(ref));
    owner(run, uid);
    if (run.revision !== req.data.revision)
      throw new Error('Dane zmieniły się. Odśwież podgląd przed zapisaniem korekt.');
    tx.create(ref.collection('audit').doc(), {
      uid,
      previous: run.corrections,
      corrections,
      at: FieldValue.serverTimestamp(),
      clockReviewed: req.data.clockReviewed === true,
    });
    tx.update(ref, {
      corrections,
      clockReviewed: req.data.clockReviewed === true,
      revision: run.revision + 1,
    });
    return { ok: true };
  });
});
export const publishResults = callable(async (req) => {
  const { uid } = identity(req);
  const runId = id(req.data.runId);
  const result = await loadPreview(runId, uid);
  if (req.data.revision !== result.run.revision)
    throw new Error('Dane zmieniły się. Odśwież podgląd.');
  if (result.issues.length) throw new Error(result.issues.join(' '));
  fields(result.run, true);
  const versionId = randomUUID();
  const ref = db.doc(`runs/${runId}`);
  return db.runTransaction(async (tx) => {
    const run = getRunData(await tx.get(ref));
    owner(run, uid);
    if (run.revision !== result.run.revision)
      throw new Error('Dane zmieniły się w trakcie publikacji. Spróbuj ponownie.');
    const version = run.version + 1;
    const info = {
      id: runId,
      name: run.name,
      date: run.date,
      distanceKm: run.distanceKm,
      version,
      count: result.rows.length,
      activeVersion: versionId,
    };
    const rows = result.rows.map(({ position, elapsedMs, name }) => ({
      position,
      elapsedMs,
      name,
    }));
    tx.create(db.doc(`publicRuns/${runId}/versions/${versionId}`), { rows });
    tx.set(db.doc(`publicRuns/${runId}`), info);
    tx.update(ref, {
      version,
      status: 'published',
      revision: run.revision + 1,
      publishedRows: result.rows,
      publishedInfo: info,
      publishedParticipantUids: [
        ...new Set(
          result.rows.flatMap((r) => (r.participantId ? [result.uids[r.participantId]] : [])),
        ),
      ],
      publishedAt: FieldValue.serverTimestamp(),
    });
    return { version };
  });
});
export const listHistory = callable(async (req) => {
  const { uid } = identity(req);
  const profile = await db.doc(`profiles/${uid}`).get();
  if (!profile.exists) return [];
  const runs = await db
    .collection('runs')
    .where('publishedParticipantUids', 'array-contains', uid)
    .get();
  return runs.docs
    .map((doc) => {
      const data = doc.data();
      return {
        run: data.publishedInfo,
        result: data.publishedRows.find(
          (r: any) => r.participantId === profile.get('participantId'),
        ),
      };
    })
    .filter((x) => x.result)
    .sort((a, b) => b.run.date.localeCompare(a.run.date));
});
