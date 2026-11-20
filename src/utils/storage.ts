import type { AppSettings, PairedDevice, TransferHistoryEntry } from '../types';
import { generateUuid36, getDefaultDeviceName } from './format';

const DEVICE_ID_KEY = 'banana_send_device_id';
const SETTINGS_KEY = 'banana_send_settings';
const PEERS_KEY = 'banana_send_peers';
const HISTORY_KEY = 'banana_send_history';

export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.length === 36) {
      return existing;
    }
    const created = generateUuid36();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return generateUuid36();
  }
}

export const DEFAULT_PACKAGED_SIGNALING_URL =
  'https://ais-pre-zhaip3imnwhyehpp2jvlq6-646622080348.asia-southeast1.run.app';

export function isPackagedNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.bananaDesktop?.isDesktopApp ||
      window.BananaAndroidBridge?.isAndroidApp?.() ||
      window.location.hostname === 'appassets.androidplatform.net'
  );
}

export function getEffectiveSignalingHttpUrl(customUrl?: string): string {
  const cleaned = (customUrl || '').trim().replace(/\/+$/, '');
  if (cleaned) return cleaned;
  if (typeof window !== 'undefined' && !isPackagedNativeShell()) {
    return window.location.origin;
  }
  return DEFAULT_PACKAGED_SIGNALING_URL;
}

export function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    theme: 'system',
    deviceName: getDefaultDeviceName(),
    askSaveLocationEachTime: false,
    defaultDownloadFolderName: null,
    launchOnStartupNoteDismissed: false,
    serverUrl: '',
  };

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota errors
  }
}

export function loadStoredPeers(): PairedDevice[] {
  try {
    const raw = localStorage.getItem(PEERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PairedDevice[];
    return parsed.map((p) => ({
      ...p,
      online: false,
      connectionState: 'offline',
    }));
  } catch {
    return [];
  }
}

export function saveStoredPeers(peers: PairedDevice[]): void {
  try {
    localStorage.setItem(PEERS_KEY, JSON.stringify(peers));
  } catch {
    // Ignore
  }
}

export function loadTransferHistory(): TransferHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TransferHistoryEntry[];
  } catch {
    return [];
  }
}

export function saveTransferHistory(entries: TransferHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 200)));
  } catch {
    // Ignore
  }
}

// IndexedDB persistence for FileSystemDirectoryHandle (Windows / Desktop Chromium)
const IDB_NAME = 'banana-send-fs';
const IDB_STORE = 'handles';
const DOWNLOAD_DIR_KEY = 'default-download-dir';

function openFsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDefaultDirectoryHandle(
  handle: FileSystemDirectoryHandle | null
): Promise<void> {
  try {
    const db = await openFsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      if (handle) {
        store.put(handle, DOWNLOAD_DIR_KEY);
      } else {
        store.delete(DOWNLOAD_DIR_KEY);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore if IndexedDB is restricted
  }
}

export async function loadDefaultDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openFsDb();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(DOWNLOAD_DIR_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}
