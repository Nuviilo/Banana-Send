export type DevicePlatform = 'windows' | 'android' | 'mac' | 'linux' | 'web';

export type ThemeMode = 'light' | 'dark' | 'system';

export type PeerConnectionState =
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'disconnected';

export interface PairedDevice {
  deviceId: string;
  deviceName: string;
  platform: DevicePlatform;
  pairedAt: number;
  lastSeenAt: number;
  online: boolean;
  connectionState: PeerConnectionState;
}

export interface NearbyDevice {
  deviceId: string;
  deviceName: string;
  platform: DevicePlatform;
}

export interface QueuedFileItem {
  id: string;
  file: File;
  name: string;
  relativePath: string;
  size: number;
  type: string;
}

export interface TransferFileMeta {
  index: number;
  name: string;
  relativePath: string;
  size: number;
  type: string;
}

export type TransferDirection = 'send' | 'receive';

export type TransferStatus =
  | 'awaiting_acceptance'
  | 'transferring'
  | 'paused'
  | 'reconnecting'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface ActiveTransfer {
  transferId: string;
  direction: TransferDirection;
  peerDeviceId: string;
  peerDeviceName: string;
  peerPlatform: DevicePlatform;
  files: TransferFileMeta[];
  totalSize: number;
  bytesTransferred: number;
  currentFileIndex: number;
  currentFileOffset: number;
  speedBps: number;
  etaSeconds: number | null;
  status: TransferStatus;
  error?: string;
  startedAt: number;
  saveMode?: 'directory' | 'browser';
  saveFolderName?: string;
}

export interface IncomingTransferOffer {
  transferId: string;
  peerDeviceId: string;
  peerDeviceName: string;
  peerPlatform: DevicePlatform;
  files: TransferFileMeta[];
  totalSize: number;
  receivedAt: number;
}

export interface TransferHistoryEntry {
  id: string;
  transferId: string;
  direction: TransferDirection;
  peerDeviceId: string;
  peerDeviceName: string;
  peerPlatform: DevicePlatform;
  fileNames: string[];
  fileCount: number;
  totalSize: number;
  status: 'completed' | 'cancelled' | 'rejected' | 'failed';
  timestamp: number;
}

export interface AppSettings {
  theme: ThemeMode;
  deviceName: string;
  askSaveLocationEachTime: boolean;
  defaultDownloadFolderName: string | null;
  launchOnStartupNoteDismissed: boolean;
  serverUrl: string;
}

export interface IncomingPairInvite {
  fromDeviceId: string;
  fromDeviceName: string;
  fromPlatform: DevicePlatform;
}

declare global {
  interface Window {
    bananaDesktop?: {
      isDesktopApp: boolean;
      platform: string;
      getStartupEnabled: () => Promise<boolean>;
      setStartupEnabled: (enabled: boolean) => Promise<boolean>;
    };
    BananaAndroidBridge?: {
      isAndroidApp: () => boolean;
      beginFileSave: (fileName: string, mimeType: string) => string;
      appendFileChunk: (token: string, base64Chunk: string) => boolean;
      finishFileSave: (token: string, success: boolean) => void;
    };
  }
}
