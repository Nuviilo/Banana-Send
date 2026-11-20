import JSZip from 'jszip';
import type {
  ActiveTransfer,
  DevicePlatform,
  IncomingTransferOffer,
  QueuedFileItem,
  TransferFileMeta,
  TransferHistoryEntry,
} from '../types';
import { generateUuid36 } from '../utils/format';
import { ConnectionManager } from './connectionManager';

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks -> low RAM, smooth streaming

interface OutgoingRuntime {
  transfer: ActiveTransfer;
  items: QueuedFileItem[];
  paused: boolean;
  cancelled: boolean;
  accepted: boolean;
  resumeResolver: (() => void) | null;
  acceptResolver: ((accepted: boolean) => void) | null;
  resumeFrom: { fileIndex: number; offset: number } | null;
}

interface ReceivedFileBuffer {
  meta: TransferFileMeta;
  writable?: FileSystemWritableFileStream;
  opfsHandle?: FileSystemFileHandle;
  opfsName?: string;
  memoryChunks?: BlobPart[];
  bytesWritten: number;
}

interface IncomingRuntime {
  transfer: ActiveTransfer;
  dirHandle: FileSystemDirectoryHandle | null;
  useOpfs: boolean;
  files: ReceivedFileBuffer[];
  cancelled: boolean;
  paused: boolean;
}

export interface TransferEngineEvents {
  onTransfersChanged: (transfers: ActiveTransfer[]) => void;
  onIncomingOffer: (offer: IncomingTransferOffer) => void;
  onOfferResolved: (transferId: string) => void;
  onHistoryAdded: (entry: TransferHistoryEntry) => void;
  onTransferNotification: (title: string, body: string) => void;
}

export class TransferEngine {
  private conn: ConnectionManager;
  private events: TransferEngineEvents;
  private outgoing = new Map<string, OutgoingRuntime>();
  private incoming = new Map<string, IncomingRuntime>();
  private pendingOffers = new Map<string, IncomingTransferOffer>();
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  constructor(conn: ConnectionManager, events: TransferEngineEvents) {
    this.conn = conn;
    this.events = events;
  }

  public getActiveTransfers(): ActiveTransfer[] {
    const list: ActiveTransfer[] = [];
    for (const o of this.outgoing.values()) list.push({ ...o.transfer });
    for (const i of this.incoming.values()) list.push({ ...i.transfer });
    return list.sort((a, b) => b.startedAt - a.startedAt);
  }

  private emitTransfers(): void {
    this.events.onTransfersChanged(this.getActiveTransfers());
  }

  public async sendToPeer(
    peerDeviceId: string,
    peerDeviceName: string,
    peerPlatform: DevicePlatform,
    items: QueuedFileItem[]
  ): Promise<string> {
    const transferId = generateUuid36();
    const filesMeta: TransferFileMeta[] = items.map((item, idx) => ({
      index: idx,
      name: item.name,
      relativePath: item.relativePath,
      size: item.size,
      type: item.type,
    }));
    const totalSize = items.reduce((acc, f) => acc + f.size, 0);

    const transfer: ActiveTransfer = {
      transferId,
      direction: 'send',
      peerDeviceId,
      peerDeviceName,
      peerPlatform,
      files: filesMeta,
      totalSize,
      bytesTransferred: 0,
      currentFileIndex: 0,
      currentFileOffset: 0,
      speedBps: 0,
      etaSeconds: null,
      status: 'awaiting_acceptance',
      startedAt: Date.now(),
    };

    const runtime: OutgoingRuntime = {
      transfer,
      items,
      paused: false,
      cancelled: false,
      accepted: false,
      resumeResolver: null,
      acceptResolver: null,
      resumeFrom: null,
    };

    this.outgoing.set(transferId, runtime);
    this.emitTransfers();

    // Send transfer offer
    this.conn.sendControl(peerDeviceId, {
      type: 'transfer:offer',
      transferId,
      files: filesMeta,
      totalSize,
    });

    // Wait for acceptance
    const accepted = await new Promise<boolean>((resolve) => {
      runtime.acceptResolver = resolve;
    });

    if (!accepted || runtime.cancelled) {
      if (runtime.transfer.status !== 'rejected' && runtime.transfer.status !== 'cancelled') {
        runtime.transfer.status = 'cancelled';
      }
      this.emitTransfers();
      this.recordHistory(runtime.transfer);
      return transferId;
    }

    await this.streamOutgoingFiles(runtime);
    return transferId;
  }

