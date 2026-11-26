export type Role = 'timer' | 'scanner';
export type RunStatus = 'draft' | 'published';
export interface Run {
  id: string;
  ownerUid: string;
  name: string;
  date: string;
  distanceKm: number;
  status: RunStatus;
  memberUids: string[];
  revision: number;
  version: number;
  corrections: Correction[];
  clockReviewed: boolean;
}
export interface Profile {
  uid: string;
  name: string;
  email: string;
  participantId: string;
}
export interface DeviceSession {
  id: string;
  uid: string;
  role: Role;
  closed: boolean;
  lastSeq: number;
  started: boolean;
  stopped: boolean;
  lastElapsedMs: number;
  finishCount: number;
}
export type OpBody =
  | { kind: 'start'; epochMs: number }
  | { kind: 'finish'; elapsedMs: number }
  | { kind: 'stop'; elapsedMs: number }
  | { kind: 'scan'; position: number; participantId: string }
  | { kind: 'clockWarning' };
export type Operation = OpBody & { seq: number; sessionId: string; role: Role };
export type Correction =
  | { kind: 'setTime'; position: number; elapsedMs: number }
  | { kind: 'removeTime'; position: number }
  | { kind: 'insertTime'; position: number; elapsedMs: number }
  | { kind: 'setPair'; position: number; participantId: string | null };
