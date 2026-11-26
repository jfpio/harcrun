import {
  advanceSession,
  type DeviceSession,
  type OpBody,
  type Operation,
} from '../shared/domain.js';
export interface LocalSession {
  key: string;
  runId: string;
  session: DeviceSession;
  operations: Operation[];
  ack: number;
  done: boolean;
  serverClosed: boolean;
  startEpoch?: number;
  startPerf?: number;
  timeOrigin?: number;
}
let opened: Promise<IDBDatabase> | undefined;
function database() {
  return (opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('harcrun-v1', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('sessions', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function readLocal(key: string): Promise<LocalSession | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('sessions').objectStore('sessions').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function mutateLocal(
  key: string,
  mutate: (previous: LocalSession | undefined) => LocalSession,
): Promise<LocalSession> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const get = store.get(key);
    let next: LocalSession;
    get.onsuccess = () => {
      try {
        next = mutate(get.result);
        store.put(next);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Nie zapisano danych na urządzeniu.'));
  });
}
export function appendLocal(key: string, body: OpBody) {
  const startPerf = performance.now();
  return mutateLocal(key, (previous) => {
    if (!previous || previous.done) throw new Error('Sesja jest zamknięta.');
    const session = advanceSession(previous.session, body);
    const seq = previous.operations.length + 1;
    session.lastSeq = seq;
    return {
      ...previous,
      session,
      operations: [
        ...previous.operations,
        { ...body, seq, sessionId: session.id, role: session.role },
      ],
      ...(body.kind === 'start'
        ? { startEpoch: body.epochMs, startPerf, timeOrigin: performance.timeOrigin }
        : {}),
    };
  });
}
export function getDeviceId() {
  let value = localStorage.getItem('harcrun-device');
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem('harcrun-device', value);
  }
  return value;
}
export function downloadBackup(local: LocalSession) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(local, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `harcrun-${local.runId}-${local.session.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
