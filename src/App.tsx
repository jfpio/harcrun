import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  ArrowUpRight,
  Flag,
  Timer,
  ScanLine,
  Footprints,
  LogOut,
  Plus,
  ArrowLeft,
  Mountain,
  CalendarDays,
  Trophy,
  QrCode,
  Menu,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  auth,
  db,
  call,
  login,
  configured,
  servicesReady,
  emulators,
  emulatorLogin,
  message,
} from './firebase';
import {
  isZhrEmail,
  participantQr,
  tokenQr,
  formatTime,
  type Profile,
  type PublicRun,
  type PublicResult,
  type Run,
} from '../shared/domain';
import { Device } from './Device';
import { Coordinator } from './Coordinator';
interface AppContext {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string;
  setError: (s: string) => void;
}
const Context = createContext<AppContext>(null!);
export const useApp = () => useContext(Context);
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div className="notice error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function QR({
  value,
  size = 200,
  onReady,
}: {
  value: string;
  size?: number;
  onReady?: () => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 3, errorCorrectionLevel: 'M' }).then((v) => {
      if (active) setUrl(v);
    });
    return () => {
      active = false;
    };
  }, [value, size]);
  return url ? (
    <img src={url} width={size} height={size} onLoad={onReady} alt={`Kod QR: ${value}`} />
  ) : (
    <div style={{ width: size, height: size }} />
  );
}
export function usePrivateRun(runId: string | undefined) {
  const { user } = useApp();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!runId || !user) return;
    const key = `harcrun-run-${user.uid}-${runId}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached) setRun(JSON.parse(cached));
    } catch {}
    return onSnapshot(
      doc(db, 'runs', runId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = { id: snapshot.id, ...snapshot.data() } as Run;
          setRun(data);
          localStorage.setItem(key, JSON.stringify(data));
          setError('');
        } else if (!snapshot.metadata.fromCache) setError('Nie znaleziono biegu.');
      },
      (e) => setError(message(e)),
    );
  }, [runId, user]);
  return { run, error };
}
function SignIn() {
  const { setError } = useApp();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  async function action() {
    setBusy(true);
    try {
      await login();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {emulators ? (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await emulatorLogin(email, password);
            } catch (err) {
              setError(message(err));
            }
          }}
        >
          <p className="eyebrow">Lokalny emulator</p>
          <input
            type="email"
            aria-label="Email testowy"
            placeholder="uczestnik@zhr.pl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            aria-label="Hasło testowe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button>Zaloguj konto testowe</button>
        </form>
      ) : (
        <button onClick={action} disabled={busy || !configured || !servicesReady}>
          {busy ? 'Logowanie…' : 'Zaloguj przez Google @zhr.pl'} <ArrowUpRight size={17} />
        </button>
      )}
    </>
  );
}
function ProfileForm() {
  const { user, setError } = useApp();
  const [name, setName] = useState(user?.displayName ?? '');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await call('saveProfile', { name, publicAcknowledged: ack });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel narrow">
      <p className="eyebrow">Twój pierwszy krok</p>
      <h1>Dołącz do HarcRun.</h1>
      <p>Uzupełnij profil, a otrzymasz swój stały kod uczestnika.</p>
      <form onSubmit={submit} className="stack">
        <label>
          Imię i nazwisko
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={3}
            maxLength={100}
            required
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            required
          />
          <span>
            Rozumiem, że moje imię i nazwisko, miejsce oraz czas zostaną opublikowane w publicznych
            wynikach biegów, w których wezmę udział.
          </span>
        </label>
        <button disabled={busy}>
          Utwórz profil <ArrowUpRight size={18} />
        </button>
      </form>
    </section>
  );
}
function Protected({ children }: { children: ReactNode }) {
  const { user, loading, profile } = useApp();
  if (loading) return <Empty>Wczytywanie konta…</Empty>;
  if (!user)
    return (
      <section className="panel narrow">
        <h1>Do zobaczenia na starcie.</h1>
        <p>Zaloguj się kontem @zhr.pl, aby otworzyć swój panel.</p>
        <SignIn />
      </section>
    );
  if (!user.emailVerified || !isZhrEmail(user.email ?? ''))
    return (
      <Empty>
        HarcRun wymaga zweryfikowanego konta w domenie @zhr.pl. Wyloguj się i wybierz właściwe
        konto.
      </Empty>
    );
  if (!profile) return <ProfileForm />;
  return children;
}
function RunCard({ run, manage = false }: { run: PublicRun | Run; manage?: boolean }) {
  return (
    <Link className="run-card" to={manage ? `/biegi/${run.id}` : `/wyniki/${run.id}`}>
      <div className="run-icon">
        <Flag size={23} />
      </div>
      <div>
        <span className="eyebrow">
          {'status' in run && run.status === 'draft'
            ? 'Przygotowanie'
            : `${run.distanceKm} km · wspólny start`}
        </span>
        <h3>{run.name}</h3>
        <span className="subtle">
          <CalendarDays size={14} /> {new Date(run.date + 'T12:00:00').toLocaleDateString('pl-PL')}
        </span>
      </div>
      <ArrowUpRight className="card-arrow" size={22} />
    </Link>
  );
}
function Home() {
  const { user } = useApp();
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="badge">
            <span /> W TERENIE. RAZEM.
          </span>
          <h1>
            Wspólny start.
            <br />
            <span>Twoja historia.</span>
          </h1>
          <p>
            Małe i duże biegi, które łączą. Biegnij, pomagaj na mecie i zbieraj wspomnienia — o
            wyniki zadba HarcRun.
          </p>
          <div className="actions">
            <Link className="button" to={user ? '/panel' : '/konto'}>
              {user ? 'Mój panel' : 'Dołącz do biegu'} <ArrowUpRight size={19} />
            </Link>
            <Link className="button secondary" to="/wyniki">
              Zobacz wyniki
            </Link>
          </div>
          <div className="hero-note">
            <span className="mini-avatar">ZHR</span>
            <span>
              Dla harcerskiej społeczności
              <br />
              <strong>Jedno konto. Wiele wspólnych kilometrów.</strong>
            </span>
          </div>
        </div>
        <div className="trail-art" aria-hidden="true">
          <svg viewBox="0 0 520 500">
            <defs>
              <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#c9d0bd" />
              </pattern>
            </defs>
            <rect width="520" height="500" fill="url(#grid)" />
            <g fill="none" stroke="#c5cbb8" strokeWidth="1">
              <path d="M-80 370C50 50 120 480 260 130S630 210 600 440" />
              <path d="M-60 380C70 60 140 490 280 140S650 220 620 450" />
              <path d="M-40 390C90 70 160 500 300 150S670 230 640 460" />
              <path d="M-20 400C110 80 180 510 320 160S690 240 660 470" />
              <path d="M0 410C130 90 200 520 340 170S710 250 680 480" />
            </g>
            <path
              d="M94 380C17 257 282 363 199 215S370 75 395 143"
              fill="none"
              stroke="#2f5a45"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray="2 16"
            />
            <circle cx="94" cy="380" r="17" fill="#2f5a45" stroke="#f4f1e9" strokeWidth="8" />
            <circle cx="395" cy="143" r="22" fill="#c96a2e" stroke="#f4f1e9" strokeWidth="9" />
            <path d="M395 140V78l36 14-36 15" stroke="#21302a" fill="#e0b465" strokeWidth="4" />
            <g fill="#2f5a45">
              <path d="m94 160 27-49 27 49h-17l19 31H93l18-31Z" />
              <path d="m358 365 23-42 23 42h-14l16 27h-49l16-27Z" />
            </g>
          </svg>
          <div className="art-label">
            <span>KAŻDY KILOMETR SIĘ LICZY</span>
            <strong>Meta to dopiero początek.</strong>
            <Footprints size={26} />
          </div>
          <div className="art-distance">
            5<span>km</span>
            <small>albo tyle, ile zaplanujecie.</small>
          </div>
        </div>
      </section>
      <section className="how">
        <div>
          <span className="eyebrow">Prosty rytm biegu</span>
          <h2>Od startu do wspomnień.</h2>
        </div>
        <div className="steps">
          {[
            [QrCode, '01', 'Twój kod', 'Zaloguj się i zabierz swój QR. Ten sam na każdy bieg.'],
            [Timer, '02', 'Wspólny start', 'Stoper mierzy czas. Na mecie odbierasz token miejsca.'],
            [Trophy, '03', 'Twój wynik', 'Skanujemy dwa kody. Wynik trafia do Twojej historii.'],
          ].map(([Icon, n, title, description]) => {
            const I = Icon as typeof QrCode;
            return (
              <article key={String(n)}>
                <div className="step-top">
                  <I size={25} />
                  <span>{String(n)}</span>
                </div>
                <h3>{String(title)}</h3>
                <p>{String(description)}</p>
              </article>
            );
          })}
        </div>
      </section>
      <section className="organizer-banner">
        <Mountain size={38} />
        <div>
          <h2>Zorganizuj swój bieg.</h2>
          <p>Zbierz ekipę, przygotuj tokeny i ruszajcie. HarcRun pomoże na mecie.</p>
        </div>
        <Link className="button secondary" to="/nowy-bieg">
          Utwórz bieg <Plus size={18} />
        </Link>
      </section>
    </>
  );
}
function Results() {
  const [runs, setRuns] = useState<PublicRun[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(configured);
  useEffect(() => {
    if (!configured) return;
    return onSnapshot(
      collection(db, 'publicRuns'),
      (s) => {
        setRuns(
          s.docs
            .map((d) => ({ id: d.id, ...d.data() }) as PublicRun)
            .sort((a, b) => b.date.localeCompare(a.date)),
        );
        setLoading(false);
      },
      (e) => {
        setError(message(e));
        setLoading(false);
      },
    );
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="Na mecie"
        title="Wyniki biegów"
        description="Wspólne kilometry, zapisane na dłużej."
      />
      <ErrorBox error={error} />
      {loading ? (
        <Empty>Wczytywanie wyników…</Empty>
      ) : runs.length ? (
        <div className="card-grid">
          {runs.map((r) => (
            <RunCard key={r.id} run={r} />
          ))}
        </div>
      ) : (
        <Empty>Tu pojawią się wyniki pierwszego biegu po publikacji przez koordynatora.</Empty>
      )}
    </>
  );
}
function ResultTable({ rows }: { rows: PublicResult[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Miejsce</th>
            <th>Uczestnik</th>
            <th>Czas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.position}>
              <td>
                <span className={r.position <= 3 ? 'place podium' : 'place'}>
                  {String(r.position).padStart(2, '0')}
                </span>
              </td>
              <td>{r.name}</td>
              <td className="time-cell">{formatTime(r.elapsedMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export { ResultTable };
function PublicResults() {
  const { runId } = useParams();
  const [run, setRun] = useState<PublicRun | null>(null);
  const [rows, setRows] = useState<PublicResult[]>([]);
  const [error, setError] = useState('');
  const [version, setVersion] = useState('');
  useEffect(() => {
    if (!runId || !configured) return;
    return onSnapshot(
      doc(db, 'publicRuns', runId),
      (s) => {
        if (!s.exists()) {
          if (!s.metadata.fromCache) setError('Ten bieg nie ma jeszcze opublikowanych wyników.');
          return;
        }
        setRun({ id: s.id, ...s.data() } as PublicRun);
        setVersion(s.get('activeVersion'));
      },
      (e) => setError(message(e)),
    );
  }, [runId]);
  useEffect(() => {
    if (!version || !runId) return;
    setRows([]);
    return onSnapshot(
      doc(db, 'publicRuns', runId, 'versions', version),
      (s) => {
        setRows(s.get('rows') ?? []);
      },
      (e) => setError(message(e)),
    );
  }, [version, runId]);
  return (
    <>
      <Link className="back" to="/wyniki">
        <ArrowLeft size={16} /> Wszystkie wyniki
      </Link>
      <PageTitle
        eyebrow="Oficjalne wyniki"
        title={run?.name ?? 'Wyniki biegu'}
        description={
          run
            ? `${run.date} · ${run.distanceKm} km · finiszujących: ${run.count} · wersja ${run.version}`
            : ''
        }
      />
      <ErrorBox error={error} />
      <section className="panel">
        {rows.length ? (
          <ResultTable rows={rows} />
        ) : !error ? (
          <Empty>Wczytywanie wyników…</Empty>
        ) : null}
      </section>
    </>
  );
}
function Dashboard() {
  const { profile } = useApp();
  const [runs, setRuns] = useState<Run[]>([]);
  const [history, setHistory] = useState<{ run: PublicRun; result: PublicResult }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    if (!profile) return;
    call<typeof history>('listHistory')
      .then(setHistory)
      .catch((e) => setError(message(e)))
      .finally(() => setBusy(false));
    return onSnapshot(
      query(collection(db, 'runs'), where('memberUids', 'array-contains', profile.uid)),
      (s) =>
        setRuns(
          s.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Run)
            .sort((a, b) => b.date.localeCompare(a.date)),
        ),
      (e) => setError(message(e)),
    );
  }, [profile]);
  return (
    <>
      <PageTitle
        eyebrow="Twoja biegowa przestrzeń"
        title={`Cześć, ${profile!.name.split(' ')[0]}!`}
        description="Kod do kieszeni. Buty na nogi. Widzimy się na starcie."
      />
      <ErrorBox error={error} />
      <div className="dashboard-grid">
        <section className="panel qr-panel">
          <span className="eyebrow">Twój kod uczestnika</span>
          <QR value={participantQr(profile!.participantId)} />
          <h2>{profile!.name}</h2>
          <code>{profile!.participantId}</code>
          <p className="subtle">Pokaż skanerowi po odebraniu tokena miejsca.</p>
          <button className="secondary" onClick={() => window.print()}>
            Wydrukuj kod
          </button>
        </section>
        <div>
          <div className="stat-card">
            <Footprints size={30} />
            <strong>{busy ? '—' : history.length}</strong>
            <span>ukończonych biegów</span>
          </div>
          <section className="panel">
            <h2>Historia startów</h2>
            {busy ? (
              <p>Wczytywanie historii…</p>
            ) : history.length ? (
              history.map((h) => (
                <Link className="history-row" to={`/wyniki/${h.run.id}`} key={h.run.id}>
                  <div>
                    <strong>{h.run.name}</strong>
                    <small>
                      {h.run.date} · {h.run.distanceKm} km · miejsce {h.result.position}
                    </small>
                  </div>
                  <b>{formatTime(h.result.elapsedMs)}</b>
                </Link>
              ))
            ) : (
              <p>
                Twoja historia zacznie się od pierwszego biegu. Nie musisz zapisywać się wcześniej —
                wystarczy Twój kod na mecie.
              </p>
            )}
          </section>
        </div>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Po drugiej stronie mety</span>
          <h2>Organizowane biegi i wolontariat</h2>
        </div>
        <Link className="button" to="/nowy-bieg">
          <Plus size={18} /> Nowy bieg
        </Link>
      </div>
      {runs.length ? (
        <div className="card-grid">
          {runs.map((r) => (
            <RunCard run={r} key={r.id} manage />
          ))}
        </div>
      ) : (
        <Empty>
          Nie masz jeszcze biegów do obsługi. Utwórz pierwszy lub poproś koordynatora o dodanie do
          zespołu.
        </Empty>
      )}
    </>
  );
}
function NewRun() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [date, setDate] = useState(
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' }),
  );
  const [distance, setDistance] = useState('5');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await call<{ id: string }>('createRun', {
        name,
        date,
        distanceKm: Number(distance),
      });
      navigate(`/biegi/${result.id}`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="Zbierz swoją ekipę"
        title="Nowy bieg"
        description="Jeden start wspólny, do 500 uczestników. Nazwę możesz uzupełnić po biegu."
      />
      <form className="panel narrow stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <label>
          Nazwa wydarzenia
          <input
            placeholder="np. Zlot Zuchmistrzowski 2026"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </label>
        <label>
          Data biegu
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Dystans w kilometrach
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
        <button disabled={busy}>
          Utwórz bieg <ArrowUpRight size={18} />
        </button>
      </form>
    </>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  );
}
function RunDetail() {
  const { runId } = useParams();
  const { run, error } = usePrivateRun(runId);
  const { user } = useApp();
  return (
    <>
      <Link className="back" to="/panel">
        <ArrowLeft size={16} /> Mój panel
      </Link>
      <ErrorBox error={error} />
      {run ? (
        <>
          <PageTitle
            eyebrow={run.status === 'published' ? 'Opublikowany bieg' : 'Zespół mety'}
            title={run.name}
            description={`${run.date} · ${run.distanceKm} km`}
          />
          {run.status === 'draft' && (
            <div className="role-grid">
              <Link className="role-card" to={`/biegi/${run.id}/stoper`}>
                <Timer size={32} />
                <h2>Stoper</h2>
                <p>Jeden start. Każda meta zapisana.</p>
                <span>
                  Otwórz stoper <ArrowUpRight size={18} />
                </span>
              </Link>
              <Link className="role-card scanner" to={`/biegi/${run.id}/skaner`}>
                <ScanLine size={32} />
                <h2>Skaner</h2>
                <p>Połącz kod uczestnika z miejscem.</p>
                <span>
                  Otwórz skaner <ArrowUpRight size={18} />
                </span>
              </Link>
            </div>
          )}
          {run.status === 'published' && (
            <Link className="button" to={`/wyniki/${run.id}`}>
              Zobacz publiczne wyniki <ArrowUpRight size={18} />
            </Link>
          )}
          {run.ownerUid === user?.uid && <Coordinator run={run} />}
        </>
      ) : !error ? (
        <Empty>Wczytywanie biegu…</Empty>
      ) : null}
    </>
  );
}
function Tokens() {
  const [count, setCount] = useState(50);
  const [generated, setGenerated] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [readyImages, setReadyImages] = useState(0);
  return (
    <>
      <div className="no-print">
        <PageTitle
          eyebrow="Przygotowanie mety"
          title="Tokeny miejsc"
          description="Wielorazowe tokeny QR. Wręczaj w kolejności przekroczenia mety, zaczynając od 1."
        />
        <div className="panel actions">
          <label>
            Liczba tokenów
            <input
              type="number"
              min="1"
              max="500"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() => {
              setReadyImages(0);
              setGeneration((g) => g + 1);
              setGenerated(Math.min(500, Math.max(1, Math.floor(count || 1))));
            }}
          >
            Przygotuj tokeny
          </button>
          {generated > 0 && (
            <button
              className="secondary"
              disabled={readyImages < generated}
              onClick={() => window.print()}
            >
              {readyImages < generated ? 'Przygotowuję kody…' : 'Drukuj / zapisz PDF'}
            </button>
          )}
        </div>
      </div>
      <div className="token-grid">
        {Array.from({ length: generated }, (_, i) => (
          <div className="token" key={`${generation}:${i}`}>
            <span>HARCRUN · META</span>
            <strong>{i + 1}</strong>
            <QR value={tokenQr(i + 1)} size={125} onReady={() => setReadyImages((n) => n + 1)} />
            <code>{tokenQr(i + 1)}</code>
          </div>
        ))}
      </div>
    </>
  );
}
function Account() {
  return (
    <Protected>
      <Dashboard />
    </Protected>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setProfile(null);
        setLoading(Boolean(u));
        if (!u) setLoading(false);
      }),
    [],
  );
  useEffect(() => {
    if (!user || !user.emailVerified || !isZhrEmail(user.email ?? '')) {
      setLoading(false);
      return;
    }
    const key = `harcrun-profile-${user.uid}`;
    try {
      const p = localStorage.getItem(key);
      if (p) {
        setProfile(JSON.parse(p));
        setLoading(false);
      }
    } catch {}
    return onSnapshot(
      doc(db, 'profiles', user.uid),
      (s) => {
        if (s.exists()) {
          setProfile(s.data() as Profile);
          localStorage.setItem(key, JSON.stringify(s.data()));
        }
        setLoading(false);
      },
      (e) => {
        setError(message(e));
        setLoading(false);
      },
    );
  }, [user]);
  async function logout() {
    try {
      await signOut(auth);
      Object.keys(localStorage)
        .filter((k) => k.startsWith('harcrun-profile-') || k.startsWith('harcrun-run-'))
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <Context.Provider value={{ user, profile, loading, error, setError }}>
      <div className="site-shell">
        <header className="site-header no-print">
          <Link to="/" className="brand">
            <span className="brand-icon">
              <Flag size={23} />
            </span>
            Harc<span>Run</span>
            <small>WSPÓLNY START</small>
          </Link>
          <button className="mobile-menu ghost" aria-label="Menu" onClick={() => setMenu(!menu)}>
            <Menu />
          </button>
          <nav className={menu ? 'open' : ''} onClick={() => setMenu(false)}>
            <NavLink to="/" end>
              O HarcRun
            </NavLink>
            <NavLink to="/wyniki">Wyniki biegów</NavLink>
            <NavLink to="/panel">Mój panel</NavLink>
          </nav>
          <div className="header-account">
            {user ? (
              <button className="ghost" onClick={logout} title="Wyloguj">
                <LogOut size={18} />
                <span>{profile?.name.split(' ')[0] ?? 'Wyloguj'}</span>
              </button>
            ) : (
              <Link className="button small" to="/konto">
                Dołącz <ArrowUpRight size={16} />
              </Link>
            )}
          </div>
        </header>
        <main>
          {configured && !servicesReady && (
            <div className="notice no-print">
              Przygotowujemy pierwszy start. Logowanie i obsługa biegów zostaną uruchomione wkrótce.
            </div>
          )}
          {!configured && (
            <div className="notice no-print">
              Podgląd interfejsu. Aby uruchomić konta i zapisy, uzupełnij konfigurację Firebase w
              pliku .env.local zgodnie z README.
            </div>
          )}
          <ErrorBox error={error} />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/konto" element={<Account />} />
            <Route path="/panel" element={<Account />} />
            <Route path="/wyniki" element={<Results />} />
            <Route path="/wyniki/:runId" element={<PublicResults />} />
            <Route
              path="/nowy-bieg"
              element={
                <Protected>
                  <NewRun />
                </Protected>
              }
            />
            <Route
              path="/biegi/:runId"
              element={
                <Protected>
                  <RunDetail />
                </Protected>
              }
            />
            <Route
              path="/biegi/:runId/stoper"
              element={
                <Protected>
                  <Device role="timer" />
                </Protected>
              }
            />
            <Route
              path="/biegi/:runId/skaner"
              element={
                <Protected>
                  <Device role="scanner" />
                </Protected>
              }
            />
            <Route
              path="/tokeny"
              element={
                <Protected>
                  <Tokens />
                </Protected>
              }
            />
            <Route
              path="*"
              element={
                <Empty>
                  Nie ma takiej strony. <Link to="/">Wróć do startu.</Link>
                </Empty>
              }
            />
          </Routes>
        </main>
        <footer className="no-print">
          <Link className="brand" to="/">
            Harc<span>Run</span>
          </Link>
          <span>Wspólny start. Twoja historia.</span>
          <span>Z harcerską energią. W każdym tempie.</span>
        </footer>
      </div>
    </Context.Provider>
  );
}
