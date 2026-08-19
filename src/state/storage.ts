/**
 * Local dataset persistence.
 *
 * The parsed dataset is kept in IndexedDB in *this* browser so a reload does
 * not mean re-uploading a multi-gigabyte export. Nothing ever leaves the
 * device, and the header's "Clear data" action deletes it.
 */
import type { Dataset } from '../core/types.ts';

const DB_NAME = 'garmin-dashboard';
const STORE = 'datasets';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local database'));
  });
}

export async function saveDataset(dataset: Dataset): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(dataset, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save locally'));
    tx.onabort = () => reject(tx.error ?? new Error('Saving was aborted (storage quota?)'));
  });
  db.close();
}

export async function loadDataset(): Promise<Dataset | undefined> {
  const db = await openDb();
  const dataset = await new Promise<Dataset | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result as Dataset | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read local data'));
  });
  db.close();
  return dataset;
}

export async function clearDataset(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not clear local data'));
  });
  db.close();
}
