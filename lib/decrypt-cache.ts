// On-device cache of decrypted reports (IndexedDB), keyed by the tag's key + the encrypted payload, so each
// report is decrypted once per device instead of on every page load. Scoping by key means a cache hit can
// only return a report that actually decrypted with the key asking for it. Decrypted locations stay in this browser only,
// like the private keys in settings. Every call fails soft: no IndexedDB (private mode etc.) = no cache.

import { hashString } from "./jev";
import type { BatteryStatus, DecryptedPayload } from "./types";

/** Short, non-reversible tag for a private key, so entries are scoped per key without storing the key. */
const keyScope = (privateKey: string) => hashString(`findr-decrypt:${privateKey}`);

const DB_NAME = "findr";
const STORE = "decrypted-reports";
// v2: entries are scoped per key; v1 entries (payload-only keys) are dropped on upgrade.
const DB_VERSION = 2;

/** Compact stored form: seen time (ms), confidence, battery, lat, lon, accuracy. */
type Stored = [number, number, BatteryStatus, number, number, number];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const toStored = (p: DecryptedPayload): Stored => [
  p.date.getTime(),
  p.confidence,
  p.battery,
  p.location.latitude,
  p.location.longitude,
  p.location.accuracy,
];

const fromStored = (s: Stored): DecryptedPayload => ({
  date: new Date(s[0]),
  confidence: s[1],
  battery: s[2],
  location: { latitude: s[3], longitude: s[4], accuracy: s[5] },
});

/** Looks up many payloads (decrypted with this key) in one transaction; returns only the ones found. */
export async function getCachedDecrypted(
  payloads: string[],
  privateKey: string,
): Promise<Map<string, DecryptedPayload>> {
  const found = new Map<string, DecryptedPayload>();
  const db = await openDb();
  if (!db || payloads.length === 0) return found;
  const scope = keyScope(privateKey);
  return new Promise((resolve) => {
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      let pending = payloads.length;
      for (const p of payloads) {
        const req = store.get(`${scope}:${p}`);
        req.onsuccess = () => {
          if (req.result) found.set(p, fromStored(req.result as Stored));
          if (--pending === 0) resolve(found);
        };
        req.onerror = () => {
          if (--pending === 0) resolve(found);
        };
      }
    } catch {
      resolve(found);
    }
  });
}

export async function putCachedDecrypted(entries: [string, DecryptedPayload][], privateKey: string): Promise<void> {
  const db = await openDb();
  if (!db || entries.length === 0) return;
  const scope = keyScope(privateKey);
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const [payload, decrypted] of entries) store.put(toStored(decrypted), `${scope}:${payload}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearDecryptCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
