import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import type { AppUserProfile } from '../../types/notebook';
import { getFirebaseServices, isFirebaseConfigured } from './config';

const LOCAL_GUEST_PROFILE: AppUserProfile = {
  uid: 'local-student',
  displayName: 'Modo Local',
  email: null,
  photoURL: null,
  isAnonymous: true,
  provider: 'local',
};

function mapFirebaseUser(user: User): AppUserProfile {
  return {
    uid: user.uid,
    displayName: user.displayName || (user.isAnonymous ? 'Invitado' : user.email?.split('@')[0] || 'Estudiante'),
    email: user.email,
    photoURL: user.photoURL,
    isAnonymous: user.isAnonymous,
    provider: 'firebase',
  };
}

export function observeAuthProfile(callback: (profile: AppUserProfile | null) => void): () => void {
  const services = getFirebaseServices();
  if (!services || !isFirebaseConfigured) {
    callback(LOCAL_GUEST_PROFILE);
    return () => {};
  }

  return onAuthStateChanged(services.auth, (user) => {
    if (user) {
      callback(mapFirebaseUser(user));
    } else {
      callback(null);
    }
  });
}

export async function signInWithGoogle(): Promise<AppUserProfile> {
  const services = getFirebaseServices();
  if (!services) {
    throw new Error('Firebase no está configurado en .env todavía.');
  }
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(services.auth, provider);
  return mapFirebaseUser(cred.user);
}

export async function signInAsGuest(): Promise<AppUserProfile> {
  const services = getFirebaseServices();
  if (!services) {
    return LOCAL_GUEST_PROFILE;
  }
  const cred = await signInAnonymously(services.auth);
  return mapFirebaseUser(cred.user);
}

export async function signInWithEmail(email: string, password: string): Promise<AppUserProfile> {
  const services = getFirebaseServices();
  if (!services) {
    throw new Error('Firebase no está configurado en .env todavía.');
  }
  const cred = await signInWithEmailAndPassword(services.auth, email, password);
  return mapFirebaseUser(cred.user);
}

export async function registerWithEmail(email: string, password: string): Promise<AppUserProfile> {
  const services = getFirebaseServices();
  if (!services) {
    throw new Error('Firebase no está configurado en .env todavía.');
  }
  const cred = await createUserWithEmailAndPassword(services.auth, email, password);
  return mapFirebaseUser(cred.user);
}

export async function logoutFirebase(): Promise<void> {
  const services = getFirebaseServices();
  if (!services) return;
  await signOut(services.auth);
}

export async function getFirebaseIdToken(): Promise<string | null> {
  const services = getFirebaseServices();
  const current = services?.auth.currentUser;
  if (!current) return null;
  try {
    return await current.getIdToken();
  } catch {
    return null;
  }
}
