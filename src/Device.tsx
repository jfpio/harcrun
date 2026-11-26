import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import {
  Timer,
  Flag,
  ScanLine,
  ArrowLeft,
  Wifi,
  WifiOff,
  Download,
  Camera,
  Check,
  X,
} from 'lucide-react';
import { call, message } from './firebase';
import {
  appendLocal,
  downloadBackup,
  getDeviceId,
  mutateLocal,
  readLocal,
  type LocalSession,
} from './storage';
import {
  formatTime,
  parseCode,
  type DeviceSession,
  type Role,
  type OpBody,
} from '../shared/domain';
import { Empty, ErrorBox, PageTitle, useApp, usePrivateRun } from './App';
export function Device({ role }: { role: Role }) {
  const { runId } = useParams();
  const { profile } = useApp();
  const { run, error: runError } = usePrivateRun(runId);
  const key = `${profile!.uid}:${runId}:${role}`;
  const [storedLocal, setStoredLocal] = useState<LocalSession>();
  const local = storedLocal?.key === key ? storedLocal : undefined;
  const activeKey = useRef(key);
  activeKey.current = key;
  function setLocal(value: LocalSession) {
    if (value.key === activeKey.current) setStoredLocal(value);
  }
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const lockRelease = useRef<() => void>(() => {});
  const syncingRef = useRef(false);
  const writeRef = useRef(false);
  const elapsedRef = useRef<() => number>(() => 0);
  const [elapsed, setElapsed] = useState(0);
  const [manual, setManual] = useState('');
  const [participant, setParticipant] = useState('');
  const [position, setPosition] = useState<number>();
  const [camera, setCamera] = useState(false);
  const [scanNotice, setScanNotice] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | undefined>(undefined);
  const localRef = useRef(local);
  localRef.current = local;
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setReady(false);
    setError('');
    setStoredLocal(undefined);
    setParticipant('');
    setPosition(undefined);
    setCamera(false);
    async function initialize() {
      const saved = await readLocal(key);
      if (cancelled) return;
      if (saved && saved.runId === runId) {
        let next = saved;
        if (
          role === 'timer' &&
          saved.session.started &&
          !saved.session.stopped &&
          !saved.done &&
          saved.timeOrigin !== performance.timeOrigin
        ) {
          next = await appendLocal(key, { kind: 'clockWarning' });
        }
        if (!cancelled) setLocal(next);
      }
      if (!cancelled) setReady(true);
    }
    if (!navigator.locks) {
      setError(
        'Ta przeglądarka nie obsługuje bezpiecznej blokady urządzenia. Otwórz aktualną wersję Safari lub Chrome.',
      );
      return;
    }
    navigator.locks
      .request(`harcrun-writer-${key}`, { signal: controller.signal }, async (lock) => {
        if (cancelled) return;
        if (!lock) {
          setError(
            'Ta sesja jest otwarta w innej karcie. Zamknij tamtą kartę i odśwież tę stronę.',
          );
          return;
        }
        try {
          await initialize();
          if (cancelled) return;
          await new Promise<void>((resolve) => {
            lockRelease.current = resolve;
            if (cancelled) resolve();
          });
        } catch (e) {
          if (!cancelled) setError(message(e));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(message(e));
      });
    return () => {
      cancelled = true;
      controller.abort();
      lockRelease.current();
    };
  }, [key, role, runId]);
  useEffect(() => {
    const online = () => setOnline(navigator.onLine);
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.ready.then(() => {
        if (!cancelled) setOfflineReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!local?.session.started) return;
    const base =
      local.timeOrigin === performance.timeOrigin && local.startPerf !== undefined
        ? 0
        : Math.max(local.session.lastElapsedMs, Date.now() - (local.startEpoch ?? Date.now()));
    const mono = performance.now();
    const start = local.startPerf ?? mono;
    elapsedRef.current = () =>
      local.session.stopped
        ? local.session.lastElapsedMs
        : Math.max(
            local.session.lastElapsedMs,
            Math.round(base ? base + performance.now() - mono : performance.now() - start),
          );
    const handle = setInterval(() => setElapsed(elapsedRef.current()), 80);
    setElapsed(elapsedRef.current());
    return () => clearInterval(handle);
    // Rebase only when the starting anchor changes, not on every scan/sync.
  }, [local?.startEpoch, local?.session.stopped]);
  useEffect(() => {
    if (
      role !== 'timer' ||
      !local?.session.started ||
      local.session.stopped ||
      local.operations.some((o) => o.kind === 'clockWarning')
    )
      return;
    let warned = false;
    const handle = setInterval(() => {
      if (
        !warned &&
        Math.abs(Date.now() - (local.startEpoch ?? Date.now()) - elapsedRef.current()) > 2000
      ) {
        warned = true;
        appendLocal(key, { kind: 'clockWarning' })
          .then(setLocal)
          .catch((e) => setError(message(e)));
      }
    }, 1000);
    return () => clearInterval(handle);
  }, [
    key,
    role,
    local?.startEpoch,
    local?.session.stopped,
    local?.operations.some((o) => o.kind === 'clockWarning'),
  ]);
  useEffect(() => {
    if (role !== 'timer' || !local?.session.started || local.session.stopped) return;
    let wake: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      if (document.visibilityState === 'visible' && 'wakeLock' in navigator)
        try {
          const lock = await navigator.wakeLock.request('screen');
          if (cancelled) await lock.release();
          else wake = lock;
        } catch {}
    };
    void request();
    document.addEventListener('visibilitychange', request);
    return () => {
      cancelled = true;
      void wake?.release();
      document.removeEventListener('visibilitychange', request);
    };
  }, [role, local?.session.started, local?.session.stopped]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      const saved = localRef.current;
      if (saved && (!saved.serverClosed || saved.ack < saved.operations.length)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      if (!online) throw new Error('Pierwsze przygotowanie urządzenia wymaga internetu.');
      const session = await call<DeviceSession>('openSession', {
        runId,
        role,
        deviceId: getDeviceId(),
      });
      if (session.lastSeq > 0)
        throw new Error(
          'Na serwerze są zapisy tej sesji, ale brakuje lokalnego dziennika. Nie rozpoczynaj nowego pomiaru. Skorzystaj z kopii zapasowej lub skontaktuj się z koordynatorem.',
        );
      setLocal(
        await mutateLocal(
          key,
          (p) =>
            p ?? {
              key,
              runId: runId!,
              session,
              operations: [],
              ack: 0,
              done: session.closed,
              serverClosed: session.closed,
            },
        ),
      );
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(body: OpBody) {
    if (writeRef.current) return false;
    writeRef.current = true;
    setBusy(true);
    setError('');
    try {
      setLocal(await appendLocal(key, body));
      return true;
    } catch (e) {
      setError(`Nie zapisano: ${message(e)}`);
      return false;
    } finally {
      writeRef.current = false;
      setBusy(false);
    }
  }
  async function synchronize() {
    if (syncingRef.current || !navigator.onLine || !ready) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      let saved = await readLocal(key);
      if (!saved || saved.serverClosed) return;
      while (saved.ack < saved.operations.length) {
        const response = await call<{ lastSeq: number }>('syncOperations', {
          runId,
          sessionId: saved.session.id,
          deviceId: getDeviceId(),
          operations: saved.operations.filter((o) => o.seq > saved!.ack).slice(0, 100),
        });
        saved = await mutateLocal(key, (p) => ({ ...p!, ack: Math.max(p!.ack, response.lastSeq) }));
        setLocal(saved);
      }
      if (saved.done) {
        await call('closeSession', {
          runId,
          sessionId: saved.session.id,
          deviceId: getDeviceId(),
          lastSeq: saved.operations.length,
        });
        saved = await mutateLocal(key, (p) => ({ ...p!, serverClosed: true }));
        setLocal(saved);
      }
      setError('');
    } catch (e) {
      setError(`Synchronizacja: ${message(e)} Dane pozostają na tym urządzeniu.`);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }
  useEffect(() => {
    void synchronize();
    const interval = setInterval(() => void synchronize(), 5000);
    return () => clearInterval(interval);
  }, [ready, online, local?.operations.length, local?.done]);
  async function finishSession() {
    setBusy(true);
    try {
      setLocal(await mutateLocal(key, (p) => ({ ...p!, done: true })));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const receiveRef = useRef<(text: string) => void>(() => {});
  const lastScan = useRef({ text: '', at: 0 });
  function receive(text: string) {
    if (!text) return;
    if (lastScan.current.text === text && Date.now() - lastScan.current.at < 2000) return;
    lastScan.current = { text, at: Date.now() };
    const parsed = parseCode(text);
    if (!parsed) {
      setScanNotice('To nie jest kod QR HarcRun.');
      return;
    }
    if (parsed.type === 'participant') setParticipant(parsed.id);
    else setPosition(parsed.position);
    setScanNotice(
      parsed.type === 'participant' ? 'Odczytano kod uczestnika.' : 'Odczytano token miejsca.',
    );
    navigator.vibrate?.(60);
  }
  receiveRef.current = receive;
  useEffect(() => {
    if (!camera || !videoRef.current) return;
    let cancelled = false;
    const reader = new BrowserQRCodeReader();
    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        videoRef.current,
        (result) => {
          if (result && !cancelled) receiveRef.current(result.getText());
        },
      )
      .then((c) => {
        if (cancelled) c.stop();
        else controls.current = c;
      })
      .catch((e) => {
        if (!cancelled) {
          setError(`Kamera: ${message(e)} Możesz wpisać kod ręcznie.`);
          setCamera(false);
        }
      });
    return () => {
      cancelled = true;
      controls.current?.stop();
      controls.current = undefined;
    };
  }, [camera]);
  useEffect(() => {
    if (local?.done) setCamera(false);
  }, [local?.done]);
  async function confirmPair() {
    if (!position || !participant) return;
    if (await save({ kind: 'scan', position, participantId: participant })) {
      setPosition(undefined);
      setParticipant('');
      setScanNotice('Para zapisana na urządzeniu.');
      lastScan.current = { text: '', at: 0 };
    }
  }
  const pending = local ? local.operations.length - local.ack : 0;
  return (
    <>
      <Link className="back" to={`/biegi/${runId}`}>
        <ArrowLeft size={16} /> Panel biegu
      </Link>
      <PageTitle
        eyebrow={run?.name ?? 'Obsługa mety'}
        title={role === 'timer' ? 'Stoper' : 'Skaner'}
        description={
          role === 'timer'
            ? 'Pozostaw aplikację otwartą na pierwszym planie.'
            : 'Zeskanuj kod uczestnika i token miejsca, a następnie zatwierdź parę.'
        }
      />
      <ErrorBox error={error || runError} />
      {!ready && !error ? (
        <Empty>
          Oczekiwanie na dostęp do dziennika. Jeśli ta sesja jest otwarta w innej karcie, zamknij
          tamtą kartę.
        </Empty>
      ) : null}
      {ready && !local ? (
        <section className="panel narrow stack">
          <h2>Przygotuj ten telefon</h2>
          <p>
            Przed biegiem zaloguj się online i przypisz urządzenie. Zapisów nie usuwamy przy utracie
            zasięgu. Nie czyść danych przeglądarki do czasu potwierdzenia synchronizacji.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={trusted}
              onChange={(e) => setTrusted(e.target.checked)}
            />
            <span>
              To zaufane urządzenie. Zgadzam się na przechowywanie danych obsługi biegu na tym
              telefonie.
            </span>
          </label>
          <button disabled={!trusted || busy} onClick={prepare}>
            Przygotuj {role === 'timer' ? 'stoper' : 'skaner'}
          </button>
        </section>
      ) : null}
      {local && (
        <>
          <div className="device-status">
            <span>
              {online ? <Wifi size={17} /> : <WifiOff size={17} />}{' '}
              {online ? 'Połączenie dostępne' : 'Praca offline'}
            </span>
            <span>
              {syncing
                ? 'Synchronizacja…'
                : pending
                  ? `${pending} oczekuje na wysłanie`
                  : `${local.ack} potwierdzonych zapisów`}
            </span>
            <button
              className="ghost"
              disabled={syncing || !online}
              onClick={() => void synchronize()}
            >
              Wyślij teraz
            </button>
          </div>
          <div className="notice">
            {offlineReady
              ? 'Aplikacja przygotowana do ponownego otwarcia offline.'
              : 'Powłoka offline nie jest jeszcze gotowa. Pozostaw tę stronę otwartą; pełna obsługa offline wymaga wersji produkcyjnej i aktywnego service workera.'}
          </div>
          {local.serverClosed ? (
            <div className="success notice">
              <Check size={20} /> Sesja zamknięta. Wszystkie dane zostały potwierdzone przez serwer.
            </div>
          ) : local.done ? (
            <div className="notice">
              Sesja zakończona na urządzeniu. Połącz się z internetem i pozostaw aplikację otwartą,
              aby wysłać dane i zamknąć sesję na serwerze.
            </div>
          ) : role === 'timer' ? (
            <section className="timer-panel">
              <span className="eyebrow">
                {local.session.stopped
                  ? 'Pomiar zakończony'
                  : local.session.started
                    ? 'Pomiar trwa'
                    : 'Gotowi do startu?'}
              </span>
              <div className="stopwatch" aria-label="Czas od startu">
                {formatTime(elapsed)}
                <small>.{String(Math.floor((elapsed % 1000) / 10)).padStart(2, '0')}</small>
              </div>
              <p>
                Zapisanych finiszów: <strong>{local.session.finishCount}</strong>
              </p>
              {!local.session.started ? (
                <button
                  className="timer-primary"
                  disabled={busy}
                  onClick={() => void save({ kind: 'start', epochMs: Date.now() })}
                >
                  <Flag /> Start wspólny
                </button>
              ) : !local.session.stopped ? (
                <>
                  <button
                    className="timer-primary"
                    disabled={busy || local.session.finishCount >= 500}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      void save({ kind: 'finish', elapsedMs: elapsedRef.current() });
                    }}
                    onClick={(e) => {
                      if (e.detail === 0)
                        void save({ kind: 'finish', elapsedMs: elapsedRef.current() });
                    }}
                  >
                    <Timer /> Zapisz metę #{local.session.finishCount + 1}
                  </button>
                  <details className="end-control">
                    <summary>Zakończ pomiar…</summary>
                    <p>
                      Zakończ dopiero po ostatnim uczestniku. Tej czynności nie można cofnąć na
                      stoperze.
                    </p>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => void save({ kind: 'stop', elapsedMs: elapsedRef.current() })}
                    >
                      Potwierdź zakończenie pomiaru
                    </button>
                  </details>
                </>
              ) : (
                <button disabled={busy} onClick={finishSession}>
                  Zamknij sesję i wyślij dane
                </button>
              )}
              <div className="finish-list">
                {local.operations
                  .filter((o) => o.kind === 'finish')
                  .map((o, i) => (
                    <div key={o.seq}>
                      <span>#{i + 1}</span>
                      <strong>{o.kind === 'finish' ? formatTime(o.elapsedMs) : ''}</strong>
                      <small>{o.seq <= local.ack ? 'Na serwerze' : 'Na urządzeniu'}</small>
                    </div>
                  ))
                  .reverse()
                  .slice(0, 20)}
              </div>
            </section>
          ) : (
            <section className="panel scanner-panel">
              <div className="camera-area">
                {camera ? (
                  <>
                    <video ref={videoRef} muted playsInline />
                    <button
                      className="camera-close"
                      aria-label="Wyłącz kamerę"
                      onClick={() => setCamera(false)}
                    >
                      <X size={20} />
                    </button>
                  </>
                ) : (
                  <>
                    <ScanLine size={66} />
                    <p>Aparat odczyta kody QR HarcRun.</p>
                    <button onClick={() => setCamera(true)}>
                      <Camera size={18} /> Włącz kamerę
                    </button>
                  </>
                )}
              </div>
              <p className="scan-notice" role="status">
                {scanNotice || 'Czekam na pierwszy kod…'}
              </p>
              <div className="scan-pair">
                <div>
                  <span>Uczestnik</span>
                  <strong>{participant || 'Zeskanuj QR'}</strong>
                </div>
                <div>
                  <span>Miejsce</span>
                  <strong>{position ? `#${position}` : 'Zeskanuj token'}</strong>
                </div>
              </div>
              <div className="actions">
                <button disabled={!participant || !position || busy} onClick={confirmPair}>
                  <Check size={19} /> Zatwierdź parę
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setParticipant('');
                    setPosition(undefined);
                    setScanNotice('Para wyczyszczona.');
                  }}
                >
                  Wyczyść
                </button>
              </div>
              <form
                className="manual-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  receive(manual.trim());
                  setManual('');
                }}
              >
                <label>
                  Kod ręcznie
                  <input
                    placeholder="HR1:P:… lub HR1:F:12"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                  />
                </label>
                <button type="submit" className="secondary">
                  Dodaj kod
                </button>
              </form>
              <p className="subtle">
                Zapisanych par: {local.operations.length}. Nieznane kody i konflikty sprawdzi
                koordynator po synchronizacji.
              </p>
              <details className="end-control">
                <summary>Zakończ skanowanie…</summary>
                <p>Upewnij się, że zapisano ostatnią parę. Zamkniętej sesji nie można wznowić.</p>
                <button
                  className="secondary"
                  disabled={busy || Boolean(participant || position)}
                  onClick={finishSession}
                >
                  Zakończ sesję i wyślij dane
                </button>
              </details>
            </section>
          )}
          <button className="ghost backup" onClick={() => downloadBackup(local)}>
            <Download size={17} /> Pobierz kopię dziennika JSON
          </button>
        </>
      )}
    </>
  );
}