export interface ResultRow {
  position: number;
  elapsedMs: number;
  participantId: string | null;
  name: string;
}
export interface PublicResult {
  position: number;
  elapsedMs: number;
  name: string;
}
export interface PublicRun {
  id: string;
  name: string;
  date: string;
  distanceKm: number;
  version: number;
  count: number;
}
export const isZhrEmail = (email: string) => /^[^@\s]+@zhr\.pl$/i.test(email);
export const participantQr = (id: string) => `HR1:P:${id}`;
export const tokenQr = (position: number) => `HR1:F:${position}`;
export function parseCode(
  value: string,
): { type: 'participant'; id: string } | { type: 'finish'; position: number } | null {
  const text = value.trim();
  const participant = /^HR1:P:([A-Za-z0-9_-]{16,32})$/.exec(text);
  if (participant) return { type: 'participant', id: participant[1] };
  const finish = /^HR1:F:([1-9]\d{0,2})$/.exec(text);
  if (finish && Number(finish[1]) <= 500) return { type: 'finish', position: Number(finish[1]) };
  return null;
}
export function formatTime(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}
export function parseTime(text: string): number {
  if (!/^\d{1,3}:\d{2}(:\d{2})?$/.test(text)) throw new Error('Podaj czas m:ss lub h:mm:ss.');
  const parts = text.split(':').map(Number);
  if (parts.slice(1).some((n) => n > 59))
    throw new Error('Minuty i sekundy muszą być mniejsze niż 60.');
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}
export function validateBody(body: Record<string, unknown>): OpBody {
  const ms = (n: unknown) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 7 * 86400000;
  switch (body.kind) {
    case 'start':
      if (
        typeof body.epochMs === 'number' &&
        Number.isSafeInteger(body.epochMs) &&
        body.epochMs > 0
      )
        return { kind: 'start', epochMs: body.epochMs };
      break;
    case 'finish':
    case 'stop':
      if (ms(body.elapsedMs)) return { kind: body.kind, elapsedMs: body.elapsedMs as number };
      break;
    case 'scan':
      if (
        Number.isInteger(body.position) &&
        Number(body.position) >= 1 &&
        Number(body.position) <= 500 &&
        typeof body.participantId === 'string' &&
        /^[A-Za-z0-9_-]{16,32}$/.test(body.participantId)
      )
        return { kind: 'scan', position: Number(body.position), participantId: body.participantId };
      break;
    case 'clockWarning':
      return { kind: 'clockWarning' };
  }
  throw new Error('Niepoprawna operacja.');
}
export function advanceSession(session: DeviceSession, body: OpBody): DeviceSession {
  if (session.closed) throw new Error('Sesja jest zamknięta.');
  const next = { ...session };
  if (session.role === 'scanner') {
    if (body.kind !== 'scan') throw new Error('Skaner może zapisywać tylko pary kodów.');
  } else {
    if (body.kind === 'scan') throw new Error('Stoper nie może zapisywać skanów.');
    if (body.kind === 'start') {
      if (session.started) throw new Error('Start został już zapisany.');
      next.started = true;
    } else if (body.kind === 'clockWarning') {
      if (!session.started) throw new Error('Pomiar jeszcze się nie rozpoczął.');
    } else {
      if (!session.started || session.stopped) throw new Error('Pomiar nie jest aktywny.');
      if (body.elapsedMs < session.lastElapsedMs) throw new Error('Czas nie może cofać się.');
      next.lastElapsedMs = body.elapsedMs;
      if (body.kind === 'finish') {
        if (session.finishCount >= 500) throw new Error('Limit wynosi 500 miejsc.');
        next.finishCount++;
      } else next.stopped = true;
    }
  }
  return next;
}
export function validateCorrections(value: unknown): Correction[] {
  if (!Array.isArray(value) || value.length > 2000) throw new Error('Niepoprawna lista korekt.');
  return value.map((raw) => {
    if (!raw || !Number.isInteger(raw.position) || raw.position < 1 || raw.position > 500)
      throw new Error('Niepoprawne miejsce korekty.');
    const position = raw.position as number;
    if (
      raw.kind === 'setPair' &&
      (raw.participantId === null ||
        (typeof raw.participantId === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(raw.participantId)))
    )
      return { kind: 'setPair', position, participantId: raw.participantId };
    if (raw.kind === 'removeTime') return { kind: 'removeTime', position };
    if (
      (raw.kind === 'setTime' || raw.kind === 'insertTime') &&
      Number.isInteger(raw.elapsedMs) &&
      raw.elapsedMs >= 0 &&
      raw.elapsedMs <= 7 * 86400000
    )
      return { kind: raw.kind, position, elapsedMs: raw.elapsedMs };
    throw new Error('Niepoprawna korekta.');
  });
}
export function reconcile(
  operations: Operation[],
  corrections: Correction[],
  people: Record<string, string> = {},
) {
  const times = operations
    .filter((o) => o.kind === 'finish')
    .sort((a, b) => a.seq - b.seq)
    .map((o) => (o as Operation & { elapsedMs: number }).elapsedMs);
  const pairs = new Map<number, Set<string>>();
  for (const op of operations)
    if (op.kind === 'scan') {
      const set = pairs.get(op.position) ?? new Set<string>();
      set.add(op.participantId);
      pairs.set(op.position, set);
    }
  const issues: string[] = [];
  for (const edit of corrections) {
    const i = edit.position - 1;
    if (edit.kind === 'setPair') {
      pairs.set(edit.position, new Set(edit.participantId ? [edit.participantId] : []));
      continue;
    }
    if (
      (edit.kind === 'insertTime' && i > times.length) ||
      (edit.kind !== 'insertTime' && i >= times.length)
    ) {
      issues.push(`Korekta miejsca ${edit.position}: brak pomiaru.`);
      continue;
    }
    if (edit.kind === 'setTime') times[i] = edit.elapsedMs;
    if (edit.kind === 'removeTime') times.splice(i, 1);
    if (edit.kind === 'insertTime') times.splice(i, 0, edit.elapsedMs);
  }
  if (times.length > 500) issues.push('Przekroczono 500 miejsc.');
  if (times.length === 0) issues.push('Brak czasów do opublikowania.');
  const seen = new Set<string>();
  const rows: ResultRow[] = times.map((elapsedMs, i) => {
    const position = i + 1;
    const assigned = [...(pairs.get(position) ?? [])];
    const participantId = assigned[0] ?? null;
    if (assigned.length > 1) issues.push(`Miejsce ${position}: sprzeczne przypisania uczestników.`);
    if (participantId) {
      if (!people[participantId]) issues.push(`Miejsce ${position}: nieznany kod uczestnika.`);
      if (seen.has(participantId))
        issues.push(`Miejsce ${position}: uczestnik przypisany więcej niż raz.`);
      seen.add(participantId);
    }
    if (i > 0 && elapsedMs < times[i - 1])
      issues.push(`Miejsce ${position}: czas wcześniejszy niż na poprzednim miejscu.`);
    return {
      position,
      elapsedMs,
      participantId,
      name: participantId ? (people[participantId] ?? 'Nieznany kod') : 'Nieznany uczestnik',
    };
  });
  for (const [position, set] of pairs)
    if (position > times.length && set.size)
      issues.push(`Miejsce ${position}: skan bez pomiaru czasu.`);
  return { rows, issues };
}
