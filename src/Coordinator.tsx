import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { Check, RefreshCw, Upload, Printer, Users, Pencil, AlertTriangle } from 'lucide-react';
import { call, db, message } from './firebase';
import { ErrorBox, ResultTable } from './App';
import {
  parseCode,
  parseTime,
  reconcile,
  type Correction,
  type DeviceSession,
  type Operation,
  type ResultRow,
  type Run,
} from '../shared/domain';
interface Preview {
  run: Run;
  rows: ResultRow[];
  issues: string[];
  sessions: DeviceSession[];
  operations: Operation[];
  people: Record<string, string>;
}
export function Coordinator({ run }: { run: Run }) {
  const [name, setName] = useState(run.name);
  const [date, setDate] = useState(run.date);
  const [distance, setDistance] = useState(String(run.distanceKm));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('scanner');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [edits, setEdits] = useState<Correction[]>([]);
  const [clockReviewed, setClockReviewed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [kind, setKind] = useState<Correction['kind']>('setPair');
  const [position, setPosition] = useState('1');
  const [time, setTime] = useState('');
  const [code, setCode] = useState('');
  const [audit, setAudit] = useState<{ id: string; count: number; uid: string }[]>([]);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  useEffect(() => {
    setName(run.name);
    setDate(run.date);
    setDistance(String(run.distanceKm));
  }, [run.name, run.date, run.distanceKm]);
  useEffect(
    () =>
      onSnapshot(
        collection(db, 'runs', run.id, 'sessions'),
        (s) => setSessions(s.docs.map((d) => ({ id: d.id, ...d.data() }) as DeviceSession)),
        (e) => setError(message(e)),
      ),
    [run.id],
  );
  useEffect(
    () =>
      onSnapshot(
        collection(db, 'runs', run.id, 'audit'),
        (s) =>
          setAudit(
            s.docs.map((d) => ({
              id: d.id,
              count: d.get('corrections').length,
              uid: d.get('uid'),
            })),
          ),
        (e) => setError(message(e)),
      ),
    [run.id],
  );
  async function execute(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const p = await call<Preview>('previewResults', { runId: run.id });
    setPreview(p);
    setEdits(p.run.corrections);
    setClockReviewed(p.run.clockReviewed);
    setReviewConfirmed(false);
  }
  const dirty = Boolean(
    preview &&
    (JSON.stringify(edits) !== JSON.stringify(preview.run.corrections) ||
      clockReviewed !== preview.run.clockReviewed),
  );
  const calculated = preview ? reconcile(preview.operations, edits, preview.people) : undefined;
  async function saveMetadata(e: FormEvent) {
    e.preventDefault();
    await execute(async () => {
      await call('updateRun', { runId: run.id, name, date, distanceKm: Number(distance) });
      setNotice('Dane biegu zapisane. Po publikacji zmiany pojawią się w nowej wersji wyników.');
    });
  }
  async function addVolunteer(e: FormEvent) {
    e.preventDefault();
    await execute(async () => {
      await call('assignVolunteer', { runId: run.id, email, role });
      setNotice('Wolontariusz dodany. Po zalogowaniu zobaczy bieg w swoim panelu.');
      setEmail('');
    });
  }
  function addEdit(e: FormEvent) {
    e.preventDefault();
    try {
      const pos = Number(position);
      if (!Number.isInteger(pos) || pos < 1 || pos > 500)
        throw new Error('Podaj miejsce od 1 do 500.');
      let correction: Correction;
      if (kind === 'setPair') {
        const parsed = code.trim()
          ? parseCode(code.trim().startsWith('HR1:') ? code : `HR1:P:${code.trim()}`)
          : null;
        if (code.trim() && parsed?.type !== 'participant')
          throw new Error(
            'Wpisz kod uczestnika lub pozostaw pole puste dla nieznanego uczestnika.',
          );
        correction = {
          kind,
          position: pos,
          participantId: parsed?.type === 'participant' ? parsed.id : null,
        };
      } else if (kind === 'removeTime') correction = { kind, position: pos };
      else correction = { kind, position: pos, elapsedMs: parseTime(time) };
      setEdits([...edits, correction]);
      setReviewConfirmed(false);
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }
  const volunteers = (
    run as Run & { volunteers?: Record<string, { email: string; name: string; roles: string[] }> }
  ).volunteers;
  return (
    <section className="coordinator">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Stanowisko koordynatora</span>
          <h2>Przygotuj. Sprawdź. Opublikuj.</h2>
        </div>
        <Link className="button secondary" to="/tokeny">
          <Printer size={17} /> Tokeny do druku
        </Link>
      </div>
      <ErrorBox error={error} />
      {notice && <div className="notice success">{notice}</div>}
      <div className="two-columns">
        <form className="panel stack" onSubmit={saveMetadata}>
          <h3>
            <Pencil size={18} /> Szczegóły biegu
          </h3>
          <label>
            Nazwa wydarzenia
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <div className="two-columns">
            <label>
              Data
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label>
              Dystans (km)
              <input
                type="number"
                min="0.01"
                max="200"
                step="0.01"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                required
              />
            </label>
          </div>
          <button className="secondary" disabled={busy}>
            Zapisz szczegóły
          </button>
        </form>
        <section className="panel">
          <h3>
            <Users size={18} /> Zespół wolontariuszy
          </h3>
          {Object.entries(volunteers ?? {}).map(([uid, v]) => (
            <div className="volunteer" key={uid}>
              <strong>{v.name}</strong>
              <small>
                {v.email} · {v.roles.map((r) => (r === 'timer' ? 'stoper' : 'skaner')).join(', ')}
              </small>
            </div>
          ))}
          {run.status === 'draft' && (
            <form onSubmit={addVolunteer} className="stack">
              <label>
                Adres zalogowanego wolontariusza
                <input
                  type="email"
                  placeholder="imie.nazwisko@zhr.pl"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                Funkcja
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="scanner">Skaner</option>
                  <option value="timer">Stoper</option>
                </select>
              </label>
              <button className="secondary" disabled={busy}>
                Dodaj do zespołu
              </button>
            </form>
          )}
        </section>
      </div>
      <section className="panel">
        <h3>Urządzenia na mecie</h3>
        {sessions.length ? (
          sessions.map((s) => (
            <div className="session-row" key={s.id}>
              <strong>{s.role === 'timer' ? 'Stoper' : 'Skaner'}</strong>
              <code>{s.id}</code>
              <span>
                {s.closed
                  ? 'Zamknięta'
                  : s.stopped
                    ? 'Pomiar zakończony, sesja otwarta'
                    : 'Otwarta'}
              </span>
              <small>{s.lastSeq} zapisów na serwerze</small>
            </div>
          ))
        ) : (
          <p>Wolontariusze muszą otworzyć i przygotować swoje urządzenia przed biegiem.</p>
        )}
        <p className="subtle">
          Liczba zapisów obejmuje tylko dane odebrane przez serwer. Każdy wolontariusz kończy sesję
          na swoim telefonie, po wysłaniu ostatnich danych.
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Kontrola wyników</h2>
            <p>Po zakończeniu wszystkich sesji połącz dane i sprawdź kolejność.</p>
          </div>
          <button
            disabled={busy || dirty}
            className="secondary"
            onClick={() => void execute(refresh)}
          >
            <RefreshCw size={17} /> Wczytaj podgląd
          </button>
        </div>
        {preview && (
          <>
            <p className="subtle">
              Podgląd rewizji {preview.run.revision}
              {run.revision !== preview.run.revision
                ? ' · dane na serwerze zmieniły się — odśwież przed publikacją'
                : ''}
            </p>
            {preview.issues.length > 0 && !dirty && (
              <div className="notice error">
                <strong>
                  <AlertTriangle size={17} /> Do sprawdzenia:
                </strong>
                <ul>
                  {preview.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            {dirty && (
              <div className="notice">
                Podgląd zawiera niezapisane korekty. Sprawdź przesunięcia miejsc, a następnie zapisz
                korekty. Serwer ponownie zweryfikuje kody uczestników.
              </div>
            )}
            <ResultTable rows={calculated?.rows ?? []} />
            <details className="correction-editor">
              <summary>Korekty czasów i przypisań</summary>
              <p>
                Usunięcie lub dodanie pomiaru przesuwa kolejne czasy. Numery tokenów i przypisania
                uczestników pozostają na swoich miejscach. Sprawdź całą tabelę przed zatwierdzeniem.
              </p>
              <form className="correction-form" onSubmit={addEdit}>
                <label>
                  Operacja
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as Correction['kind'])}
                  >
                    <option value="setPair">Przypisz uczestnika / usuń przypisanie</option>
                    <option value="setTime">Popraw czas</option>
                    <option value="removeTime">Usuń omyłkowy pomiar</option>
                    <option value="insertTime">Dodaj brakujący pomiar</option>
                  </select>
                </label>
                <label>
                  Miejsce
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    required
                  />
                </label>
                {kind === 'setPair' ? (
                  <label>
                    Kod uczestnika (pusty = nieznany)
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="HR1:P:…"
                    />
                  </label>
                ) : kind !== 'removeTime' ? (
                  <label>
                    Czas
                    <input
                      placeholder="m:ss lub h:mm:ss"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      required
                    />
                  </label>
                ) : null}
                <button className="secondary">Dodaj do podglądu</button>
              </form>
              <ol className="edits">
                {edits.map((edit, i) => (
                  <li key={i}>
                    <code>{JSON.stringify(edit)}</code>
                    <button
                      className="ghost"
                      onClick={() => {
                        setEdits(edits.filter((_, j) => i !== j));
                        setReviewConfirmed(false);
                      }}
                    >
                      Usuń korektę
                    </button>
                  </li>
                ))}
              </ol>
              <label className="check">
                <input
                  type="checkbox"
                  checked={clockReviewed}
                  onChange={(e) => {
                    setClockReviewed(e.target.checked);
                    setReviewConfirmed(false);
                  }}
                />
                <span>Sprawdzono pomiar po ewentualnym odświeżeniu lub zmianie zegara.</span>
              </label>
              {dirty && (
                <>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={reviewConfirmed}
                      onChange={(e) => setReviewConfirmed(e.target.checked)}
                    />
                    <span>
                      Sprawdziłem podgląd, w tym przesunięcia miejsc i przypisania uczestników.
                    </span>
                  </label>
                  <div className="actions">
                    <button
                      disabled={busy || !reviewConfirmed}
                      onClick={() =>
                        void execute(async () => {
                          await call('saveCorrections', {
                            runId: run.id,
                            revision: preview.run.revision,
                            corrections: edits,
                            clockReviewed,
                          });
                          await refresh();
                          setNotice('Korekty zapisane w historii.');
                        })
                      }
                    >
                      <Check size={18} /> Zapisz korekty
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setEdits(preview.run.corrections);
                        setClockReviewed(preview.run.clockReviewed);
                      }}
                    >
                      Odrzuć zmiany
                    </button>
                  </div>
                </>
              )}
            </details>
            <div className="publish-box">
              <div>
                <h3>
                  {run.status === 'published'
                    ? 'Opublikuj poprawioną wersję'
                    : 'Gotowe do publikacji?'}
                </h3>
                <p>
                  Publiczna tabela pokaże nazwiska, miejsca i czasy. Historia uczestników
                  zaktualizuje się wraz z publikacją.
                </p>
              </div>
              <button
                disabled={
                  busy ||
                  dirty ||
                  preview.issues.length > 0 ||
                  run.revision !== preview.run.revision
                }
                onClick={() =>
                  void execute(async () => {
                    await call('publishResults', { runId: run.id, revision: preview.run.revision });
                    await refresh();
                    setNotice('Wyniki zostały opublikowane.');
                  })
                }
              >
                <Upload size={18} /> Publikuj wyniki
              </button>
            </div>
          </>
        )}
      </section>
      {audit.length > 0 && (
        <details className="panel">
          <summary>Historia zapisanych korekt ({audit.length})</summary>
          <ul>
            {audit.map((a) => (
              <li key={a.id}>
                Zapis {a.id.slice(0, 8)} · {a.count} korekt · użytkownik {a.uid}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
