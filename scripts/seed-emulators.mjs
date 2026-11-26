import { createRequire } from 'node:module';
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error(
    'Ustaw FIREBASE_AUTH_EMULATOR_HOST i FIRESTORE_EMULATOR_HOST. Skrypt działa tylko lokalnie.',
  );
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'demo-harcrun' });
const auth = getAuth(app);
for (const [email, displayName] of [
  ['koordynator@zhr.pl', 'Jan Kowalski'],
  ['skaner@zhr.pl', 'Anna Nowak'],
]) {
  try {
    await auth.createUser({
      email,
      displayName,
      emailVerified: true,
      password: 'HarcRun-demo-2026!',
    });
  } catch (e) {
    if (e.code !== 'auth/email-already-exists') throw e;
  }
  console.log(`Konto emulatora: ${email}`);
}
console.log('Hasło lokalnych kont: HarcRun-demo-2026!');
