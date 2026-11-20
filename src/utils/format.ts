import type { DevicePlatform, QueuedFileItem } from '../types';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 100 || exp === 0 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[exp]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'Calculating...';
  if (seconds < 1) return '< 1s left';
  const s = Math.ceil(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, '0')}m left`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s left`;
  }
  return `${secs}s left`;
}

export function formatDateTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today · ${time}`;
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day} · ${time}`;
}

export function detectPlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return 'web';
}

export function platformLabel(platform: DevicePlatform): string {
  switch (platform) {
    case 'windows':
      return 'Windows';
    case 'android':
      return 'Android';
    case 'mac':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return 'Web';
  }
}

export function getDefaultDeviceName(): string {
  const platform = detectPlatform();
  const suffix = Math.floor(100 + Math.random() * 900);
  switch (platform) {
    case 'windows':
      return `Windows PC ${suffix}`;
    case 'android':
      return `Android Phone ${suffix}`;
    case 'mac':
      return `Mac ${suffix}`;
    case 'linux':
      return `Linux PC ${suffix}`;
    default:
      return `Banana Device ${suffix}`;
  }
}

export function generateUuid36(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback exact 36-char UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function parsePairCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Check if URL with ?pair=CODE
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const url = new URL(trimmed);
      const param = url.searchParams.get('pair');
      if (param) {
        const clean = param.toUpperCase().replace(/[^A-Z0-9]/g, '');
        return clean.length >= 4 ? clean : null;
      }
    }
  } catch {
    // Not a URL, fall through
  }

  // Check JSON payload
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as { code?: string };
      if (obj.code) {
        const clean = String(obj.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
        return clean.length >= 4 ? clean : null;
      }
    } catch {
      // Ignore
    }
  }

  const clean = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length === 6 ? clean : clean.length >= 4 ? clean : null;
}

export function formatCodeDisplay(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length === 6) {
    return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  }
  return clean;
}

// Recursive DataTransfer traversal so dropped folders on Windows preserve full relative paths
interface WebkitEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (success: (f: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: WebkitEntry[]) => void, error?: (err: unknown) => void) => void;
  };
}

async function readAllDirectoryEntries(entry: WebkitEntry): Promise<WebkitEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const all: WebkitEntry[] = [];
  while (true) {
    const batch = await new Promise<WebkitEntry[]>((resolve) => {
      reader.readEntries(
        (entries) => resolve(entries),
        () => resolve([])
      );
    });
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

async function traverseEntry(entry: WebkitEntry, prefixPath: string): Promise<QueuedFileItem[]> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) => {
      entry.file!(
        (f) => resolve(f),
        () => resolve(null)
      );
    });
    if (!file) return [];
    const relativePath = prefixPath ? `${prefixPath}/${file.name}` : file.name;
    return [
      {
        id: `${relativePath}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 7)}`,
        file,
        name: file.name,
        relativePath,
        size: file.size,
        type: file.type || 'application/octet-stream',
      },
    ];
  }

  if (entry.isDirectory) {
    const folderPath = prefixPath ? `${prefixPath}/${entry.name}` : entry.name;
    const children = await readAllDirectoryEntries(entry);
    const results: QueuedFileItem[] = [];
    for (const child of children) {
      const subItems = await traverseEntry(child, folderPath);
      results.push(...subItems);
    }
    return results;
  }

  return [];
}

export async function extractDroppedFiles(dataTransfer: DataTransfer): Promise<QueuedFileItem[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const entries: WebkitEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as DataTransferItem & { webkitGetAsEntry?: () => WebkitEntry | null };
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        entries.push(entry);
      }
    }

    if (entries.length > 0) {
      const collected: QueuedFileItem[] = [];
      for (const entry of entries) {
        const result = await traverseEntry(entry, '');
        collected.push(...result);
      }
      return collected;
    }
  }

  // Fallback to plain FileList
  const files = Array.from(dataTransfer.files || []);
  return files.map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return {
      id: `${rel}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name,
      relativePath: rel,
      size: file.size,
      type: file.type || 'application/octet-stream',
    };
  });
}

export function filesFromFileList(fileList: FileList | null): QueuedFileItem[] {
  if (!fileList) return [];
  return Array.from(fileList).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return {
      id: `${rel}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name,
      relativePath: rel,
      size: file.size,
      type: file.type || 'application/octet-stream',
    };
  });
}
