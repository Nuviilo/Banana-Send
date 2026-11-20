import React, { useState } from 'react';
import { FolderOpen, Download, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { IncomingTransferOffer } from '../types';
import { formatBytes, platformLabel } from '../utils/format';
import { supportsDirectoryPicker } from '../utils/storage';
import { PlatformIcon } from './BananaLogo';

interface ReceiveModalProps {
  offer: IncomingTransferOffer | null;
  defaultDirHandle: FileSystemDirectoryHandle | null;
  askSaveLocationEachTime: boolean;
  onAccept: (transferId: string, dirHandle: FileSystemDirectoryHandle | null) => void;
  onReject: (transferId: string) => void;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  offer,
  defaultDirHandle,
  askSaveLocationEachTime,
  onAccept,
  onReject,
}) => {
  const [chosenHandle, setChosenHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const canPickFolder = supportsDirectoryPicker();

  const activeHandle = chosenHandle || (askSaveLocationEachTime ? null : defaultDirHandle);

  const handleChooseFolder = async () => {
    if (!canPickFolder) return;
    try {
      const picker = (
        window as unknown as {
          showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker;
      const handle = await picker({ mode: 'readwrite' });
      setChosenHandle(handle);
    } catch {
      // User cancelled folder dialog
    }
  };

  const handleAcceptClick = async () => {
    if (!offer) return;
    let targetHandle = activeHandle;

    if (!targetHandle && askSaveLocationEachTime && canPickFolder) {
      try {
        const picker = (
          window as unknown as {
            showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
          }
        ).showDirectoryPicker;
        targetHandle = await picker({ mode: 'readwrite' });
      } catch {
        // Fallback to browser downloads if user cancels directory picker
      }
    }

    setChosenHandle(null);
    onAccept(offer.transferId, targetHandle);
  };

  const handleRejectClick = () => {
    if (!offer) return;
    setChosenHandle(null);
    onReject(offer.transferId);
  };

  return (
    <AnimatePresence>
      {offer && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#16161A] border border-[#E6E4DC] dark:border-[#27272C] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6E4DC] dark:border-[#27272C]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#FACC15]/20 text-[#171714] dark:text-[#FACC15] flex items-center justify-center shrink-0">
                  <PlatformIcon platform={offer.peerPlatform} className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[#171714] dark:text-[#F4F4F0] truncate">
                    Incoming Files from {offer.peerDeviceName}
                  </h2>
                  <p className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                    {platformLabel(offer.peerPlatform)} · {offer.files.length}{' '}
                    {offer.files.length === 1 ? 'file' : 'files'} ·{' '}
                    <span className="font-mono tabular-nums">{formatBytes(offer.totalSize)}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRejectClick}
                aria-label="Reject transfer"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#68665E] dark:text-[#A1A1AA] hover:bg-[#F3F2EC] dark:hover:bg-[#222228]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* File list */}
              <div className="max-h-48 overflow-y-auto divide-y divide-[#E6E4DC] dark:divide-[#27272C] rounded-xl border border-[#E6E4DC] dark:border-[#27272C]">
                {offer.files.map((f) => (
                  <div
                    key={f.index}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                  >
                    <span className="text-[#171714] dark:text-[#F4F4F0] truncate">
                      {f.relativePath || f.name}
                    </span>
                    <span className="font-mono tabular-nums text-xs text-[#68665E] dark:text-[#A1A1AA] shrink-0">
                      {formatBytes(f.size)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Save location */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E6E4DC] dark:border-[#27272C] px-4 py-3">
                <div className="min-w-0">
                  <div className="text-xs text-[#68665E] dark:text-[#A1A1AA]">Save to</div>
                  <div className="text-sm font-medium text-[#171714] dark:text-[#F4F4F0] truncate">
                    {activeHandle ? activeHandle.name : 'Browser Downloads Folder'}
                  </div>
                </div>
                {canPickFolder && (
                  <button
                    type="button"
                    onClick={handleChooseFolder}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#E6E4DC] dark:border-[#27272C] text-xs font-medium text-[#171714] dark:text-[#F4F4F0] hover:bg-[#FAF9F5] dark:hover:bg-[#222228] inline-flex items-center gap-1.5 shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Choose Folder
                  </button>
                )}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleRejectClick}
                  className="min-h-[46px] rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-sm font-semibold text-[#171714] dark:text-[#F4F4F0] hover:bg-[#FAF9F5] dark:hover:bg-[#222228] transition-colors"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={handleAcceptClick}
                  className="min-h-[46px] rounded-xl bg-[#FACC15] hover:bg-[#EAB308] text-[#171714] text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Accept
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
