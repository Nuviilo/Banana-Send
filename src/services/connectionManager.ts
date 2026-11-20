import type {
  AppSettings,
  DevicePlatform,
  IncomingPairInvite,
  NearbyDevice,
  PairedDevice,
  PeerConnectionState,
} from '../types';
import { detectPlatform } from '../utils/format';
import { getEffectiveSignalingHttpUrl } from '../utils/storage';

export interface ConnectionEvents {
  onServerStatus: (connected: boolean) => void;
  onPeersUpdated: (peers: PairedDevice[]) => void;
  onNearbyUpdated: (devices: NearbyDevice[]) => void;
  onPairingCodeCreated: (code: string, expiresAt: number) => void;
  onPairingError: (message: string) => void;
  onPairMatched: (peer: PairedDevice) => void;
  onIncomingPairInvite: (invite: IncomingPairInvite) => void;
  onControlMessage: (fromDeviceId: string, msg: Record<string, unknown>) => void;
  onBinaryMessage: (fromDeviceId: string, payload: ArrayBuffer) => void;
  onPeerReady: (peerDeviceId: string) => void;
  onPeerDisconnected: (peerDeviceId: string) => void;
}

const MAX_WS_BUFFERED = 1024 * 1024; // 1 MB backpressure ceiling

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private destroyed = false;

  private deviceId: string;
  private settings: AppSettings;
  private platform: DevicePlatform;
  private peers = new Map<string, PairedDevice>();
  private events: ConnectionEvents;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  constructor(
    deviceId: string,
    settings: AppSettings,
    initialPeers: PairedDevice[],
    events: ConnectionEvents
  ) {
    this.deviceId = deviceId;
    this.settings = settings;
    this.platform = detectPlatform();
    this.events = events;

    for (const p of initialPeers) {
      this.peers.set(p.deviceId, {
        ...p,
        online: false,
        connectionState: 'offline',
      });
    }
  }

  public start(): void {
    this.destroyed = false;
    this.connectWebSocket();
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public updateSettings(next: AppSettings): void {
    const serverChanged = next.serverUrl !== this.settings.serverUrl;
    this.settings = next;

    if (serverChanged && this.ws) {
      this.ws.close();
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'update-device',
          deviceName: next.deviceName,
          platform: this.platform,
          knownPeerIds: Array.from(this.peers.keys()),
        })
      );
    }
  }

  public getPeers(): PairedDevice[] {
    return Array.from(this.peers.values()).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return b.lastSeenAt - a.lastSeenAt;
    });
  }

  private emitPeers(): void {
    this.events.onPeersUpdated(this.getPeers());
  }

  private connectWebSocket(): void {
    if (this.destroyed) return;
    const baseHttp = getEffectiveSignalingHttpUrl(this.settings.serverUrl);
    const wsUrl = `${baseHttp.replace(/^http/i, 'ws')}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.events.onServerStatus(true);
        ws.send(
          JSON.stringify({
            type: 'register',
            deviceId: this.deviceId,
            deviceName: this.settings.deviceName,
            platform: this.platform,
            knownPeerIds: Array.from(this.peers.keys()),
          })
        );
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.handleWsBinary(event.data);
          return;
        }
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data) as Record<string, unknown>;
            this.handleWsJson(msg);
          } catch {
            // Ignore malformed message
          }
        }
      };

      ws.onclose = () => {
        this.events.onServerStatus(false);
        for (const peer of this.peers.values()) {
          if (peer.online) {
            peer.online = false;
            peer.connectionState =
              peer.connectionState === 'connected' ? 'reconnecting' : 'offline';
          }
        }
        this.emitPeers();
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose handles reconnect
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== null) return;
    const delay = Math.min(1000 * Math.pow(1.6, this.reconnectAttempt), 10000);
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  public requestPairingCode(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pair:create' }));
    } else {
      this.events.onPairingError('Connecting to server. Please wait a moment.');
    }
  }

  public joinWithCode(code: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pair:join', code }));
    } else {
      this.events.onPairingError('Not connected to server yet.');
    }
  }

  public sendDirectPairInvite(targetDeviceId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pair:direct-invite', targetDeviceId }));
    }
  }

  public acceptDirectPairInvite(targetDeviceId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pair:direct-accept', targetDeviceId }));
    }
  }

  public disconnectPeer(peerDeviceId: string, forget = false): void {
    if (forget) {
      this.peers.delete(peerDeviceId);
    } else {
      const p = this.peers.get(peerDeviceId);
      if (p) {
        p.connectionState = p.online ? 'disconnected' : 'offline';
      }
    }
    if (forget && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'peer:unpair', targetDeviceId: peerDeviceId }));
    }
    this.emitPeers();
    this.events.onPeerDisconnected(peerDeviceId);
  }

  public reconnectPeer(peerDeviceId: string): void {
    const peer = this.peers.get(peerDeviceId);
    if (!peer || !peer.online) return;
    peer.connectionState = 'connected';
    peer.lastSeenAt = Date.now();
    this.emitPeers();
    this.events.onPeerReady(peerDeviceId);
  }

  private handleWsJson(msg: Record<string, unknown>): void {
    const type = String(msg.type || '');

    if (type === 'registered') {
      const onlineList =
        (msg.onlinePeers as Array<{
          deviceId: string;
          deviceName: string;
          platform: DevicePlatform;
        }>) || [];
      const onlineIds = new Set(onlineList.map((o) => o.deviceId));

      for (const o of onlineList) {
        const existing = this.peers.get(o.deviceId);
        if (existing) {
          existing.deviceName = o.deviceName;
          existing.platform = o.platform;
          existing.online = true;
          existing.lastSeenAt = Date.now();
          if (existing.connectionState !== 'disconnected') {
            existing.connectionState = 'connected';
            this.events.onPeerReady(o.deviceId);
          }
        }
      }

      for (const p of this.peers.values()) {
        if (!onlineIds.has(p.deviceId)) {
          p.online = false;
          p.connectionState = 'offline';
        }
      }

      this.emitPeers();
      return;
    }

    if (type === 'nearby:list') {
      const devices = (msg.devices as NearbyDevice[]) || [];
      this.events.onNearbyUpdated(devices);
      return;
    }

    if (type === 'peer:online') {
      const peerId = String(msg.deviceId || '');
      const existing = this.peers.get(peerId);
      if (existing) {
        existing.deviceName = String(msg.deviceName || existing.deviceName);
        existing.platform = (msg.platform as DevicePlatform) || existing.platform;
        existing.online = true;
        existing.lastSeenAt = Date.now();
        if (existing.connectionState !== 'disconnected') {
          existing.connectionState = 'connected';
          this.events.onPeerReady(peerId);
        }
        this.emitPeers();
      }
      return;
    }

    if (type === 'peer:offline') {
      const peerId = String(msg.deviceId || '');
      const existing = this.peers.get(peerId);
      if (existing) {
        existing.online = false;
        existing.connectionState = 'offline';
        this.emitPeers();
        this.events.onPeerDisconnected(peerId);
      }
      return;
    }

    if (type === 'peer:unpaired') {
      const peerId = String(msg.deviceId || '');
      const existing = this.peers.get(peerId);
      if (existing) {
        existing.online = false;
        existing.connectionState = 'disconnected';
        this.emitPeers();
      }
      this.events.onPeerDisconnected(peerId);
      return;
    }

    if (type === 'pair:created') {
      this.events.onPairingCodeCreated(String(msg.code || ''), Number(msg.expiresAt || 0));
      return;
    }

    if (type === 'pair:error') {
      this.events.onPairingError(String(msg.message || 'Pairing failed.'));
      return;
    }

    if (type === 'pair:direct-invite') {
      this.events.onIncomingPairInvite({
        fromDeviceId: String(msg.fromDeviceId || ''),
        fromDeviceName: String(msg.fromDeviceName || 'Device'),
        fromPlatform: (msg.fromPlatform as DevicePlatform) || 'web',
      });
      return;
    }

    if (type === 'pair:matched') {
      const peerInfo = msg.peer as {
        deviceId: string;
        deviceName: string;
        platform: DevicePlatform;
      };
      const now = Date.now();
      const paired: PairedDevice = {
        deviceId: peerInfo.deviceId,
        deviceName: peerInfo.deviceName,
        platform: peerInfo.platform,
        pairedAt: now,
        lastSeenAt: now,
        online: true,
        connectionState: 'connected',
      };
      this.peers.set(paired.deviceId, paired);
      this.emitPeers();
      this.events.onPairMatched(paired);
      this.events.onPeerReady(paired.deviceId);
      return;
    }

    if (type === 'relay:control') {
      const fromId = String(msg.fromDeviceId || '');
      const payload = msg.payload as Record<string, unknown>;
      if (fromId && payload) {
        // Ensure sender appears connected if paired
        if (!this.peers.has(fromId)) {
          this.peers.set(fromId, {
            deviceId: fromId,
            deviceName: String(msg.fromDeviceName || 'Device'),
            platform: (msg.fromPlatform as DevicePlatform) || 'web',
            pairedAt: Date.now(),
            lastSeenAt: Date.now(),
            online: true,
            connectionState: 'connected',
          });
          this.emitPeers();
        }
        this.events.onControlMessage(fromId, payload);
      }
    }
  }

  private handleWsBinary(buffer: ArrayBuffer): void {
    if (buffer.byteLength <= 72) return;
    const fromDeviceId = this.decoder.decode(buffer.slice(36, 72)).trim();
    const payload = buffer.slice(72);
    this.events.onBinaryMessage(fromDeviceId, payload);
  }

  public isPeerReady(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    return Boolean(
      peer &&
        peer.online &&
        peer.connectionState === 'connected' &&
        this.ws &&
        this.ws.readyState === WebSocket.OPEN
    );
  }

  public sendControl(peerId: string, payload: Record<string, unknown>): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'relay:control',
          targetDeviceId: peerId,
          payload,
        })
      );
      return true;
    }
    return false;
  }

  public sendBinary(peerId: string, buffer: ArrayBuffer): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const targetBytes = this.encoder.encode(peerId.padEnd(36, ' ').slice(0, 36));
      const senderBytes = this.encoder.encode(this.deviceId.padEnd(36, ' ').slice(0, 36));
      const wrapped = new Uint8Array(72 + buffer.byteLength);
      wrapped.set(targetBytes, 0);
      wrapped.set(senderBytes, 36);
      wrapped.set(new Uint8Array(buffer), 72);
      this.ws.send(wrapped.buffer);
      return true;
    }
    return false;
  }

  public async waitForBufferLow(_peerId: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      while (this.ws.bufferedAmount > MAX_WS_BUFFERED) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }

  public getConnectionState(peerId: string): PeerConnectionState {
    return this.peers.get(peerId)?.connectionState || 'offline';
  }
}
