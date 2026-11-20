import React, { useRef, useState } from 'react';
import {
  Check,
  File as FileIcon,
  FolderPlus,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ActiveTransfer, PairedDevice, QueuedFileItem } from '../types';
import {
  extractDroppedFiles,
  filesFromFileList,
  formatBytes,
  formatEta,
  formatSpeed,
  platformLabel,
} from '../utils/format';
import { PlatformIcon } from './BananaLogo';

interface SendViewProps {
  peers: PairedDevice[];
  selectedPeerIds: string[];
  onTogglePeer: (deviceId: string) => void;
  queuedFiles: QueuedFileItem[];
  onAddFiles: (items: QueuedFileItem[]) => void;
  onRemoveQueuedFile: (id: string) => void;
  onClearQueue: () => void;
  onSend: () => void;
  activeTransfers: ActiveTransfer[];
  onPauseTransfer: (transferId: string) => void;
  onResumeTransfer: (transferId: string) => void;
  onCancelTransfer: (transferId: string) => void;
  onDismissTransfer: (transferId: string) => void;
  onGoToDevices: () => void;
}

export const SendView: React.FC<SendViewProps> = ({
  peers,
  selectedPeerIds,
  onTogglePeer,
  queuedFiles,
  onAddFiles,
  onRemoveQueuedFile,
  onClearQueue,
  onSend,
  activeTransfers,
  onPauseTransfer,
  onResumeTransfer,
  onCancelTransfer,
  onDismissTransfer,
  onGoToDevices,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const readyPeers = peers.filter((p) => p.online && p.connectionState === 'connected');
  const totalQueuedSize = queuedFiles.reduce((acc, f) => acc + f.size, 0);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const items = await extractDroppedFiles(e.dataTransfer);
    if (items.length > 0) {
      onAddFiles(items);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const items = filesFromFileList(e.target.files);
    e.target.value = '';
    if (items.length > 0) {
      onAddFiles(items);
    }
  };

  const statusLabel = (t: ActiveTransfer) => {
    switch (t.status) {
      case 'awaiting_acceptance':
        return 'Waiting for receiver to accept...';
      case 'transferring':
        return `${formatSpeed(t.speedBps)} · ${formatEta(t.etaSeconds)}`;
      case 'paused':
        return 'Paused';
      case 'reconnecting':
        return 'Reconnecting automatically...';
      case 'completed':
        return t.direction === 'send'
          ? 'Sent'
          : `Saved to ${t.saveFolderName || 'Downloads'}`;
      case 'rejected':
        return 'Rejected by receiver';
      case 'cancelled':
        return 'Cancelled';
      case 'failed':
        return t.error || 'Transfer failed';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#171714] dark:text-[#F4F4F0]">
          Send
        </h1>
        <p className="mt-1 text-sm text-[#68665E] dark:text-[#A1A1AA]">
          Select connected devices and drop any files or folders — zero size limits
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: Target devices + File/Folder picker + Send CTA */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. Target Devices */}
          <section className="rounded-2xl border border-[#E6E4DC] dark:border-[#27272C] bg-white dark:bg-[#16161A] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#171714] dark:text-[#F4F4F0]">
                Destination Devices
              </h2>
              <span className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                {selectedPeerIds.length > 0
                  ? `${selectedPeerIds.length} selected`
                  : 'Select one or more'}
              </span>
            </div>

            {readyPeers.length === 0 ? (
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-[#68665E] dark:text-[#A1A1AA]">
                <span>No connected devices online right now.</span>
                <button
                  type="button"
                  onClick={onGoToDevices}
                  className="min-h-[40px] px-4 py-2 rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-xs font-semibold text-[#171714] dark:text-[#F4F4F0] hover:bg-[#FAF9F5] dark:hover:bg-[#222228] inline-flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Connect Device
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {readyPeers.map((peer) => {
                  const selected = selectedPeerIds.includes(peer.deviceId);
                  return (
                    <button
                      key={peer.deviceId}
                      type="button"
                      onClick={() => onTogglePeer(peer.deviceId)}
                      className={`min-h-[56px] px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                        selected
                          ? 'border-[#171714] dark:border-[#FACC15] bg-[#FACC15]/15 dark:bg-[#FACC15]/10'
                          : 'border-[#E6E4DC] dark:border-[#27272C] hover:bg-[#FAF9F5] dark:hover:bg-[#222228]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-[#FAF9F5] dark:bg-[#222228] border border-[#E6E4DC] dark:border-[#27272C] flex items-center justify-center text-[#171714] dark:text-[#F4F4F0] shrink-0">
                          <PlatformIcon platform={peer.platform} className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#171714] dark:text-[#F4F4F0] truncate">
                            {peer.deviceName}
                          </div>
                          <div className="text-xs text-[#68665E] dark:text-[#A1A1AA] truncate">
                            {platformLabel(peer.platform)} · Connected
                          </div>
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                          selected
                            ? 'bg-[#171714] border-[#171714] text-white dark:bg-[#FACC15] dark:border-[#FACC15] dark:text-[#171714]'
                            : 'border-[#D4D1C7] dark:border-[#3A3A42]'
                        }`}
                      >
                        {selected && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* 2. Dropzone & File/Folder Selection */}
          <section className="rounded-2xl border border-[#E6E4DC] dark:border-[#27272C] bg-white dark:bg-[#16161A] p-5 space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is standard in Chromium/Edge/Android WebView
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={handleFileChange}
            />

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                isDragging
                  ? 'border-[#EAB308] bg-[#FACC15]/10'
                  : 'border-[#DDDAD0] dark:border-[#2E2E35] bg-[#FAF9F5]/70 dark:bg-[#0E0E10]/50'
              }`}
            >
              <div className="mx-auto w-12 h-12 rounded-2xl bg-white dark:bg-[#1C1C22] border border-[#E6E4DC] dark:border-[#27272C] flex items-center justify-center text-[#171714] dark:text-[#FACC15]">
                <Upload className="w-5 h-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-[#171714] dark:text-[#F4F4F0]">
                Drag and drop files or folders here
              </p>
              <p className="mt-1 text-xs text-[#68665E] dark:text-[#A1A1AA]">
                Supports videos, archives, APKs, EXEs, documents, and nested folders
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-white dark:bg-[#222228] border border-[#E6E4DC] dark:border-[#32323A] text-sm font-medium text-[#171714] dark:text-[#F4F4F0] hover:bg-[#F3F2EC] dark:hover:bg-[#2A2A32] transition-colors inline-flex items-center gap-2"
                >
                  <FileIcon className="w-4 h-4" />
                  Select Files
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-white dark:bg-[#222228] border border-[#E6E4DC] dark:border-[#32323A] text-sm font-medium text-[#171714] dark:text-[#F4F4F0] hover:bg-[#F3F2EC] dark:hover:bg-[#2A2A32] transition-colors inline-flex items-center gap-2"
                >
                  <FolderPlus className="w-4 h-4" />
                  Select Folder
                </button>
              </div>
            </div>

            {/* Queued files list */}
            {queuedFiles.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-[#68665E] dark:text-[#A1A1AA]">
                  <span className="font-mono tabular-nums">
                    {queuedFiles.length} {queuedFiles.length === 1 ? 'item' : 'items'} ·{' '}
                    {formatBytes(totalQueuedSize)}
                  </span>
                  <button
                    type="button"
                    onClick={onClearQueue}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#68665E] dark:text-[#A1A1AA] hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear all
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto divide-y divide-[#E6E4DC] dark:divide-[#27272C] rounded-xl border border-[#E6E4DC] dark:border-[#27272C]">
                  {queuedFiles.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[#171714] dark:text-[#F4F4F0] truncate">
                          {item.relativePath}
                        </div>
                        <div className="text-xs font-mono tabular-nums text-[#68665E] dark:text-[#A1A1AA]">
                          {formatBytes(item.size)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveQueuedFile(item.id)}
                        aria-label={`Remove ${item.name}`}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#68665E] dark:text-[#A1A1AA] hover:text-red-600 dark:hover:text-red-400 hover:bg-[#FAF9F5] dark:hover:bg-[#222228]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={onSend}
                  disabled={selectedPeerIds.length === 0 || queuedFiles.length === 0}
                  className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#FACC15] hover:bg-[#EAB308] text-[#171714] font-semibold text-sm disabled:opacity-40 disabled:pointer-events-none transition-colors flex items-center justify-center gap-2 shadow-xs"
                >
                  <Send className="w-4 h-4" />
                  {selectedPeerIds.length === 0
                    ? 'Select a destination device above'
                    : `Send ${queuedFiles.length} ${queuedFiles.length === 1 ? 'item' : 'items'} (${formatBytes(totalQueuedSize)}) to ${selectedPeerIds.length} ${selectedPeerIds.length === 1 ? 'device' : 'devices'}`}
                </button>
              </div>
            )}
          </section>
        </div>

        {/* Right column: Active Transfers */}
        <div className="lg:col-span-5">
          <section className="rounded-2xl border border-[#E6E4DC] dark:border-[#27272C] bg-white dark:bg-[#16161A] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#171714] dark:text-[#F4F4F0]">
                Active Transfers
              </h2>
              <span className="text-xs font-mono tabular-nums text-[#68665E] dark:text-[#A1A1AA]">
                {activeTransfers.length}
              </span>
            </div>

            {activeTransfers.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#68665E] dark:text-[#A1A1AA]">
                No active transfers. Select files and press Send to begin streaming.
              </div>
            ) : (
              <div className="space-y-4">
                {activeTransfers.map((t) => {
                  const pct =
                    t.totalSize > 0
                      ? Math.min(100, (t.bytesTransferred / t.totalSize) * 100)
                      : t.status === 'completed'
                      ? 100
                      : 0;
                  const currentFile =
                    t.files[t.currentFileIndex]?.relativePath ||
                    t.files[0]?.name ||
                    'Transfer';
                  const isRunning =
                    t.status === 'transferring' ||
                    t.status === 'paused' ||
                    t.status === 'reconnecting' ||
                    t.status === 'awaiting_acceptance';

                  return (
                    <div
                      key={t.transferId}
                      className="pt-4 first:pt-0 border-t first:border-t-0 border-[#E6E4DC] dark:border-[#27272C] space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#171714] dark:text-[#F4F4F0] truncate">
                            {t.direction === 'send' ? 'To ' : 'From '}
                            {t.peerDeviceName}
                          </div>
                          <div className="text-xs text-[#68665E] dark:text-[#A1A1AA] truncate">
                            {currentFile}
                            {t.files.length > 1
                              ? ` (${Math.min(t.currentFileIndex + 1, t.files.length)} of ${t.files.length} files)`
                              : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {t.status === 'transferring' && (
                            <button
                              type="button"
                              onClick={() => onPauseTransfer(t.transferId)}
                              title="Pause transfer"
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#E6E4DC] dark:border-[#27272C] text-[#171714] dark:text-[#F4F4F0] hover:bg-[#FAF9F5] dark:hover:bg-[#222228]"
                            >
                              <Pause className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {t.status === 'paused' && (
                            <button
                              type="button"
                              onClick={() => onResumeTransfer(t.transferId)}
                              title="Resume transfer"
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-[#FACC15] text-[#171714] hover:bg-[#EAB308]"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isRunning ? (
                            <button
                              type="button"
                              onClick={() => onCancelTransfer(t.transferId)}
                              title="Cancel transfer"
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#E6E4DC] dark:border-[#27272C] text-[#68665E] dark:text-[#A1A1AA] hover:text-red-600 dark:hover:text-red-400"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onDismissTransfer(t.transferId)}
                              title="Dismiss"
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#68665E] dark:text-[#A1A1AA] hover:bg-[#FAF9F5] dark:hover:bg-[#222228]"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="h-2 rounded-full bg-[#F3F2EC] dark:bg-[#24242B] overflow-hidden">
                        <div
                          className={`h-full transition-all duration-200 ${
                            t.status === 'completed'
                              ? 'bg-emerald-500'
                              : t.status === 'cancelled' || t.status === 'rejected' || t.status === 'failed'
                              ? 'bg-red-500'
                              : t.status === 'paused'
                              ? 'bg-amber-500'
                              : 'bg-[#FACC15]'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs text-[#68665E] dark:text-[#A1A1AA]">
                        <span className="truncate">{statusLabel(t)}</span>
                        <span className="font-mono tabular-nums shrink-0">
                          {formatBytes(t.bytesTransferred)} / {formatBytes(t.totalSize)} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
