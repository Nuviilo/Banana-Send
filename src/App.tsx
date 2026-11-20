import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Download, Laptop, Send as SendIcon, Settings as SettingsIcon } from 'lucide-react';
import { BananaLogo } from './components/BananaLogo';
import { ConnectModal } from './components/ConnectModal';
import { DevicesView } from './components/DevicesView';
import { HistoryDrawer } from './components/HistoryDrawer';
import { ReceiveModal } from './components/ReceiveModal';
import { SendView } from './components/SendView';
import { SettingsModal } from './components/SettingsModal';
import { usePWAInstall } from './hooks/usePWAInstall';
import { useTheme } from './hooks/useTheme';
import { TransferEngine } from './services/transferEngine';
import { ConnectionManager } from './services/connectionManager';
import type {
  ActiveTransfer,
  AppSettings,
  IncomingPairInvite,
  IncomingTransferOffer,
  NearbyDevice,
  PairedDevice,
  QueuedFileItem,
  TransferHistoryEntry,
} from './types';
import { detectPlatform, parsePairCode } from './utils/format';
import {
  getOrCreateDeviceId,
  loadDefaultDirectoryHandle,
  loadSettings,
  loadStoredPeers,
  loadTransferHistory,
  saveDefaultDirectoryHandle,
  saveSettings,
  saveStoredPeers,
  saveTransferHistory,
  supportsDirectoryPicker,
} from './utils/storage';

type MainSection = 'devices' | 'send';

