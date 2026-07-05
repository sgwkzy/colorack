import { useEffect, useReducer } from 'react';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

export interface AuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
}

const listeners = new Set<() => void>();
let currentUser: AuthUser | null = null;
let initialAuthResolved = false;
let initPromise: Promise<void> | null = null;

function toAuthUser(user: FirebaseAuthTypes.User | null): AuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
  };
}

function notify(): void {
  listeners.forEach((l) => l());
}

function configureGoogleSignin(): void {
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID,
  });
}

async function signInWithFirebaseCredential(credential: FirebaseAuthTypes.AuthCredential): Promise<void> {
  await auth().signInWithCredential(credential);
}

export async function initAuth(): Promise<void> {
  if (initialAuthResolved) return;
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve) => {
    auth().onAuthStateChanged((user) => {
      currentUser = toAuthUser(user);
      notify();
      if (!initialAuthResolved) {
        initialAuthResolved = true;
        resolve();
      }
    });
  });

  return initPromise;
}

export async function signInWithGoogle(): Promise<void> {
  configureGoogleSignin();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  await GoogleSignin.signIn();
  const { idToken } = await GoogleSignin.getTokens();
  if (!idToken) throw new Error('Google sign-in did not return an idToken.');
  const credential = auth.GoogleAuthProvider.credential(idToken);
  await signInWithFirebaseCredential(credential);
}

export async function signOutUser(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch (e) {
    console.error('signOutUser: Google sign-out failed', e);
  }
  await auth().signOut();
}

export function useAuthUser(): AuthUser | null {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  return currentUser;
}

