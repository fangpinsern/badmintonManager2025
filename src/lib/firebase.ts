// Minimal Firebase initialization for client-side Firestore usage
import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  getAuth,
  initializeAuth,
  browserPopupRedirectResolver,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  setPersistence,
  type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY as string,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN as string,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID as string,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: process.env
    .NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID as string,
};

function getFirebaseApp() {
  if (!getApps().length) {
    return initializeApp(firebaseConfig);
  }
  return getApp();
}

export const app = getFirebaseApp();
export const db = getFirestore(app);
// Robust Auth initialization with multi-persistence and popup/redirect resolver.
// This mitigates browsers where sessionStorage/IndexedDB are blocked (e.g., iOS PWA, Safari ITP),
// avoiding "Unable to process request due to missing initial state" errors.
let _auth: Auth;
if (typeof window === "undefined") {
  // SSR/edge: return a minimal instance; no persistence needed server-side.
  _auth = getAuth(app);
} else {
  try {
    _auth = initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        inMemoryPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // If already initialized elsewhere, fall back to existing instance.
    _auth = getAuth(app);
    // Ensure at least some persistence is set; ignore failures quietly.
    (async () => {
      try {
        await setPersistence(_auth, indexedDBLocalPersistence);
      } catch {
        try {
          await setPersistence(_auth, browserLocalPersistence);
        } catch {
          try {
            await setPersistence(_auth, inMemoryPersistence);
          } catch {}
        }
      }
    })();
  }
}
export const auth = _auth;
