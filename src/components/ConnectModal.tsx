import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  Camera,
  Check,
  Copy,
  ImageUp,
  QrCode,
  RefreshCw,
  Wifi,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { NearbyDevice } from '../types';
import { formatCodeDisplay, parsePairCode, platformLabel } from '../utils/format';
import { getEffectiveSignalingHttpUrl } from '../utils/storage';
import { PlatformIcon } from './BananaLogo';

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  pairingCode: string | null;
  pairingError: string | null;
  nearbyDevices: NearbyDevice[];
  alreadyPairedIds: Set<string>;
  onRequestCode: () => void;
  onJoinCode: (code: string) => void;
  onInviteNearby: (deviceId: string) => void;
  onClearError: () => void;
  serverUrl?: string;
}

export const ConnectModal: React.FC<ConnectModalProps> = ({
  isOpen,
  onClose,
  pairingCode,
  pairingError,
  nearbyDevices,
  alreadyPairedIds,
  onRequestCode,
  onJoinCode,
  onInviteNearby,
  onClearError,
  serverUrl,
}) => {
  const [method, setMethod] = useState<'qr' | 'code'>('qr');
  const [qrMode, setQrMode] = useState<'show' | 'scan'>('show');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [codeInput, setCodeInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen && !pairingCode) {
      onRequestCode();
    }
  }, [isOpen, pairingCode, onRequestCode]);

  useEffect(() => {
    if (!pairingCode) {
      setQrDataUrl('');
      return;
    }
    const baseHttp = getEffectiveSignalingHttpUrl(serverUrl);
    const pairUrl = `${baseHttp}/?pair=${pairingCode}`;
    QRCode.toDataURL(pairUrl, {
      width: 240,
      margin: 2,
      color: {
        dark: '#171714',
        light: '#FFFFFF',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [pairingCode, serverUrl]);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!isOpen || method !== 'qr' || qrMode !== 'scan') {
      stopCamera();
      return;
    }

    let cancelled = false;
    setScannerError(null);

    const startScanner = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setScannerError('Camera access is not available in this browser. You can upload a QR image instead.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraActive(true);
          scanLoop();
        }
      } catch {
        if (!cancelled) {
          setScannerError('Camera permission denied or no camera found. Upload a QR image or use a pairing code.');
        }
      }
    };

    const scanLoop = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = jsQR(imgData.data, imgData.width, imgData.height);
          if (decoded && decoded.data) {
            const parsed = parsePairCode(decoded.data);
            if (parsed) {
              stopCamera();
              onJoinCode(parsed);
              return;
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(scanLoop);
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen, method, qrMode, onJoinCode]);

  const handleQrImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScannerError(null);

    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(imgData.data, imgData.width, imgData.height);
      if (decoded && decoded.data) {
        const parsed = parsePairCode(decoded.data);
        if (parsed) {
          onJoinCode(parsed);
          return;
        }
      }
      setScannerError('No valid Banana Send QR code found in that image.');
    } catch {
      setScannerError('Could not read the selected image.');
    }
  };

  const handleCopyCode = async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSubmitCode = (e: React.FormEvent) => {
    e.preventDefault();
    onClearError();
    const parsed = parsePairCode(codeInput);
    if (!parsed) return;
    onJoinCode(parsed);
  };

  const availableNearby = nearbyDevices.filter((d) => !alreadyPairedIds.has(d.deviceId));

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
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6E4DC] dark:border-[#27272C]">
              <div>
                <h2 className="text-lg font-semibold text-[#171714] dark:text-[#F4F4F0]">
                  Connect New Device
                </h2>
                <p className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                  Works across Wi-Fi, mobile data, and different networks
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#68665E] dark:text-[#A1A1AA] hover:bg-[#F3F2EC] dark:hover:bg-[#232329] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {/* Method selector */}
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F3F2EC] dark:bg-[#222228]">
                <button
                  type="button"
                  onClick={() => {
                    onClearError();
                    setMethod('qr');
                  }}
                  className={`min-h-[40px] flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    method === 'qr'
                      ? 'bg-white dark:bg-[#16161A] text-[#171714] dark:text-[#F4F4F0] shadow-xs'
                      : 'text-[#68665E] dark:text-[#A1A1AA] hover:text-[#171714] dark:hover:text-[#F4F4F0]'
                  }`}
                >
                  <QrCode className="w-4 h-4" />
                  QR Code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearError();
                    setMethod('code');
                  }}
                  className={`min-h-[40px] flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    method === 'code'
                      ? 'bg-white dark:bg-[#16161A] text-[#171714] dark:text-[#F4F4F0] shadow-xs'
                      : 'text-[#68665E] dark:text-[#A1A1AA] hover:text-[#171714] dark:hover:text-[#F4F4F0]'
                  }`}
                >
                  <span className="font-mono text-xs font-semibold">#</span>
                  Generated Code
                </button>
              </div>

              {pairingError && (
                <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  {pairingError}
                </div>
              )}

              {method === 'qr' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQrMode('show')}
                      className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                        qrMode === 'show'
                          ? 'bg-[#171714] text-white dark:bg-[#FACC15] dark:text-[#171714]'
                          : 'bg-[#F3F2EC] dark:bg-[#222228] text-[#68665E] dark:text-[#A1A1AA]'
                      }`}
                    >
                      Show My QR
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrMode('scan')}
                      className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                        qrMode === 'scan'
                          ? 'bg-[#171714] text-white dark:bg-[#FACC15] dark:text-[#171714]'
                          : 'bg-[#F3F2EC] dark:bg-[#222228] text-[#68665E] dark:text-[#A1A1AA]'
                      }`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Scan QR
                    </button>
                  </div>

                  {qrMode === 'show' ? (
                    <div className="flex flex-col items-center text-center py-2">
                      <div className="p-3 bg-white rounded-2xl border border-[#E6E4DC]">
                        {qrDataUrl ? (
                          <img
                            src={qrDataUrl}
                            alt="Banana Send pairing QR code"
                            className="w-48 h-48 block"
                          />
                        ) : (
                          <div className="w-48 h-48 flex items-center justify-center text-xs text-[#68665E]">
                            Generating QR...
                          </div>
                        )}
                      </div>
                      <p className="mt-4 text-sm text-[#68665E] dark:text-[#A1A1AA]">
                        Scan with the other device’s Banana Send scanner or phone camera
                      </p>
                      {pairingCode && (
                        <div className="mt-3 flex items-center gap-2">
                          <span className="font-mono tabular-nums text-lg font-semibold tracking-wider text-[#171714] dark:text-[#F4F4F0]">
                            {formatCodeDisplay(pairingCode)}
                          </span>
                          <button
                            type="button"
                            onClick={onRequestCode}
                            title="Generate new QR code"
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#68665E] dark:text-[#A1A1AA] hover:bg-[#F3F2EC] dark:hover:bg-[#222228]"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="relative rounded-2xl overflow-hidden bg-[#171714] aspect-4/3 flex items-center justify-center">
                        <video
                          ref={videoRef}
                          playsInline
                          muted
                          className={`w-full h-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
                        />
                        <canvas ref={canvasRef} className="hidden" />
                        {cameraActive && (
                          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                            <div className="w-44 h-44 rounded-2xl border-2 border-[#FACC15]" />
                          </div>
                        )}
                        {!cameraActive && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white/80 text-sm">
                            {scannerError ? scannerError : 'Starting camera...'}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                          Point camera at the other device’s QR code
                        </span>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleQrImageUpload}
                        />
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          className="shrink-0 min-h-[40px] px-3 py-2 rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-xs font-medium text-[#171714] dark:text-[#F4F4F0] hover:bg-[#F3F2EC] dark:hover:bg-[#222228] flex items-center gap-1.5"
                        >
                          <ImageUp className="w-3.5 h-3.5" />
                          Upload QR Image
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Your code */}
                  <div className="rounded-2xl border border-[#E6E4DC] dark:border-[#27272C] p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                        Your Pairing Code
                      </div>
                      <div className="mt-1 font-mono tabular-nums text-2xl font-semibold tracking-widest text-[#171714] dark:text-[#F4F4F0]">
                        {pairingCode ? formatCodeDisplay(pairingCode) : '------'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        disabled={!pairingCode}
                        className="min-h-[40px] px-3 py-2 rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-xs font-medium text-[#171714] dark:text-[#F4F4F0] hover:bg-[#F3F2EC] dark:hover:bg-[#222228] flex items-center gap-1.5"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={onRequestCode}
                        title="Generate new code"
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-[#E6E4DC] dark:border-[#27272C] text-[#68665E] dark:text-[#A1A1AA] hover:bg-[#F3F2EC] dark:hover:bg-[#222228]"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Enter another device's code */}
                  <form onSubmit={handleSubmitCode} className="space-y-2.5">
                    <label
                      htmlFor="pair-code-input"
                      className="block text-xs font-medium text-[#68665E] dark:text-[#A1A1AA]"
                    >
                      Enter Code from Another Device
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="pair-code-input"
                        type="text"
                        value={codeInput}
                        onChange={(e) => {
                          onClearError();
                          setCodeInput(e.target.value.toUpperCase());
                        }}
                        placeholder="e.g. 4K8-M2P"
                        maxLength={12}
                        className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#FAF9F5] dark:bg-[#0E0E10] border border-[#E6E4DC] dark:border-[#27272C] font-mono tabular-nums text-base tracking-widest uppercase text-[#171714] dark:text-[#F4F4F0] focus:outline-none focus:ring-2 focus:ring-[#FACC15]"
                      />
                      <button
                        type="submit"
                        disabled={!parsePairCode(codeInput)}
                        className="min-h-[44px] px-5 rounded-xl bg-[#FACC15] text-[#171714] font-semibold text-sm hover:bg-[#EAB308] disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap"
                      >
                        Connect
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Local / Same-Network Discovery */}
              {availableNearby.length > 0 && (
                <div className="pt-4 border-t border-[#E6E4DC] dark:border-[#27272C] space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#68665E] dark:text-[#A1A1AA]">
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Nearby on this network</span>
                  </div>
                  <div className="divide-y divide-[#E6E4DC] dark:divide-[#27272C] rounded-xl border border-[#E6E4DC] dark:border-[#27272C] overflow-hidden">
                    {availableNearby.map((device) => (
                      <div
                        key={device.deviceId}
                        className="flex items-center justify-between gap-3 px-4 py-3 bg-[#FAF9F5]/60 dark:bg-[#0E0E10]/40"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-white dark:bg-[#1E1E24] border border-[#E6E4DC] dark:border-[#27272C] flex items-center justify-center text-[#171714] dark:text-[#F4F4F0] shrink-0">
                            <PlatformIcon platform={device.platform} className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[#171714] dark:text-[#F4F4F0] truncate">
                              {device.deviceName}
                            </div>
                            <div className="text-xs text-[#68665E] dark:text-[#A1A1AA]">
                              {platformLabel(device.platform)} · Same Wi-Fi
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onInviteNearby(device.deviceId)}
                          className="min-h-[36px] px-3.5 rounded-lg bg-[#171714] dark:bg-[#FACC15] text-white dark:text-[#171714] text-xs font-medium hover:opacity-90 transition-opacity shrink-0"
                        >
                          Pair
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
