import { useEffect, useReducer } from 'react';
import Constants from 'expo-constants';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import type { GoogleSignin as GoogleSigninType } from '@react-native-google-signin/google-signin';
import { initSubscription, linkSubscriptionUser } from './subscription';

const isExpoGo = Constants.appOwnership === 'expo';

// Expo Goのバイナリにはネイティブモジュールが含まれないため、
// import(=require)時点でクラッシュする。mobileAds.native.tsと同じパターンで
// Expo Go実行時はrequireせずnullにフォールバックする。
const auth: typeof import('@react-native-firebase/auth').default | null = isExpoGo
  ? null
  : (require('@react-native-firebase/auth').default as typeof import('@react-native-firebase/auth').default);
const GoogleSignin: typeof GoogleSigninType | null = isExpoGo
  ? null
  : (require('@react-native-google-signin/google-signin').GoogleSignin as typeof GoogleSigninType);

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
  if (!GoogleSignin) return;
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID,
  });
}

async function signInWithFirebaseCredential(credential: FirebaseAuthTypes.AuthCredential): Promise<void> {
  if (!auth) return;
  await auth().signInWithCredential(credential);
}

export async function initAuth(): Promise<void> {
  if (initialAuthResolved) return;
  if (initPromise) return initPromise;

  // 広告非表示判定はGoogleサインイン状態に依存しないため、authの可否に関わらず
  // 先にRevenueCatを初期化する(Expo Go/未設定時は内部で何もしない)。
  await initSubscription();

  // signInWithGoogle() を一度も呼ばずに直接サインアウトした場合でも
  // GoogleSignin.signOut() がネイティブ側の設定不足で失敗しないよう、
  // 起動時にも設定しておく。
  configureGoogleSignin();

  if (!auth) {
    initialAuthResolved = true;
    return;
  }

  initPromise = new Promise((resolve) => {
    auth!().onAuthStateChanged((user) => {
      currentUser = toAuthUser(user);
      notify();
      linkSubscriptionUser(user?.uid ?? null).catch((e) => console.error('initAuth: failed to link subscription user', e));
      if (!initialAuthResolved) {
        initialAuthResolved = true;
        resolve();
      }
    });
  });

  return initPromise;
}

export async function signInWithGoogle(): Promise<void> {
  if (!auth || !GoogleSignin) {
    throw new Error('Google sign-in is not available in Expo Go. Use a development build.');
  }
  configureGoogleSignin();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  await GoogleSignin.signIn();
  const { idToken } = await GoogleSignin.getTokens();
  if (!idToken) throw new Error('Google sign-in did not return an idToken.');
  const credential = auth.GoogleAuthProvider.credential(idToken);
  await signInWithFirebaseCredential(credential);
}

export async function signOutUser(): Promise<void> {
  if (GoogleSignin) {
    try {
      await GoogleSignin.signOut();
    } catch (e) {
      console.error('signOutUser: Google sign-out failed', e);
    }
  }
  if (!auth) return;
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

