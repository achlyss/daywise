// ---------------------------------------------------------------------------
// Daywise — Entry store: Firestore when Firebase is live, localStorage when
// running in local demo mode. Both backends expose the same API, so the UI
// never has to care which one is active.
// ---------------------------------------------------------------------------
// Firestore layout (per anonymous user):
//   users/{uid}/entries/{entryId}
//   { text, mood (manual, optional), createdAt (server timestamp),
//     createdAtMs (number, for reliable client-side ordering),
//     ai: { mood, energy, tags, summary, path, latencyMs, at } | null,
//     question: { text, path, latencyMs, at } | null }
// ---------------------------------------------------------------------------

import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

const LOCAL_KEY = "daywise.entries.v1";

function localLoad() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function localSave(entries) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(entries));
}

function localId() {
  return "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function createStore(firebaseStatus) {
  const live = Boolean(firebaseStatus.configured && firebaseStatus.db && firebaseStatus.uid);
  const listeners = new Set();
  let entries = [];
  let unsubscribe = null;

  function emit() {
    const sorted = [...entries].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    listeners.forEach((fn) => fn(sorted));
  }

  function toPublic(docSnap) {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      text: data.text || "",
      mood: data.mood || "",
      createdAtMs: data.createdAtMs || (data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now()),
      ai: data.ai || null,
      question: data.question || null,
    };
  }

  async function start() {
    if (live) {
      const db = firebaseStatus.db;
      const entriesRef = collection(db, "users", firebaseStatus.uid, "entries");
      const q = query(entriesRef, orderBy("createdAtMs", "desc"));
      unsubscribe = onSnapshot(
        q,
        (snap) => {
          entries = snap.docs.map(toPublic);
          emit();
        },
        (err) => {
          console.warn("[Daywise] Firestore listener failed, staying with last known entries:", err);
        }
      );
    } else {
      entries = localLoad().map((e) => ({
        id: e.id,
        text: e.text || "",
        mood: e.mood || "",
        createdAtMs: e.createdAtMs || Date.now(),
        ai: e.ai || null,
        question: e.question || null,
      }));
      emit();
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn([...entries].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)));
    return () => listeners.delete(fn);
  }

  async function addEntry({ text, mood }) {
    const clean = String(text || "").trim();
    if (!clean) throw new Error("Entry text is empty.");
    if (live) {
      const db = firebaseStatus.db;
      const ref = await addDoc(collection(db, "users", firebaseStatus.uid, "entries"), {
        text: clean,
        mood: mood || "",
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
        ai: null,
        question: null,
      });
      return ref.id;
    }
    const entry = {
      id: localId(),
      text: clean,
      mood: mood || "",
      createdAtMs: Date.now(),
      ai: null,
      question: null,
    };
    entries = [entry, ...entries];
    localSave(entries);
    emit();
    return entry.id;
  }

  async function updateEntry(id, patch) {
    if (live) {
      await updateDoc(doc(firebaseStatus.db, "users", firebaseStatus.uid, "entries", id), patch);
      return;
    }
    entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
    localSave(entries);
    emit();
  }

  async function deleteEntry(id) {
    if (live) {
      await deleteDoc(doc(firebaseStatus.db, "users", firebaseStatus.uid, "entries", id));
      return;
    }
    entries = entries.filter((e) => e.id !== id);
    localSave(entries);
    emit();
  }

  async function eraseAll() {
    if (live) {
      await Promise.all(entries.map((e) => deleteDoc(doc(firebaseStatus.db, "users", firebaseStatus.uid, "entries", e.id))));
      return;
    }
    entries = [];
    localSave(entries);
    emit();
  }

  function getEntries() {
    return [...entries].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  }

  function stop() {
    if (unsubscribe) unsubscribe();
  }

  // Keep the Firestore import referenced when running in demo mode so
  // bundlers/analyzers see the real usage (the live path above uses it).
  void getFirestore;

  return { mode: live ? "firestore" : "local", start, subscribe, addEntry, updateEntry, deleteEntry, eraseAll, getEntries, stop };
}
