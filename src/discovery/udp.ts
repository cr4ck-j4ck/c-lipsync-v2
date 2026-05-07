import * as dgram from 'dgram';
import os from 'os';
import { type Peer } from '../core/types.js';

const DISCOVERY_PORT = 41234;
const BROADCAST_INTERVAL_MS = 2000;

export class DiscoveryManager {
  private socket: dgram.Socket;
  private peers = new Map<string, Peer>();
  private broadcastInterval?: NodeJS.Timeout;
  private bound = false;

  constructor(
    private deviceId: string,
    private deviceName: string,
    private wsPort: number
  ) {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('listening', () => {
      this.socket.setBroadcast(true);
      try { this.socket.setMulticastLoopback(true); } catch (_) { /* ignored */ }
      this.bound = true;
    });

    this.socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.deviceId && data.deviceId !== this.deviceId) {
          this.peers.set(data.deviceId, {
            deviceId: data.deviceId,
            deviceName: data.deviceName || 'Unknown',
            ip: rinfo.address,
            wsPort: data.wsPort,
            lastSeen: Date.now()
          });
        }
      } catch (_) { /* invalid payload */ }
    });

    this.socket.on('error', (err) => {
      console.warn(`[Discovery] UDP socket error: ${err.message}`);
    });
  }

  public start() {
    // Bind on all interfaces so we receive broadcasts from any subnet
    this.socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      console.log(`[Discovery] Listening for peers on UDP port ${DISCOVERY_PORT}`);
      console.log(
        `[Discovery] WINDOWS TIP: If other devices are not visible, run this in an Admin PowerShell:\n` +
        `  netsh advfirewall firewall add rule name="C-Lipsync Discovery" dir=in action=allow protocol=UDP localport=${DISCOVERY_PORT}`
      );
    });

    // Wait for socket to finish binding before sending broadcasts
    const startBroadcast = () => {
      if (!this.bound) {
        setTimeout(startBroadcast, 100);
        return;
      }
      // Send first broadcast immediately, then repeat
      this.sendBroadcast();
      this.broadcastInterval = setInterval(() => this.sendBroadcast(), BROADCAST_INTERVAL_MS);
    };
    startBroadcast();
  }

  private sendBroadcast() {
    const payload = JSON.stringify({
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      wsPort: this.wsPort
    });

    const targets = new Set<string>(['255.255.255.255']);

    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of (interfaces[name] || [])) {
        if (net.family === 'IPv4' && !net.internal && net.netmask) {
          const ipParts = net.address.split('.');
          const maskParts = net.netmask.split('.');
          const bc = ipParts
            .map((p, i) => ((~parseInt(maskParts[i] ?? '255') & 255) | parseInt(p)))
            .join('.');
          targets.add(bc);
        }
      }
    }

    for (const addr of targets) {
      this.socket.send(payload, 0, payload.length, DISCOVERY_PORT, addr, () => {
        // Silent catch for broadcast errors on unconnected interfaces
      });
    }
  }

  public getPeers(): Peer[] {
    const now = Date.now();
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > 10000) this.peers.delete(id);
    }
    return Array.from(this.peers.values());
  }

  public stop() {
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    this.socket.close();
  }
}
