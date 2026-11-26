import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  connectAuthEmulator,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
const env = import.meta.env;
export const emulators = env.VITE_USE_EMULATORS === 'true';
export const servicesReady = emulators || env.VITE_SERVICES_READY !== 'false';
export const configured =
  emulators ||
  Boolean(
    env.VITE_FIREBASE_API_KEY &&
    env.VITE_FIREBASE_AUTH_DOMAIN &&
    env.VITE_FIREBASE_PROJECT_ID &&
    env.VITE_FIREBASE_APP_ID,
  );
const app = initializeApp({
  apiKey: emulators ? 'demo-key' : env.VITE_FIREBASE_API_KEY || 'demo-key',
  authDomain: emulators
    ? 'demo-harcrun.firebaseapp.com'
    : env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-harcrun.firebaseapp.com',
  projectId: emulators ? 'demo-harcrun' : env.VITE_FIREBASE_PROJECT_ID || 'demo-harcrun',
  appId: emulators ? 'demo-app' : env.VITE_FIREBASE_APP_ID || 'demo-app',
});
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-central2');
if (emulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
export async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: 'zhr.pl', prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}
export const emulatorLogin = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);
export async function call<T = unknown>(name: string, data: unknown = {}): Promise<T> {
  if (!servicesReady) throw new Error('Konta i obsługa biegów nie zostały jeszcze uruchomione.');
  return (await httpsCallable<unknown, T>(functions, name)(data)).data;
}
export function message(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Firebase:\s*/, '')
    : 'Nie udało się wykonać operacji.';
}
