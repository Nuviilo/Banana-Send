import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface ClientRecord {
  ws: WebSocket;
  deviceId: string;
  deviceName: string;
  platform: string;
  networkKey: string;
  knownPeerIds: Set<string>;
  isAlive: boolean;
}

interface PairingSession {
  code: string;
  hostDeviceId: string;
  createdAt: number;
  expiresAt: number;
}

const clients = new Map<string, ClientRecord>();
const pairingCodes = new Map<string, PairingSession>();

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  if (pairingCodes.has(code)) {
    return generatePairingCode();
  }
  return code;
}

function getNetworkKey(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  let ip = '';
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    ip = forwarded.split(',')[0].trim();
  } else if (Array.isArray(forwarded) && forwarded.length > 0) {
    ip = forwarded[0].trim();
  } else {
    ip = req.socket.remoteAddress || 'unknown';
  }
  return ip.replace(/^::ffff:/, '');
}

function sendJson(ws: WebSocket | undefined, payload: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastNearbyForNetwork(networkKey: string): void {
  const peersInNetwork: Array<{ deviceId: string; deviceName: string; platform: string }> = [];
  for (const client of clients.values()) {
    if (client.networkKey === networkKey && client.ws.readyState === WebSocket.OPEN) {
      peersInNetwork.push({
        deviceId: client.deviceId,
        deviceName: client.deviceName,
        platform: client.platform,
      });
    }
  }

  for (const client of clients.values()) {
    if (client.networkKey === networkKey && client.ws.readyState === WebSocket.OPEN) {
      sendJson(client.ws, {
        type: 'nearby:list',
        devices: peersInNetwork.filter((p) => p.deviceId !== client.deviceId),
      });
    }
  }
}

function notifyKnownPeersStatus(changedClient: ClientRecord, online: boolean): void {
  for (const other of clients.values()) {
    if (other.deviceId === changedClient.deviceId) continue;
    if (other.knownPeerIds.has(changedClient.deviceId) || changedClient.knownPeerIds.has(other.deviceId)) {
      sendJson(other.ws, {
        type: online ? 'peer:online' : 'peer:offline',
        deviceId: changedClient.deviceId,
        deviceName: changedClient.deviceName,
        platform: changedClient.platform,
      });
    }
  }
}

// Cleanup expired pairing codes every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [code, session] of pairingCodes.entries()) {
    if (session.expiresAt <= now) {
      pairingCodes.delete(code);
    }
  }
}, 60_000);

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'banana-send-server' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 * 1024 });

  wss.on('connection', (ws, req) => {
    const networkKey = getNetworkKey(req);
    let currentDeviceId: string | null = null;

    ws.on('pong', () => {
      if (currentDeviceId) {
        const c = clients.get(currentDeviceId);
        if (c) c.isAlive = true;
      }
    });

    ws.on('message', (raw, isBinary) => {
      // Binary chunk pass-through: [36 bytes targetDeviceId][36 bytes senderDeviceId][payload]
      if (isBinary) {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (buf.length <= 72) return;
        const targetId = buf.subarray(0, 36).toString('utf8').trim();
        const targetClient = clients.get(targetId);
        if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
          targetClient.ws.send(buf, { binary: true });
        }
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'register') {
        const deviceId = String(msg.deviceId || '').trim();
        const deviceName = String(msg.deviceName || 'Banana Device').trim().slice(0, 48);
        const platform = String(msg.platform || 'web');
        const knownPeers = Array.isArray(msg.knownPeerIds)
          ? msg.knownPeerIds.map((id) => String(id))
          : [];

        if (!deviceId) return;

        const previous = clients.get(deviceId);
        if (previous && previous.ws !== ws && previous.ws.readyState === WebSocket.OPEN) {
          previous.ws.close(4001, 'Replaced by newer connection');
        }

        currentDeviceId = deviceId;
        const record: ClientRecord = {
          ws,
          deviceId,
          deviceName,
          platform,
          networkKey,
          knownPeerIds: new Set(knownPeers),
          isAlive: true,
        };
        clients.set(deviceId, record);

        const onlinePeers: Array<{ deviceId: string; deviceName: string; platform: string }> = [];
        for (const peerId of record.knownPeerIds) {
          const peer = clients.get(peerId);
          if (peer && peer.ws.readyState === WebSocket.OPEN) {
            onlinePeers.push({
              deviceId: peer.deviceId,
              deviceName: peer.deviceName,
              platform: peer.platform,
            });
          }
        }

        sendJson(ws, {
          type: 'registered',
          deviceId,
          onlinePeers,
        });

        notifyKnownPeersStatus(record, true);
        broadcastNearbyForNetwork(networkKey);
        return;
      }

      if (!currentDeviceId) return;
      const sender = clients.get(currentDeviceId);
      if (!sender) return;

      if (type === 'update-device') {
        if (typeof msg.deviceName === 'string' && msg.deviceName.trim()) {
          sender.deviceName = msg.deviceName.trim().slice(0, 48);
        }
        if (typeof msg.platform === 'string') {
          sender.platform = msg.platform;
        }
        if (Array.isArray(msg.knownPeerIds)) {
          sender.knownPeerIds = new Set(msg.knownPeerIds.map((id) => String(id)));
        }
        notifyKnownPeersStatus(sender, true);
        broadcastNearbyForNetwork(sender.networkKey);
        return;
      }

      if (type === 'pair:create') {
        for (const [c, session] of pairingCodes.entries()) {
          if (session.hostDeviceId === sender.deviceId) {
            pairingCodes.delete(c);
          }
        }
        const code = generatePairingCode();
        const now = Date.now();
        const expiresAt = now + 10 * 60 * 1000;
        pairingCodes.set(code, {
          code,
          hostDeviceId: sender.deviceId,
          createdAt: now,
          expiresAt,
        });
        sendJson(ws, {
          type: 'pair:created',
          code,
          expiresAt,
        });
        return;
      }

      if (type === 'pair:join') {
        const rawCode = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const session = pairingCodes.get(rawCode);
        if (!session || session.expiresAt <= Date.now()) {
          if (session) pairingCodes.delete(rawCode);
          sendJson(ws, {
            type: 'pair:error',
            message: 'Pairing code is invalid or expired.',
          });
          return;
        }
        if (session.hostDeviceId === sender.deviceId) {
          sendJson(ws, {
            type: 'pair:error',
            message: 'You cannot pair a device with itself.',
          });
          return;
        }
        const host = clients.get(session.hostDeviceId);
        if (!host || host.ws.readyState !== WebSocket.OPEN) {
          sendJson(ws, {
            type: 'pair:error',
            message: 'Host device is currently offline.',
          });
          return;
        }

        pairingCodes.delete(rawCode);
        sender.knownPeerIds.add(host.deviceId);
        host.knownPeerIds.add(sender.deviceId);

        sendJson(sender.ws, {
          type: 'pair:matched',
          peer: {
            deviceId: host.deviceId,
            deviceName: host.deviceName,
            platform: host.platform,
          },
        });

        sendJson(host.ws, {
          type: 'pair:matched',
          peer: {
            deviceId: sender.deviceId,
            deviceName: sender.deviceName,
            platform: sender.platform,
          },
        });
        return;
      }

      if (type === 'pair:direct-invite') {
        const targetId = String(msg.targetDeviceId || '');
        const target = clients.get(targetId);
        if (!target || target.ws.readyState !== WebSocket.OPEN) {
          sendJson(ws, { type: 'pair:error', message: 'Device is no longer online.' });
          return;
        }
        sendJson(target.ws, {
          type: 'pair:direct-invite',
          fromDeviceId: sender.deviceId,
          fromDeviceName: sender.deviceName,
          fromPlatform: sender.platform,
        });
        return;
      }

      if (type === 'pair:direct-accept') {
        const targetId = String(msg.targetDeviceId || '');
        const target = clients.get(targetId);
        if (!target || target.ws.readyState !== WebSocket.OPEN) return;

        sender.knownPeerIds.add(target.deviceId);
        target.knownPeerIds.add(sender.deviceId);

        sendJson(target.ws, {
          type: 'pair:matched',
          peer: {
            deviceId: sender.deviceId,
            deviceName: sender.deviceName,
            platform: sender.platform,
          },
        });

        sendJson(sender.ws, {
          type: 'pair:matched',
          peer: {
            deviceId: target.deviceId,
            deviceName: target.deviceName,
            platform: target.platform,
          },
        });
        return;
      }

      if (type === 'peer:unpair') {
        const targetId = String(msg.targetDeviceId || '');
        sender.knownPeerIds.delete(targetId);
        const target = clients.get(targetId);
        if (target) {
          target.knownPeerIds.delete(sender.deviceId);
          sendJson(target.ws, {
            type: 'peer:unpaired',
            deviceId: sender.deviceId,
          });
        }
        return;
      }

      if (type === 'relay:control') {
        const targetId = String(msg.targetDeviceId || '');
        const target = clients.get(targetId);
        if (!target || target.ws.readyState !== WebSocket.OPEN) {
          sendJson(ws, {
            type: 'peer:offline',
            deviceId: targetId,
          });
          return;
        }

        sender.knownPeerIds.add(targetId);
        target.knownPeerIds.add(sender.deviceId);

        sendJson(target.ws, {
          ...msg,
          fromDeviceId: sender.deviceId,
          fromDeviceName: sender.deviceName,
          fromPlatform: sender.platform,
        });
      }
    });

    ws.on('close', () => {
      if (!currentDeviceId) return;
      const existing = clients.get(currentDeviceId);
      if (existing && existing.ws === ws) {
        clients.delete(currentDeviceId);
        notifyKnownPeersStatus(existing, false);
        broadcastNearbyForNetwork(existing.networkKey);
      }
    });
  });

  const heartbeatInterval = setInterval(() => {
    for (const [id, client] of clients.entries()) {
      if (!client.isAlive) {
        client.ws.terminate();
        clients.delete(id);
        notifyKnownPeersStatus(client, false);
        broadcastNearbyForNetwork(client.networkKey);
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
  }, 25_000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Banana Send server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Banana Send server:', err);
  process.exit(1);
});
