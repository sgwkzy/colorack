import { useEffect, useReducer } from 'react';
import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import type { GoogleSignin as GoogleSigninType } from '@react-native-google-signin/google-signin';
import { getEntitlements, initSubscription, linkSubscriptionUser } from './subscription';
import { runAccountOperation } from './accountOperation';

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

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String(error.code);
  return code === 'storage/unauthorized' || code.endsWith('/permission-denied');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRevenueCatClaims(user: FirebaseAuthTypes.User): Promise<void> {
  const expected: string[] = [];
  const current = getEntitlements();
  if (current.hasBackup) expected.push('backup');
  if (current.hasPhotoBackup) expected.push('backup_photos');
  if (expected.length === 0) {
    await user.getIdToken(true);
    return;
  }

  const retryDelays = [0, 500, 1000, 2000, 3000, 3500];
  for (const waitMs of retryDelays) {
    if (waitMs > 0) await delay(waitMs);
    const result = await user.getIdTokenResult(true);
    const claims = result.claims.revenueCatEntitlements;
    if (Array.isArray(claims) && expected.every((id) => claims.includes(id))) return;
  }
  throw new Error('RevenueCat entitlements have not reached Firebase Auth yet.');
}

export async function withFreshFirebaseTokenRetry<T>(operation: () => PromiseLike<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const user = auth?.().currentUser;
    if (!user || !isPermissionDenied(error)) throw error;
    await waitForRevenueCatClaims(user);
    return await operation();
  }
}

async function signInWithFirebaseCredential(
  credential: FirebaseAuthTypes.AuthCredential
): Promise<FirebaseAuthTypes.UserCredential> {
  if (!auth) throw new Error('Firebase auth is not available.');
  return auth().signInWithCredential(credential);
}

async function completeFirebaseSignIn(
  credential: FirebaseAuthTypes.AuthCredential
): Promise<void> {
  const { user } = await signInWithFirebaseCredential(credential);
  await linkSubscriptionUser(user.uid);
  await waitForRevenueCatClaims(user);
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
      const subscriptionReady = linkSubscriptionUser(user?.uid ?? null)
        .then(() => user ? waitForRevenueCatClaims(user) : undefined)
        .catch((e) => console.error('initAuth: failed to link subscription user', e));
      if (!initialAuthResolved) {
        initialAuthResolved = true;
        subscriptionReady.finally(resolve);
      }
    });
  });

  return initPromise;
}

export async function signInWithGoogle(): Promise<void> {
  return runAccountOperation(async () => {
    if (!auth || !GoogleSignin) {
      throw new Error('Google sign-in is not available in Expo Go. Use a development build.');
    }
    configureGoogleSignin();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    await GoogleSignin.signIn();
    const { idToken } = await GoogleSignin.getTokens();
    if (!idToken) throw new Error('Google sign-in did not return an idToken.');
    const credential = auth.GoogleAuthProvider.credential(idToken);
    await completeFirebaseSignIn(credential);
  });
}

export async function signInWithApple(): Promise<void> {
  return runAccountOperation(async () => {
    if (!auth || !await AppleAuthentication.isAvailableAsync()) {
      throw new Error('Apple sign-in is not available.');
    }
    const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
    const bytes = await Crypto.getRandomBytesAsync(32);
    const rawNonce = Array.from(bytes, (byte) => charset[byte % charset.length]).join('');
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce
    );
    const result = await AppleAuthentication.signInAsync({
      nonce: hashedNonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!result.identityToken) throw new Error('Apple sign-in did not return an identity token.');
    const credential = auth.AppleAuthProvider.credential(result.identityToken, rawNonce);
    await completeFirebaseSignIn(credential);
  });
}

export async function ensureSubscriptionIdentity(expectedUid?: string): Promise<AuthUser> {
  if (!auth?.().currentUser) throw new Error('Firebase sign-in is required.');
  const user = auth().currentUser!;
  if (expectedUid && user.uid !== expectedUid) throw new Error('Firebase user changed before subscription operation.');
  await linkSubscriptionUser(user.uid);
  await waitForRevenueCatClaims(user);
  if (auth().currentUser?.uid !== user.uid) throw new Error('Firebase user changed during subscription operation.');
  return toAuthUser(user)!;
}

export function getCurrentAuthUser(): AuthUser | null {
  return currentUser;
}

export async function signOutUser(): Promise<void> {
  return runAccountOperation(async () => {
    if (GoogleSignin) {
      try {
        await GoogleSignin.signOut();
      } catch (e) {
        console.error('signOutUser: Google sign-out failed', e);
      }
    }
    if (auth) await auth().signOut();
  });
}

export function useAuthUser(): AuthUser | null {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  return currentUser;
}

