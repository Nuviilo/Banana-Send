import React from 'react';
import { ArrowUpRight, Plus, RefreshCw, Unplug } from 'lucide-react';
import type { DevicePlatform, PairedDevice } from '../types';
import { formatDateTime, platformLabel } from '../utils/format';
import { PlatformIcon } from './BananaLogo';

interface DevicesViewProps {
  deviceName: string;
  platform: DevicePlatform;
  signalingConnected: boolean;
  peers: PairedDevice[];
  onOpenConnect: () => void;
  onSendToDevice: (deviceId: string) => void;
  onDisconnect: (deviceId: string, forget: boolean) => void;
  onReconnect: (deviceId: string) => void;
}

export const DevicesView: React.FC<DevicesViewProps> = ({
  deviceName,
  platform,
  signalingConnected,
  peers,
  onOpenConnect,
  onSendToDevice,
  onDisconnect,
  onReconnect,
}) => {
  const connectedPeers = peers.filter(
    (p) =>
      p.online &&
      (p.connectionState === 'connected' || p.connectionState === 'reconnecting')
  );
  const previousPeers = peers.filter(
    (p) => !connectedPeers.some((c) => c.deviceId === p.deviceId)
  );

  const statusText = (peer: PairedDevice) => {
    switch (peer.connectionState) {
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Offline';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#171714] dark:text-[#F4F4F0]">
            Devices
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#68665E] dark:text-[#A1A1AA]">
            <span>This device: <strong className="font-medium text-[#171714] dark:text-[#F4F4F0]">{deviceName}</strong></span>
            <span aria-hidden="true">·</span>
            <span>{platformLabel(platform)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  signalingConnected ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {signalingConnected ? 'Online' : 'Reconnecting...'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenConnect}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#FACC15] hover:bg-[#EAB308] text-[#171714] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 shadow-xs"
        >
          <Plus className="w-4 h-4" />
          Connect New Device
        </button>
      </div>

      {/* Empty state */}
      {peers.length === 0 ? (
        <div className="rounded-2xl border border-[#E6E4DC] dark:border-[#27272C] bg-white dark:bg-[#16161A] p-8 sm:p-12 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#FAF9F5] dark:bg-[#222228] border border-[#E6E4DC] dark:border-[#27272C] flex items-center justify-center text-[#171714] dark:text-[#FACC15]">
            <PlatformIcon platform="windows" className="w-6 h-6" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-[#171714] dark:text-[#F4F4F0]">
            No devices connected yet
          </h2>
          <p className="mt-2 max-w-md mx-auto text-sm text-[#68665E] dark:text-[#A1A1AA]">
            Open Banana Send on your Windows PC or Android phone, then scan a QR code or enter a pairing code to connect across any network.
          </p>
          <button
            type="button"
            onClick={onOpenConnect}
            className="mt-6 min-h-[44px] px-5 py-2.5 rounded-xl bg-[#171714] dark:bg-[#FACC15] text-white dark:text-[#171714] text-sm font-semibold hover:opacity-90 transition-opacity inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Connect New Device
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Connected Devices */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#171714] dark:text-[#F4F4F0]">
                Connected Devices
              </h2>
              <span className="text-xs font-mono tabular-nums text-[#68665E] dark:text-[#A1A1AA]">
                {connectedPeers.length} online
              </span>
            </div>

            {connectedPeers.length === 0 ? (
              <div className="rounded-2xl border border-[#E6E4DC] dark:border-[#27272C] bg-white dark:bg-[#16161A] px-6 py-8 text-center text-sm text-[#68665E] dark:text-[#A1A1AA]">
                No connected devices are currently online. Open Banana Send on a paired device or connect a new one.
              </div>
            ) : (
              <div className="divide-y divide-[#E6E4DC] dark:divide-[#27272C] rounded-2xl border border-[#E6E4DC] dark:border-[#27272C] bg-white dark:bg-[#16161A] overflow-hidden">
                {connectedPeers.map((peer) => (
                  <div
                    key={peer.deviceId}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-[#FAF9F5] dark:bg-[#222228] border border-[#E6E4DC] dark:border-[#27272C] flex items-center justify-center text-[#171714] dark:text-[#F4F4F0] shrink-0">
                        <PlatformIcon platform={peer.platform} className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold text-[#171714] dark:text-[#F4F4F0] truncate">
                            {peer.deviceName}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#68665E] dark:text-[#A1A1AA]">
                          <span>{platformLabel(peer.platform)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                peer.connectionState === 'connected'
                                  ? 'bg-emerald-500'
                                  : 'bg-amber-500'
                              }`}
                            />
                            {statusText(peer)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSendToDevice(peer.deviceId)}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-[#171714] dark:bg-[#FACC15] text-white dark:text-[#171714] text-xs font-semibold hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        Send Files
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDisconnect(peer.deviceId, false)}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-xs font-medium text-[#68665E] dark:text-[#A1A1AA] hover:text-red-600 dark:hover:text-red-400 hover:bg-[#FAF9F5] dark:hover:bg-[#222228] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Unplug className="w-3.5 h-3.5" />
                        Disconnect
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Previously Connected Devices */}
          {previousPeers.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#171714] dark:text-[#F4F4F0]">
                  Previously Connected Devices
                </h2>
                <span className="text-xs font-mono tabular-nums text-[#68665E] dark:text-[#A1A1AA]">
                  {previousPeers.length} saved
                </span>
              </div>

              <div className="divide-y divide-[#E6E4DC] dark:divide-[#27272C] rounded-2xl border border-[#E6E4DC] dark:border-[#27272C] bg-white dark:bg-[#16161A] overflow-hidden">
                {previousPeers.map((peer) => (
                  <div
                    key={peer.deviceId}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-[#FAF9F5] dark:bg-[#222228] border border-[#E6E4DC] dark:border-[#27272C] flex items-center justify-center text-[#68665E] dark:text-[#A1A1AA] shrink-0">
                        <PlatformIcon platform={peer.platform} className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-base font-medium text-[#171714] dark:text-[#F4F4F0] truncate">
                          {peer.deviceName}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#68665E] dark:text-[#A1A1AA]">
                          <span>{platformLabel(peer.platform)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{peer.online ? 'Disconnected' : 'Offline'}</span>
                          <span aria-hidden="true">·</span>
                          <span>Last seen {formatDateTime(peer.lastSeenAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {peer.online && (
                        <button
                          type="button"
                          onClick={() => onReconnect(peer.deviceId)}
                          className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-xs font-medium text-[#171714] dark:text-[#F4F4F0] hover:bg-[#FAF9F5] dark:hover:bg-[#222228] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Reconnect
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDisconnect(peer.deviceId, true)}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-xs font-medium text-[#68665E] dark:text-[#A1A1AA] hover:text-red-600 dark:hover:text-red-400 hover:bg-[#FAF9F5] dark:hover:bg-[#222228] transition-colors whitespace-nowrap"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
