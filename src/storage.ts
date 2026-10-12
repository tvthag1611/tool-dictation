import type { Session, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const DB_NAME = 'dictation-tool';
const DB_VERSION = 1;
const SESSIONS = 'sessions';
const META = 'meta';
const SETTINGS_KEY = 'dictation.settings';
const LAST_SESSION_KEY = 'lastSessionId';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(SESSIONS)) {
      db.createObjectStore(SESSIONS, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(META)) {
      db.createObjectStore(META);
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  dbPromise = promise;
  return promise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const t = db.transaction(store, mode);
  const req = run(t.objectStore(store));
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  return promise;
}

export async function saveSession(session: Session): Promise<void> {
  await tx(SESSIONS, 'readwrite', (s) => s.put(session));
  await tx(META, 'readwrite', (s) => s.put(session.id, LAST_SESSION_KEY));
}

export async function loadLatestSession(): Promise<Session | null> {
  try {
    const lastId = await tx<string | undefined>(META, 'readonly', (s) => s.get(LAST_SESSION_KEY));
    if (lastId) {
      const session = await tx<Session | undefined>(SESSIONS, 'readonly', (s) => s.get(lastId));
      if (session) return session;
    }
    const all = await tx<Session[]>(SESSIONS, 'readonly', (s) => s.getAll());
    if (!all.length) return null;
    all.sort((a, b) => b.savedAt - a.savedAt);
    return all[0];
  } catch {
    return null;
  }
}

/* ---------- Settings (localStorage — nhỏ, đọc/ghi đồng bộ) ---------- */

/**
 * Bản 2: tắt "tự dừng cuối câu" và "tự lùi khi phát" cho người dùng cũ —
 * hai tính năng này mặc định bật ở bản 1 gây cảm giác khó điều khiển.
 */
const SETTINGS_VERSION_KEY = 'dictation.settingsV';
const SETTINGS_VERSION = 2;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s: Settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    if (Number(localStorage.getItem(SETTINGS_VERSION_KEY) || 1) < SETTINGS_VERSION) {
      s.sentenceMode = false;
      s.autoRewind = false;
      saveSettings(s);
      localStorage.setItem(SETTINGS_VERSION_KEY, String(SETTINGS_VERSION));
    }
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