export default function App() {
  const [section, setSection] = useState<MainSection>('devices');
  const [deviceId] = useState<string>(() => getOrCreateDeviceId());
  const platform = useMemo(() => detectPlatform(), []);

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [peers, setPeers] = useState<PairedDevice[]>(() => loadStoredPeers());
  const [nearbyDevices, setNearbyDevices] = useState<NearbyDevice[]>([]);
  const [history, setHistory] = useState<TransferHistoryEntry[]>(() => loadTransferHistory());

  const [signalingConnected, setSignalingConnected] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairInvite, setPairInvite] = useState<IncomingPairInvite | null>(null);

  const [selectedPeerIds, setSelectedPeerIds] = useState<string[]>([]);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFileItem[]>([]);
  const [activeTransfers, setActiveTransfers] = useState<ActiveTransfer[]>([]);
  const [incomingOffers, setIncomingOffers] = useState<IncomingTransferOffer[]>([]);

  const [connectOpen, setConnectOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultDirHandle, setDefaultDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [toast, setToast] = useState<{ title: string; body?: string } | null>(null);

  const connRef = useRef<ConnectionManager | null>(null);
  const engineRef = useRef<TransferEngine | null>(null);
  const peersRef = useRef<PairedDevice[]>(peers);
  const pendingUrlPairCodeRef = useRef<string | null>(null);

  useTheme(settings.theme);
  const { canPromptInstall, isInstalled, promptInstall } = usePWAInstall();

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  // Capture ?pair=CODE if opened via QR scan or link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pairParam = params.get('pair');
    if (pairParam) {
      const parsed = parsePairCode(pairParam);
      if (parsed) {
        pendingUrlPairCodeRef.current = parsed;
      }
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, []);

  // Load persisted default download directory handle (if supported)
  useEffect(() => {
    void loadDefaultDirectoryHandle().then((handle) => {
      if (handle) setDefaultDirHandle(handle);
    });
  }, []);

  const showToast = useCallback((title: string, body?: string) => {
    setToast({ title, body });
    window.setTimeout(() => {
      setToast((curr) => (curr?.title === title ? null : curr));
    }, 4200);
  }, []);

  const fireBrowserNotification = useCallback(
    (title: string, body: string) => {
      showToast(title, body);
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        document.hidden
      ) {
        try {
          new Notification(title, { body, icon: '/pwa-192x192.png' });
        } catch {
          // Ignore notification errors in restricted contexts
        }
      }
    },
    [showToast]
  );

  // Initialize Connection + Transfer Engine
  useEffect(() => {
    let engine: TransferEngine;

    const conn = new ConnectionManager(deviceId, settings, loadStoredPeers(), {
      onServerStatus: (connected) => {
        setSignalingConnected(connected);
        if (connected && pendingUrlPairCodeRef.current) {
          const codeToJoin = pendingUrlPairCodeRef.current;
          pendingUrlPairCodeRef.current = null;
          window.setTimeout(() => {
            conn.joinWithCode(codeToJoin);
          }, 250);
        }
      },
      onPeersUpdated: (updatedPeers) => {
        setPeers(updatedPeers);
        saveStoredPeers(updatedPeers);
        setSelectedPeerIds((prev) =>
          prev.filter((id) =>
            updatedPeers.some(
              (p) => p.deviceId === id && p.online && p.connectionState === 'connected'
            )
          )
        );
      },
      onNearbyUpdated: (devices) => {
        setNearbyDevices(devices);
      },
      onPairingCodeCreated: (code) => {
        setPairingCode(code);
        setPairingError(null);
      },
      onPairingError: (message) => {
        setPairingError(message);
      },
      onPairMatched: (peer) => {
        setPairingCode(null);
        setPairingError(null);
        setConnectOpen(false);
        showToast('Device Connected', `${peer.deviceName} is ready for transfers`);
      },
      onIncomingPairInvite: (invite) => {
        setPairInvite(invite);
      },
      onControlMessage: (fromId, msg) => {
        const peer = peersRef.current.find((p) => p.deviceId === fromId);
        engine.handleControlMessage(
          fromId,
          peer?.deviceName || 'Device',
          peer?.platform || 'web',
          msg
        );
      },
      onBinaryMessage: (_fromId, payload) => {
        void engine.handleBinaryChunk(payload);
      },
      onPeerReady: (peerId) => {
        engine.handlePeerReady(peerId);
      },
      onPeerDisconnected: (peerId) => {
        engine.handlePeerDisconnected(peerId);
      },
    });

    engine = new TransferEngine(conn, {
      onTransfersChanged: (list) => {
        setActiveTransfers(list);
      },
      onIncomingOffer: (offer) => {
        setIncomingOffers((prev) => [...prev, offer]);
      },
      onOfferResolved: (transferId) => {
        setIncomingOffers((prev) => prev.filter((o) => o.transferId !== transferId));
      },
      onHistoryAdded: (entry) => {
        setHistory((prev) => {
          const next = [entry, ...prev].slice(0, 200);
          saveTransferHistory(next);
          return next;
        });
      },
      onTransferNotification: (title, body) => {
        fireBrowserNotification(title, body);
      },
    });

    connRef.current = conn;
    engineRef.current = engine;
    conn.start();

    return () => {
      conn.destroy();
      connRef.current = null;
      engineRef.current = null;
    };
    // Run once on mount for stable WebSocket lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const handleUpdateSettings = (next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
    connRef.current?.updateSettings(next);
  };

  const handlePickDefaultFolder = async () => {
    if (!supportsDirectoryPicker()) return;
    try {
      const picker = (
        window as unknown as {
          showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker;
      const handle = await picker({ mode: 'readwrite' });
      setDefaultDirHandle(handle);
      await saveDefaultDirectoryHandle(handle);
      handleUpdateSettings({ ...settings, defaultDownloadFolderName: handle.name });
    } catch {
      // Cancelled
    }
  };

  const handleClearDefaultFolder = async () => {
    setDefaultDirHandle(null);
    await saveDefaultDirectoryHandle(null);
    handleUpdateSettings({ ...settings, defaultDownloadFolderName: null });
  };

  const handleSendToDevice = (targetId: string) => {
    setSelectedPeerIds([targetId]);
    setSection('send');
  };

  const handleTogglePeer = (targetId: string) => {
    setSelectedPeerIds((prev) =>
      prev.includes(targetId) ? prev.filter((id) => id !== targetId) : [...prev, targetId]
    );
  };

  const handleAddFiles = (items: QueuedFileItem[]) => {
    setQueuedFiles((prev) => [...prev, ...items]);
  };

  const handleRemoveQueuedFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleSend = () => {
    const engine = engineRef.current;
    if (!engine || selectedPeerIds.length === 0 || queuedFiles.length === 0) return;

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {});
    }

    const itemsToSend = [...queuedFiles];
    setQueuedFiles([]);

    for (const targetId of selectedPeerIds) {
      const peer = peers.find((p) => p.deviceId === targetId);
      if (!peer) continue;
      void engine.sendToPeer(peer.deviceId, peer.deviceName, peer.platform, itemsToSend);
    }
  };

  const handleAcceptOffer = (transferId: string, dirHandle: FileSystemDirectoryHandle | null) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {});
    }
    void engineRef.current?.acceptIncomingOffer(transferId, dirHandle);
  };

  const handleRejectOffer = (transferId: string) => {
    engineRef.current?.rejectIncomingOffer(transferId);
  };

  const handleClearHistory = () => {
    setHistory([]);
    saveTransferHistory([]);
  };

  const alreadyPairedIds = useMemo(() => new Set(peers.map((p) => p.deviceId)), [peers]);
  const currentOffer = incomingOffers[0] || null;
  const activeCount = activeTransfers.filter(
    (t) =>
      t.status === 'transferring' ||
      t.status === 'paused' ||
      t.status === 'reconnecting' ||
      t.status === 'awaiting_acceptance'
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F5] dark:bg-[#0E0E10] text-[#171714] dark:text-[#F4F4F0] transition-colors">
      {/* Top Bar (3-zone contract: Brand — 2 main sections — History/Settings actions) */}
      <header className="sticky top-0 z-30 bg-[#FAF9F5]/90 dark:bg-[#0E0E10]/90 backdrop-blur-md border-b border-[#E6E4DC] dark:border-[#27272C]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand mark (single-line) */}
          <button
            type="button"
            onClick={() => setSection('devices')}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 text-left"
          >
            <BananaLogo className="w-8 h-8" />
            <span className="font-display text-lg font-bold tracking-tight text-[#171714] dark:text-[#F4F4F0]">
              Banana Send
            </span>
          </button>

          {/* Zone 2: ONLY TWO main navigation sections on desktop */}
          <nav
            aria-label="Main sections"
            className="hidden md:flex items-center gap-8 h-full"
          >
            <button
              type="button"
              onClick={() => setSection('devices')}
              className={`relative h-full px-1 flex items-center gap-2 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                section === 'devices'
                  ? 'text-[#171714] dark:text-[#F4F4F0]'
                  : 'text-[#68665E] dark:text-[#A1A1AA] hover:text-[#171714] dark:hover:text-[#F4F4F0]'
              }`}
            >
              <span>Devices</span>
              {section === 'devices' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#171714] dark:bg-[#FACC15]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setSection('send')}
              className={`relative h-full px-1 flex items-center gap-2 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                section === 'send'
                  ? 'text-[#171714] dark:text-[#F4F4F0]'
                  : 'text-[#68665E] dark:text-[#A1A1AA] hover:text-[#171714] dark:hover:text-[#F4F4F0]'
              }`}
            >
              <span>Send</span>
              {activeCount > 0 && (
                <span className="font-mono tabular-nums text-xs text-[#CA8A04] dark:text-[#FACC15]">
                  ({activeCount})
                </span>
              )}
              {section === 'send' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#171714] dark:bg-[#FACC15]" />
              )}
            </button>
          </nav>

          {/* Zone 3: Secondary utility actions (History, Settings, optional Install) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {canPromptInstall && (
              <button
                type="button"
                onClick={() => void promptInstall()}
                className="hidden sm:inline-flex min-h-[40px] px-3.5 rounded-xl bg-[#171714] dark:bg-[#FACC15] text-white dark:text-[#171714] text-xs font-semibold items-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap mr-1"
              >
                <Download className="w-3.5 h-3.5" />
                Install App
              </button>
            )}
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label="Transfer history"
              title="Transfer history"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#68665E] dark:text-[#A1A1AA] hover:text-[#171714] dark:hover:text-[#F4F4F0] hover:bg-[#F3F2EC] dark:hover:bg-[#1E1E24] transition-colors"
            >
              <Clock className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#68665E] dark:text-[#A1A1AA] hover:text-[#171714] dark:hover:text-[#F4F4F0] hover:bg-[#F3F2EC] dark:hover:bg-[#1E1E24] transition-colors"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 pb-24 md:pb-12">
        {section === 'devices' ? (
          <DevicesView
            deviceName={settings.deviceName}
            platform={platform}
            signalingConnected={signalingConnected}
            peers={peers}
            onOpenConnect={() => {
              setPairingError(null);
              setConnectOpen(true);
            }}
            onSendToDevice={handleSendToDevice}
            onDisconnect={(id, forget) => connRef.current?.disconnectPeer(id, forget)}
            onReconnect={(id) => connRef.current?.reconnectPeer(id)}
          />
        ) : (
          <SendView
            peers={peers}
            selectedPeerIds={selectedPeerIds}
            onTogglePeer={handleTogglePeer}
            queuedFiles={queuedFiles}
            onAddFiles={handleAddFiles}
            onRemoveQueuedFile={handleRemoveQueuedFile}
            onClearQueue={() => setQueuedFiles([])}
            onSend={handleSend}
            activeTransfers={activeTransfers}
            onPauseTransfer={(id) => engineRef.current?.pauseTransfer(id)}
            onResumeTransfer={(id) => engineRef.current?.resumeTransfer(id)}
            onCancelTransfer={(id) => engineRef.current?.cancelTransfer(id)}
            onDismissTransfer={(id) => engineRef.current?.dismissTransfer(id)}
            onGoToDevices={() => setSection('devices')}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar (ONLY 2 main sections: Devices & Send) */}
      <nav
        aria-label="Mobile sections"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#16161A]/95 backdrop-blur-md border-t border-[#E6E4DC] dark:border-[#27272C] pb-safe"
      >
        <div className="grid grid-cols-2 h-16">
          <button
            type="button"
            onClick={() => setSection('devices')}
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              section === 'devices'
                ? 'text-[#171714] dark:text-[#FACC15]'
                : 'text-[#68665E] dark:text-[#A1A1AA]'
            }`}
          >
            <Laptop className="w-5 h-5" />
            <span className="text-[11px] font-semibold">Devices</span>
          </button>

          <button
            type="button"
            onClick={() => setSection('send')}
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              section === 'send'
                ? 'text-[#171714] dark:text-[#FACC15]'
                : 'text-[#68665E] dark:text-[#A1A1AA]'
            }`}
          >
            <SendIcon className="w-5 h-5" />
            <span className="text-[11px] font-semibold">
              Send{activeCount > 0 ? ` (${activeCount})` : ''}
            </span>
          </button>
        </div>
      </nav>

      {/* Connect New Device Modal */}
      <ConnectModal
        isOpen={connectOpen}
        onClose={() => setConnectOpen(false)}
        pairingCode={pairingCode}
        pairingError={pairingError}
        nearbyDevices={nearbyDevices}
        alreadyPairedIds={alreadyPairedIds}
        onRequestCode={() => connRef.current?.requestPairingCode()}
        onJoinCode={(code) => connRef.current?.joinWithCode(code)}
        onInviteNearby={(id) => {
          connRef.current?.sendDirectPairInvite(id);
          showToast('Pairing Request Sent', 'Waiting for the other device to accept');
        }}
        onClearError={() => setPairingError(null)}
        serverUrl={settings.serverUrl}
      />

      {/* Incoming Transfer Permission Prompt */}
      <ReceiveModal
        offer={currentOffer}
        defaultDirHandle={defaultDirHandle}
        askSaveLocationEachTime={settings.askSaveLocationEachTime}
        onAccept={handleAcceptOffer}
        onReject={handleRejectOffer}
      />

      {/* Transfer History Drawer */}
      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        entries={history}
        onClearHistory={handleClearHistory}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        defaultDirHandle={defaultDirHandle}
        onPickDefaultFolder={() => void handlePickDefaultFolder()}
        onClearDefaultFolder={() => void handleClearDefaultFolder()}
        canPromptInstall={canPromptInstall}
        isInstalled={isInstalled}
        onInstallApp={() => void promptInstall()}
      />

      {/* Direct Local Pairing Invite Prompt */}
      {pairInvite && (
        <div className="fixed bottom-20 md:bottom-6 right-4 left-4 sm:left-auto sm:w-96 z-50 rounded-2xl bg-white dark:bg-[#16161A] border border-[#E6E4DC] dark:border-[#27272C] shadow-2xl p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold text-[#171714] dark:text-[#F4F4F0]">
              Pair with {pairInvite.fromDeviceName}?
            </div>
            <div className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
              A device on your network wants to connect via Banana Send.
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPairInvite(null)}
              className="min-h-[38px] px-3.5 rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-xs font-medium text-[#68665E] dark:text-[#A1A1AA]"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => {
                connRef.current?.acceptDirectPairInvite(pairInvite.fromDeviceId);
                setPairInvite(null);
              }}
              className="min-h-[38px] px-4 rounded-xl bg-[#FACC15] text-[#171714] text-xs font-semibold hover:bg-[#EAB308]"
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* Subtle Toast Notification */}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-[#171714] dark:bg-[#F4F4F0] text-white dark:text-[#171714] shadow-xl text-xs font-medium whitespace-nowrap">
          <span>{toast.title}</span>
          {toast.body && <span className="opacity-75"> · {toast.body}</span>}
        </div>
      )}
    </div>
  );
}
