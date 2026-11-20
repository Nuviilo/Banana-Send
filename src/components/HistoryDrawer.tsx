import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { TransferHistoryEntry } from '../types';
import { formatBytes, formatDateTime } from '../utils/format';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  entries: TransferHistoryEntry[];
  onClearHistory: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  entries,
  onClearHistory,
}) => {
  const [filter, setFilter] = useState<'all' | 'send' | 'receive'>('all');

  const filtered = entries.filter((e) => (filter === 'all' ? true : e.direction === filter));

  const statusText = (status: TransferHistoryEntry['status']) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      case 'rejected':
        return 'Rejected';
      default:
        return 'Failed';
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md h-full bg-white dark:bg-[#16161A] border-l border-[#E6E4DC] dark:border-[#27272C] shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6E4DC] dark:border-[#27272C]">
              <div>
                <h2 className="text-lg font-semibold text-[#171714] dark:text-[#F4F4F0]">
                  Transfer History
                </h2>
                <p className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                  Sent and received transfers on this device
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close history"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#68665E] dark:text-[#A1A1AA] hover:bg-[#F3F2EC] dark:hover:bg-[#222228]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-3 border-b border-[#E6E4DC] dark:border-[#27272C] flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F3F2EC] dark:bg-[#222228]">
                {(['all', 'send', 'receive'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setFilter(tab)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                      filter === tab
                        ? 'bg-white dark:bg-[#16161A] text-[#171714] dark:text-[#F4F4F0] shadow-xs'
                        : 'text-[#68665E] dark:text-[#A1A1AA]'
                    }`}
                  >
                    {tab === 'all' ? 'All' : tab === 'send' ? 'Sent' : 'Received'}
                  </button>
                ))}
              </div>

              {entries.length > 0 && (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="min-h-[36px] px-3 rounded-lg text-xs font-medium text-[#68665E] dark:text-[#A1A1AA] hover:text-red-600 dark:hover:text-red-400 hover:bg-[#FAF9F5] dark:hover:bg-[#222228] inline-flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {filtered.length === 0 ? (
                <div className="py-16 text-center text-sm text-[#68665E] dark:text-[#A1A1AA]">
                  No transfer history yet.
                </div>
              ) : (
                <div className="divide-y divide-[#E6E4DC] dark:divide-[#27272C]">
                  {filtered.map((entry) => {
                    const summaryName =
                      entry.fileCount === 1
                        ? entry.fileNames[0] || 'File'
                        : `${entry.fileNames[0] || 'Files'} + ${entry.fileCount - 1} more`;

                    return (
                      <div key={entry.id} className="py-4 flex items-start gap-3.5">
                        <div
                          className={`mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            entry.direction === 'send'
                              ? 'bg-[#FACC15]/20 text-[#171714] dark:text-[#FACC15]'
                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {entry.direction === 'send' ? (
                            <ArrowUpRight className="w-4 h-4" />
                          ) : (
                            <ArrowDownLeft className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-[#171714] dark:text-[#F4F4F0] truncate">
                            {summaryName}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#68665E] dark:text-[#A1A1AA]">
                            <span>
                              {entry.direction === 'send' ? 'To ' : 'From '}
                              {entry.peerDeviceName}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatBytes(entry.totalSize)}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[#68665E] dark:text-[#A1A1AA]">
                            <span>{formatDateTime(entry.timestamp)}</span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                entry.status === 'completed'
                                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                  : 'text-red-600 dark:text-red-400 font-medium'
                              }
                            >
                              {statusText(entry.status)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