  private async streamOutgoingFiles(runtime: OutgoingRuntime): Promise<void> {
    const { transfer, items } = runtime;
    transfer.status = 'transferring';
    this.emitTransfers();

    let bytesSent = 0;
    let windowStart = performance.now();
    let windowBytes = 0;

    let startIndex = 0;
    let startOffset = 0;

    if (runtime.resumeFrom) {
      startIndex = runtime.resumeFrom.fileIndex;
      startOffset = runtime.resumeFrom.offset;
      bytesSent =
        items.slice(0, startIndex).reduce((s, it) => s + it.size, 0) + startOffset;
      runtime.resumeFrom = null;
    }

    for (let i = startIndex; i < items.length; i++) {
      if (runtime.cancelled) break;
      let item = items[i];
      let offset = i === startIndex ? startOffset : 0;
      transfer.currentFileIndex = i;

      // Handle zero-byte files cleanly
      if (item.size === 0) {
        const frame = this.encodeChunkFrame(transfer.transferId, i, 0, new ArrayBuffer(0));
        this.conn.sendBinary(transfer.peerDeviceId, frame);
        this.conn.sendControl(transfer.peerDeviceId, {
          type: 'transfer:file-done',
          transferId: transfer.transferId,
          fileIndex: i,
        });
        continue;
      }

      while (offset < item.size) {
        if (runtime.cancelled) break;

        if (runtime.paused) {
          transfer.status = 'paused';
          transfer.speedBps = 0;
          transfer.etaSeconds = null;
          this.emitTransfers();
          await new Promise<void>((resolve) => {
            runtime.resumeResolver = resolve;
          });
          if (runtime.cancelled) break;
          const resumeTarget = this.consumeResumeTarget(runtime);
          if (resumeTarget) {
            i = resumeTarget.fileIndex;
            item = items[i];
            offset = resumeTarget.offset;
            transfer.currentFileIndex = i;
            bytesSent =
              items.slice(0, i).reduce((s, it) => s + it.size, 0) + offset;
          }
          transfer.status = 'transferring';
          windowStart = performance.now();
          windowBytes = 0;
          this.emitTransfers();
        }

        // Automatic recovery if peer connection temporarily drops
        if (!this.conn.isPeerReady(transfer.peerDeviceId)) {
          transfer.status = 'reconnecting';
          transfer.speedBps = 0;
          this.emitTransfers();
          await this.waitUntilPeerReady(runtime);
          if (runtime.cancelled) break;
          const recoverTarget = this.consumeResumeTarget(runtime);
          if (recoverTarget) {
            i = recoverTarget.fileIndex;
            item = items[i];
            offset = recoverTarget.offset;
            transfer.currentFileIndex = i;
            bytesSent =
              items.slice(0, i).reduce((s, it) => s + it.size, 0) + offset;
          }
          transfer.status = 'transferring';
          windowStart = performance.now();
          windowBytes = 0;
          this.emitTransfers();
        }

        const end = Math.min(offset + CHUNK_SIZE, item.size);
        const chunkBuffer = await item.file.slice(offset, end).arrayBuffer();
        const frame = this.encodeChunkFrame(transfer.transferId, i, offset, chunkBuffer);

        await this.conn.waitForBufferLow(transfer.peerDeviceId);
        const sent = this.conn.sendBinary(transfer.peerDeviceId, frame);
        if (!sent) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }

        const chunkLen = end - offset;
        offset = end;
        bytesSent += chunkLen;
        windowBytes += chunkLen;
        transfer.currentFileOffset = offset;
        transfer.bytesTransferred = bytesSent;

        const now = performance.now();
        const elapsedSec = (now - windowStart) / 1000;
        if (elapsedSec >= 0.35) {
          const speed = windowBytes / elapsedSec;
          transfer.speedBps = transfer.speedBps > 0 ? transfer.speedBps * 0.4 + speed * 0.6 : speed;
          const remaining = Math.max(0, transfer.totalSize - bytesSent);
          transfer.etaSeconds = transfer.speedBps > 0 ? remaining / transfer.speedBps : null;
          windowStart = now;
          windowBytes = 0;
          this.emitTransfers();
        }
      }

      if (!runtime.cancelled) {
        this.conn.sendControl(transfer.peerDeviceId, {
          type: 'transfer:file-done',
          transferId: transfer.transferId,
          fileIndex: i,
        });
      }
    }

