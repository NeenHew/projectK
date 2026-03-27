import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase,
  ref,
  child,
  get,
  set,
  update,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  off,
  serverTimestamp,
  push,
  runTransaction,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getDatabase(firebaseApp);

export const rtdb = {
  ref,
  child,
  get,
  set,
  update,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  off,
  serverTimestamp,
  push,
  runTransaction,
  onDisconnect,
};

export async function ensureAnonAuth() {
  const existing = auth.currentUser;
  if (existing) return existing;

  await signInAnonymously(auth);

  return await new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        if (!u) return;
        unsub();
        resolve(u);
      },
      (err) => {
        unsub();
        reject(err);
      },
    );
  });
}

