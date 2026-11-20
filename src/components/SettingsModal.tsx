import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  Download,
  FolderOpen,
  Monitor,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { AppSettings, ThemeMode } from '../types';
import { DEFAULT_PACKAGED_SIGNALING_URL, supportsDirectoryPicker } from '../utils/storage';
import { BananaLogo } from './BananaLogo';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  defaultDirHandle: FileSystemDirectoryHandle | null;
  onPickDefaultFolder: () => void;
  onClearDefaultFolder: () => void;
  canPromptInstall: boolean;
  isInstalled: boolean;
  onInstallApp: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  defaultDirHandle,
  onPickDefaultFolder,
  onClearDefaultFolder,
  canPromptInstall,
  isInstalled,
  onInstallApp,
}) => {
  const [nameDraft, setNameDraft] = useState(settings.deviceName);
  const [showRelayAdvanced, setShowRelayAdvanced] = useState(false);
  const [windowsStartup, setWindowsStartup] = useState(false);
  const isElectronDesktop = Boolean(window.bananaDesktop?.isDesktopApp);
  const canPickFolder = supportsDirectoryPicker();

  useEffect(() => {
    if (isOpen && window.bananaDesktop?.getStartupEnabled) {
      void window.bananaDesktop.getStartupEnabled().then(setWindowsStartup).catch(() => {});
    }
  }, [isOpen]);

  const handleToggleWindowsStartup = async (enabled: boolean) => {
    setWindowsStartup(enabled);
    if (window.bananaDesktop?.setStartupEnabled) {
      const actual = await window.bananaDesktop.setStartupEnabled(enabled);
      setWindowsStartup(actual);
    }
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = nameDraft.trim();
    if (!cleaned) return;
    onUpdateSettings({ ...settings, deviceName: cleaned.slice(0, 48) });
  };

  const themeOptions: Array<{ value: ThemeMode; label: string; icon: React.ReactNode }> = [
    { value: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" /> },
    { value: 'system', label: 'System', icon: <Monitor className="w-3.5 h-3.5" /> },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-xs p-0 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#16161A] border border-[#E6E4DC] dark:border-[#27272C] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6E4DC] dark:border-[#27272C]">
              <h2 className="text-lg font-semibold text-[#171714] dark:text-[#F4F4F0]">
                Settings
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close settings"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#68665E] dark:text-[#A1A1AA] hover:bg-[#F3F2EC] dark:hover:bg-[#222228]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Theme */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#171714] dark:text-[#F4F4F0]">
                  Theme
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#F3F2EC] dark:bg-[#222228]">
                  {themeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, theme: opt.value })}
                      className={`min-h-[40px] flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${
                        settings.theme === opt.value
                          ? 'bg-white dark:bg-[#16161A] text-[#171714] dark:text-[#F4F4F0] shadow-xs'
                          : 'text-[#68665E] dark:text-[#A1A1AA]'
                      }`}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Device Name */}
              <form onSubmit={handleSaveName} className="space-y-2">
                <label
                  htmlFor="device-name-input"
                  className="block text-sm font-medium text-[#171714] dark:text-[#F4F4F0]"
                >
                  Device Name
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="device-name-input"
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    maxLength={48}
                    className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#FAF9F5] dark:bg-[#0E0E10] border border-[#E6E4DC] dark:border-[#27272C] text-sm text-[#171714] dark:text-[#F4F4F0] focus:outline-none focus:ring-2 focus:ring-[#FACC15]"
                  />
                  <button
                    type="submit"
                    disabled={!nameDraft.trim() || nameDraft.trim() === settings.deviceName}
                    className="min-h-[44px] px-4 rounded-xl bg-[#171714] dark:bg-[#FACC15] text-white dark:text-[#171714] text-xs font-semibold disabled:opacity-40 transition-opacity"
                  >
                    Save
                  </button>
                </div>
              </form>

              {/* Default Download Location */}
              <div className="space-y-3 pt-4 border-t border-[#E6E4DC] dark:border-[#27272C]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-[#171714] dark:text-[#F4F4F0]">
                      Default Download Location
                    </div>
                    <div className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                      {defaultDirHandle
                        ? `Selected folder: ${defaultDirHandle.name}`
                        : canPickFolder
                        ? 'Browser Downloads folder (or pick a custom folder)'
                        : 'Saved to your device Downloads folder'}
                    </div>
                  </div>
                  {canPickFolder && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={onPickDefaultFolder}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-xs font-medium text-[#171714] dark:text-[#F4F4F0] hover:bg-[#FAF9F5] dark:hover:bg-[#222228] inline-flex items-center gap-1.5"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Choose
                      </button>
                      {defaultDirHandle && (
                        <button
                          type="button"
                          onClick={onClearDefaultFolder}
                          className="min-h-[38px] px-2.5 rounded-xl text-xs text-[#68665E] dark:text-[#A1A1AA] hover:text-red-600"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {canPickFolder && (
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                      Ask where to save every incoming transfer
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.askSaveLocationEachTime}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          askSaveLocationEachTime: e.target.checked,
                        })
                      }
                      className="w-4 h-4 accent-[#EAB308]"
                    />
                  </label>
                )}
              </div>

              {/* Windows Startup & Native App Install */}
              <div className="space-y-2.5 pt-4 border-t border-[#E6E4DC] dark:border-[#27272C]">
                <div className="text-sm font-medium text-[#171714] dark:text-[#F4F4F0]">
                  Windows Startup & App Installation
                </div>
                {isElectronDesktop ? (
                  <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
                    <span className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                      Launch Banana Send automatically when Windows starts
                    </span>
                    <input
                      type="checkbox"
                      checked={windowsStartup}
                      onChange={(e) => void handleToggleWindowsStartup(e.target.checked)}
                      className="w-4 h-4 accent-[#EAB308]"
                    />
                  </label>
                ) : (
                  <p className="text-xs text-[#68665E] dark:text-[#A1A1AA] leading-relaxed">
                    Install Banana Send on Windows 10/11 (Edge/Chrome → App settings → Start app when you sign in) or run the Windows desktop installer for native startup support.
                  </p>
                )}
                {canPromptInstall && !isElectronDesktop && (
                  <button
                    type="button"
                    onClick={onInstallApp}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-[#FACC15] hover:bg-[#EAB308] text-[#171714] text-xs font-semibold inline-flex items-center gap-2 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Install Banana Send App
                  </button>
                )}
                {isInstalled && !isElectronDesktop && (
                  <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Installed as standalone app
                  </div>
                )}
              </div>

              {/* Optional Server URL */}
              <div className="pt-4 border-t border-[#E6E4DC] dark:border-[#27272C]">
                <button
                  type="button"
                  onClick={() => setShowRelayAdvanced((v) => !v)}
                  className="w-full flex items-center justify-between text-xs font-medium text-[#68665E] dark:text-[#A1A1AA] hover:text-[#171714] dark:hover:text-[#F4F4F0]"
                >
                  <span>Server Address (Optional)</span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${
                      showRelayAdvanced ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {showRelayAdvanced && (
                  <div className="mt-3 space-y-2.5">
                    <input
                      type="url"
                      placeholder={`Server URL (default: ${DEFAULT_PACKAGED_SIGNALING_URL})`}
                      value={settings.serverUrl}
                      onChange={(e) =>
                        onUpdateSettings({ ...settings, serverUrl: e.target.value })
                      }
                      className="w-full min-h-[40px] px-3 rounded-xl bg-[#FAF9F5] dark:bg-[#0E0E10] border border-[#E6E4DC] dark:border-[#27272C] text-xs font-mono text-[#171714] dark:text-[#F4F4F0]"
                    />
                  </div>
                )}
              </div>

              {/* About Banana Send */}
              <div className="pt-4 border-t border-[#E6E4DC] dark:border-[#27272C] flex items-start gap-3">
                <BananaLogo className="w-9 h-9 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-[#171714] dark:text-[#F4F4F0]">
                    Banana Send
                  </div>
                  <div className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                    Send anything. Anywhere. Fast unlimited file and folder transfers between Windows and Android with no accounts and no file-size limits.
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
