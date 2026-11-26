import { loadEnv } from 'vite';
const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
if (env.VITE_USE_EMULATORS === 'true')
  throw new Error('Wdrożenie zablokowane: wyłącz VITE_USE_EMULATORS w konfiguracji produkcyjnej.');
for (const key of [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
])
  if (!env[key]) throw new Error(`Wdrożenie wymaga ${key}. Uzupełnij .env.local zgodnie z README.`);
if (env.VITE_FIREBASE_PROJECT_ID.startsWith('demo-'))
  throw new Error('Nie można wdrażać konfiguracji emulatora.');
console.log('Konfiguracja produkcyjna Firebase sprawdzona.');