    if (runtime.cancelled) {
      transfer.status = 'cancelled';
      transfer.speedBps = 0;
      transfer.etaSeconds = null;
      this.emitTransfers();
      this.recordHistory(transfer);
      return;
    }

    transfer.bytesTransferred = transfer.totalSize;
    transfer.speedBps = 0;
    transfer.etaSeconds = 0;
    transfer.status = 'completed';
    this.conn.sendControl(transfer.peerDeviceId, {
      type: 'transfer:complete',
      transferId: transfer.transferId,
    });
    this.emitTransfers();
    this.recordHistory(transfer);
    this.events.onTransferNotification(
      'Transfer Sent',
      `${items.length} ${items.length === 1 ? 'file' : 'files'} sent to ${transfer.peerDeviceName}`
    );
  }

  private consumeResumeTarget(
    runtime: OutgoingRuntime
  ): { fileIndex: number; offset: number } | null {
    const target = runtime.resumeFrom;
    runtime.resumeFrom = null;
    return target;
  }

  private async waitUntilPeerReady(runtime: OutgoingRuntime): Promise<void> {
    while (!runtime.cancelled && !this.conn.isPeerReady(runtime.transfer.peerDeviceId)) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  public pauseTransfer(transferId: string): void {
    const out = this.outgoing.get(transferId);
    if (out && out.transfer.status === 'transferring') {
      out.paused = true;
      out.transfer.status = 'paused';
      out.transfer.speedBps = 0;
      out.transfer.etaSeconds = null;
      this.conn.sendControl(out.transfer.peerDeviceId, {
        type: 'transfer:pause',
        transferId,
      });
      this.emitTransfers();
      return;
    }

    const inc = this.incoming.get(transferId);
    if (inc && inc.transfer.status === 'transferring') {
      inc.paused = true;
      inc.transfer.status = 'paused';
      inc.transfer.speedBps = 0;
      inc.transfer.etaSeconds = null;
      this.conn.sendControl(inc.transfer.peerDeviceId, {
        type: 'transfer:pause',
        transferId,
      });
      this.emitTransfers();
    }
  }

  public resumeTransfer(transferId: string): void {
    const out = this.outgoing.get(transferId);
    if (out && out.paused) {
      out.paused = false;
      this.conn.sendControl(out.transfer.peerDeviceId, {
        type: 'transfer:resume',
        transferId,
      });
      out.resumeResolver?.();
      out.resumeResolver = null;
      return;
    }

    const inc = this.incoming.get(transferId);
    if (inc && inc.paused) {
      inc.paused = false;
      inc.transfer.status = 'transferring';
      const resumeIndex = inc.transfer.currentFileIndex;
      const resumeOffset = inc.files[resumeIndex]?.bytesWritten || 0;
      this.conn.sendControl(inc.transfer.peerDeviceId, {
        type: 'transfer:resume',
        transferId,
        fileIndex: resumeIndex,
        offset: resumeOffset,
      });
      this.emitTransfers();
    }
  }

  public cancelTransfer(transferId: string): void {
    const out = this.outgoing.get(transferId);
    if (out) {
      out.cancelled = true;
      out.transfer.status = 'cancelled';
      out.transfer.speedBps = 0;
      out.transfer.etaSeconds = null;
      this.conn.sendControl(out.transfer.peerDeviceId, {
        type: 'transfer:cancel',
        transferId,
      });
      out.acceptResolver?.(false);
      out.resumeResolver?.();
      this.emitTransfers();
      this.recordHistory(out.transfer);
      return;
    }

    const inc = this.incoming.get(transferId);
    if (inc) {
      inc.cancelled = true;
      inc.transfer.status = 'cancelled';
      inc.transfer.speedBps = 0;
      inc.transfer.etaSeconds = null;
      this.conn.sendControl(inc.transfer.peerDeviceId, {
        type: 'transfer:cancel',
        transferId,
      });
      void this.cleanupIncoming(inc);
      this.emitTransfers();
      this.recordHistory(inc.transfer);
    }
  }

  public dismissTransfer(transferId: string): void {
    this.outgoing.delete(transferId);
    this.incoming.delete(transferId);
    this.emitTransfers();
  }

  public async acceptIncomingOffer(
    transferId: string,
    directoryHandle: FileSystemDirectoryHandle | null
  ): Promise<void> {
    const offer = this.pendingOffers.get(transferId);
    if (!offer) return;
    this.pendingOffers.delete(transferId);
    this.events.onOfferResolved(transferId);

    // Determine whether we can stream directly to chosen folder or OPFS
    let useOpfs = false;
    if (!directoryHandle && typeof navigator?.storage?.getDirectory === 'function') {
      useOpfs = true;
    }

    const files: ReceivedFileBuffer[] = offer.files.map((meta) => ({
      meta,
      bytesWritten: 0,
      memoryChunks: !directoryHandle && !useOpfs ? [] : undefined,
    }));

    const transfer: ActiveTransfer = {
      transferId,
      direction: 'receive',
      peerDeviceId: offer.peerDeviceId,
      peerDeviceName: offer.peerDeviceName,
      peerPlatform: offer.peerPlatform,
      files: offer.files,
      totalSize: offer.totalSize,
      bytesTransferred: 0,
      currentFileIndex: 0,
      currentFileOffset: 0,
      speedBps: 0,
      etaSeconds: null,
      status: 'transferring',
      startedAt: Date.now(),
      saveMode: directoryHandle ? 'directory' : 'browser',
      saveFolderName: directoryHandle?.name || 'Browser Downloads',
    };

    const runtime: IncomingRuntime = {
      transfer,
      dirHandle: directoryHandle,
      useOpfs,
      files,
      cancelled: false,
      paused: false,
    };

    this.incoming.set(transferId, runtime);
    this.emitTransfers();

    this.conn.sendControl(offer.peerDeviceId, {
      type: 'transfer:accept',
      transferId,
    });
  }

  public rejectIncomingOffer(transferId: string): void {
    const offer = this.pendingOffers.get(transferId);
    if (!offer) return;
    this.pendingOffers.delete(transferId);
    this.events.onOfferResolved(transferId);

    this.conn.sendControl(offer.peerDeviceId, {
      type: 'transfer:reject',
      transferId,
    });

    this.events.onHistoryAdded({
      id: `${transferId}-hist`,
      transferId,
      direction: 'receive',
      peerDeviceId: offer.peerDeviceId,
      peerDeviceName: offer.peerDeviceName,
      peerPlatform: offer.peerPlatform,
      fileNames: offer.files.map((f) => f.relativePath || f.name),
      fileCount: offer.files.length,
      totalSize: offer.totalSize,
      status: 'rejected',
      timestamp: Date.now(),
    });
  }

  public handleControlMessage(
    fromDeviceId: string,
    peerName: string,
    peerPlatform: DevicePlatform,
    msg: Record<string, unknown>
  ): void {
    const type = String(msg.type || '');
    const transferId = String(msg.transferId || '');

    if (type === 'transfer:offer') {
      const files = (msg.files as TransferFileMeta[]) || [];
      const totalSize = Number(msg.totalSize || 0);
      const offer: IncomingTransferOffer = {
        transferId,
        peerDeviceId: fromDeviceId,
        peerDeviceName: peerName,
        peerPlatform,
        files,
        totalSize,
        receivedAt: Date.now(),
      };
      this.pendingOffers.set(transferId, offer);
      this.events.onIncomingOffer(offer);
      return;
    }

    if (type === 'transfer:accept') {
      const out = this.outgoing.get(transferId);
      if (out) {
        out.accepted = true;
        out.acceptResolver?.(true);
        out.acceptResolver = null;
      }
      return;
    }

    if (type === 'transfer:reject') {
      const out = this.outgoing.get(transferId);
      if (out) {
        out.transfer.status = 'rejected';
        out.cancelled = true;
        out.acceptResolver?.(false);
        out.acceptResolver = null;
      }
      return;
    }

    if (type === 'transfer:pause') {
      const out = this.outgoing.get(transferId);
      if (out) {
        out.paused = true;
        out.transfer.status = 'paused';
        out.transfer.speedBps = 0;
        out.transfer.etaSeconds = null;
        this.emitTransfers();
      }
      const inc = this.incoming.get(transferId);
      if (inc) {
        inc.paused = true;
        inc.transfer.status = 'paused';
        inc.transfer.speedBps = 0;
        inc.transfer.etaSeconds = null;
        this.emitTransfers();
      }
      return;
    }

    if (type === 'transfer:resume') {
      const out = this.outgoing.get(transferId);
      if (out) {
        if (typeof msg.fileIndex === 'number' && typeof msg.offset === 'number') {
          out.resumeFrom = { fileIndex: msg.fileIndex, offset: msg.offset };
        }
        out.paused = false;
        out.resumeResolver?.();
        out.resumeResolver = null;
      }
      const inc = this.incoming.get(transferId);
      if (inc) {
        inc.paused = false;
        inc.transfer.status = 'transferring';
        this.emitTransfers();
      }
      return;
    }

    if (type === 'transfer:cancel') {
      const out = this.outgoing.get(transferId);
      if (out) {
        out.cancelled = true;
        out.transfer.status = 'cancelled';
        out.transfer.speedBps = 0;
        out.transfer.etaSeconds = null;
        out.acceptResolver?.(false);
        out.resumeResolver?.();
        this.emitTransfers();
        this.recordHistory(out.transfer);
      }
      const inc = this.incoming.get(transferId);
      if (inc) {
        inc.cancelled = true;
        inc.transfer.status = 'cancelled';
        inc.transfer.speedBps = 0;
        inc.transfer.etaSeconds = null;
        void this.cleanupIncoming(inc);
        this.emitTransfers();
        this.recordHistory(inc.transfer);
      }
      return;
    }

    if (type === 'transfer:file-done') {
      const inc = this.incoming.get(transferId);
      const fileIndex = Number(msg.fileIndex ?? -1);
      if (inc && fileIndex >= 0) {
        void this.finalizeIncomingFile(inc, fileIndex);
      }
      return;
    }

    if (type === 'transfer:complete') {
      const inc = this.incoming.get(transferId);
      if (inc) {
        void this.finalizeIncomingTransfer(inc);
      }
    }
  }

  public handlePeerReady(peerDeviceId: string): void {
    // Auto-recover interrupted incoming transfers by telling sender exact byte offset
    for (const inc of this.incoming.values()) {
      if (
        inc.transfer.peerDeviceId === peerDeviceId &&
        (inc.transfer.status === 'reconnecting' || inc.transfer.status === 'transferring') &&
        !inc.paused &&
        !inc.cancelled
      ) {
        const idx = inc.transfer.currentFileIndex;
        const offset = inc.files[idx]?.bytesWritten || 0;
        inc.transfer.status = 'transferring';
        this.conn.sendControl(peerDeviceId, {
          type: 'transfer:resume',
          transferId: inc.transfer.transferId,
          fileIndex: idx,
          offset,
        });
        this.emitTransfers();
      }
    }
  }

  public handlePeerDisconnected(peerDeviceId: string): void {
    for (const out of this.outgoing.values()) {
      if (out.transfer.peerDeviceId === peerDeviceId && out.transfer.status === 'transferring') {
        out.transfer.status = 'reconnecting';
        out.transfer.speedBps = 0;
        this.emitTransfers();
      }
    }
    for (const inc of this.incoming.values()) {
      if (inc.transfer.peerDeviceId === peerDeviceId && inc.transfer.status === 'transferring') {
        inc.transfer.status = 'reconnecting';
        inc.transfer.speedBps = 0;
        this.emitTransfers();
      }
    }
  }

  private lastSpeedTrack = new Map<string, { time: number; bytes: number }>();

  public async handleBinaryChunk(buffer: ArrayBuffer): Promise<void> {
    if (buffer.byteLength < 48) return;
    const transferId = this.decoder.decode(buffer.slice(0, 36)).trim();
    const view = new DataView(buffer);
    const fileIndex = view.getUint32(36, false);
    const offset = view.getFloat64(40, false);
    const chunk = buffer.slice(48);

    const inc = this.incoming.get(transferId);
    if (!inc || inc.cancelled) return;

    const fileRec = inc.files[fileIndex];
    if (!fileRec) return;

    inc.transfer.currentFileIndex = fileIndex;
    inc.transfer.currentFileOffset = offset + chunk.byteLength;

    if (chunk.byteLength > 0) {
      if (inc.dirHandle) {
        if (!fileRec.writable) {
          fileRec.writable = await this.openDirectoryFileWritable(
            inc.dirHandle,
            fileRec.meta.relativePath || fileRec.meta.name
          );
        }
        await fileRec.writable.write({
          type: 'write',
          position: offset,
          data: chunk,
        });
      } else if (inc.useOpfs) {
        if (!fileRec.writable) {
          const root = await navigator.storage.getDirectory();
          const opfsName = `banana_${transferId}_${fileIndex}`;
          fileRec.opfsName = opfsName;
          const handle = await root.getFileHandle(opfsName, { create: true });
          fileRec.opfsHandle = handle;
          fileRec.writable = await handle.createWritable();
        }
        await fileRec.writable.write({
          type: 'write',
          position: offset,
          data: chunk,
        });
      } else {
        fileRec.memoryChunks?.push(chunk);
      }
    }

    fileRec.bytesWritten = Math.max(fileRec.bytesWritten, offset + chunk.byteLength);
    const totalRecv = inc.files.reduce((sum, f) => sum + f.bytesWritten, 0);
    inc.transfer.bytesTransferred = Math.min(totalRecv, inc.transfer.totalSize);

    const now = performance.now();
    const tracker = this.lastSpeedTrack.get(transferId) || { time: now, bytes: 0 };
    tracker.bytes += chunk.byteLength;
    const elapsed = (now - tracker.time) / 1000;
    if (elapsed >= 0.35) {
      const speed = tracker.bytes / elapsed;
      inc.transfer.speedBps =
        inc.transfer.speedBps > 0 ? inc.transfer.speedBps * 0.4 + speed * 0.6 : speed;
      const remaining = Math.max(0, inc.transfer.totalSize - inc.transfer.bytesTransferred);
      inc.transfer.etaSeconds =
        inc.transfer.speedBps > 0 ? remaining / inc.transfer.speedBps : null;
      tracker.time = now;
      tracker.bytes = 0;
      this.emitTransfers();
    }
    this.lastSpeedTrack.set(transferId, tracker);
  }

  private async openDirectoryFileWritable(
    rootDir: FileSystemDirectoryHandle,
    relativePath: string
  ): Promise<FileSystemWritableFileStream> {
    const cleanParts = relativePath.split('/').filter((p) => p && p !== '.' && p !== '..');
    const fileName = cleanParts.pop() || 'file';
    let dir = rootDir;
    for (const folder of cleanParts) {
      dir = await dir.getDirectoryHandle(folder, { create: true });
    }
    const fh = await dir.getFileHandle(fileName, { create: true });
    return fh.createWritable();
  }

  private async finalizeIncomingFile(inc: IncomingRuntime, fileIndex: number): Promise<void> {
    const rec = inc.files[fileIndex];
    if (!rec) return;
    if (rec.writable) {
      try {
        await rec.writable.close();
      } catch {
        // Ignore if already closed
      }
      rec.writable = undefined;
    }
  }

  private async finalizeIncomingTransfer(inc: IncomingRuntime): Promise<void> {
    if (inc.cancelled) return;

    // Ensure all writables closed
    for (let i = 0; i < inc.files.length; i++) {
      await this.finalizeIncomingFile(inc, i);
    }

    // If not saved directly to a chosen OS directory, deliver via browser download
    if (!inc.dirHandle) {
      const hasFolderStructure = inc.files.some((f) =>
        (f.meta.relativePath || f.meta.name).includes('/')
      );

      if (hasFolderStructure && inc.files.length > 1) {
        // Package folder into a clean ZIP preserving exact directory tree
        const zip = new JSZip();
        for (const f of inc.files) {
          const path = f.meta.relativePath || f.meta.name;
          if (f.opfsHandle) {
            const fileObj = await f.opfsHandle.getFile();
            zip.file(path, fileObj);
          } else {
            zip.file(path, new Blob(f.memoryChunks || []));
          }
        }
        const rootFolderName = (inc.files[0].meta.relativePath || 'BananaSend').split('/')[0];
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        this.triggerBrowserDownload(zipBlob, `${rootFolderName}.zip`);
      } else {
        for (const f of inc.files) {
          if (f.opfsHandle) {
            const fileObj = await f.opfsHandle.getFile();
            this.triggerBrowserDownload(fileObj, f.meta.name);
          } else {
            const blob = new Blob(f.memoryChunks || [], {
              type: f.meta.type || 'application/octet-stream',
            });
            this.triggerBrowserDownload(blob, f.meta.name);
          }
        }
      }

      await this.cleanupOpfsTempFiles(inc);
    }

    inc.transfer.bytesTransferred = inc.transfer.totalSize;
    inc.transfer.speedBps = 0;
    inc.transfer.etaSeconds = 0;
    inc.transfer.status = 'completed';
    this.lastSpeedTrack.delete(inc.transfer.transferId);
    this.emitTransfers();
    this.recordHistory(inc.transfer);

    this.events.onTransferNotification(
      'Files Received',
      `${inc.files.length} ${inc.files.length === 1 ? 'file' : 'files'} received from ${inc.transfer.peerDeviceName}`
    );
  }

  private triggerBrowserDownload(blob: Blob, filename: string): void {
    if (window.BananaAndroidBridge?.isAndroidApp?.()) {
      void this.saveBlobToAndroidDownloads(blob, filename);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private async saveBlobToAndroidDownloads(blob: Blob, filename: string): Promise<void> {
    const bridge = window.BananaAndroidBridge;
    if (!bridge) return;
    const token = bridge.beginFileSave(filename, blob.type || 'application/octet-stream');
    if (!token) return;

    const sliceSize = 192 * 1024; // ~256 KB base64 chunks
    let success = true;
    try {
      for (let offset = 0; offset < blob.size; offset += sliceSize) {
        const buffer = await blob.slice(offset, Math.min(offset + sliceSize, blob.size)).arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        const ok = bridge.appendFileChunk(token, btoa(binary));
        if (!ok) {
          success = false;
          break;
        }
      }
    } catch {
      success = false;
    } finally {
      bridge.finishFileSave(token, success);
    }
  }

  private async cleanupIncoming(inc: IncomingRuntime): Promise<void> {
    for (const f of inc.files) {
      if (f.writable) {
        try {
          await f.writable.abort();
        } catch {
          // Ignore
        }
        f.writable = undefined;
      }
      if (f.memoryChunks) {
        f.memoryChunks = [];
      }
    }
    await this.cleanupOpfsTempFiles(inc);
  }

  private async cleanupOpfsTempFiles(inc: IncomingRuntime): Promise<void> {
    if (!inc.useOpfs) return;
    try {
      const root = await navigator.storage.getDirectory();
      for (const f of inc.files) {
        if (f.opfsName) {
          await root.removeEntry(f.opfsName).catch(() => {});
        }
      }
    } catch {
      // Ignore
    }
  }

  private encodeChunkFrame(
    transferId: string,
    fileIndex: number,
    offset: number,
    payload: ArrayBuffer
  ): ArrayBuffer {
    const out = new Uint8Array(48 + payload.byteLength);
    const idBytes = this.encoder.encode(transferId.padEnd(36, ' ').slice(0, 36));
    out.set(idBytes, 0);
    const view = new DataView(out.buffer);
    view.setUint32(36, fileIndex, false);
    view.setFloat64(40, offset, false);
    out.set(new Uint8Array(payload), 48);
    return out.buffer;
  }

  private recordHistory(transfer: ActiveTransfer): void {
    const statusMap: Record<string, 'completed' | 'cancelled' | 'rejected' | 'failed'> = {
      completed: 'completed',
      cancelled: 'cancelled',
      rejected: 'rejected',
      failed: 'failed',
    };
    const finalStatus = statusMap[transfer.status];
    if (!finalStatus) return;

    this.events.onHistoryAdded({
      id: `${transfer.transferId}-${Date.now()}`,
      transferId: transfer.transferId,
      direction: transfer.direction,
      peerDeviceId: transfer.peerDeviceId,
      peerDeviceName: transfer.peerDeviceName,
      peerPlatform: transfer.peerPlatform,
      fileNames: transfer.files.map((f) => f.relativePath || f.name),
      fileCount: transfer.files.length,
      totalSize: transfer.totalSize,
      status: finalStatus,
      timestamp: Date.now(),
    });
  }
}
