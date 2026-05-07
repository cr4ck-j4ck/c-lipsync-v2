import * as dgram from 'dgram';
import os from 'os';
import { type Peer } from '../core/types.js';

const DISCOVERY_PORT = 41234;
const BROADCAST_INTERVALMs = 2000;

export class DiscoveryManager {
  private socket: dgram.Socket;
  private peers = new Map<string, Peer>();
  private broadcastInterval?: NodeJS.Timeout;

  constructor(
    private deviceId: string,
    private deviceName: string,
    private wsPort: number
  ) {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (err) => {
      console.error(`[Discovery] UDP error: ${err.message}`);
    });
    
    // Bind to the port and allow broadcast and address reuse
    this.socket.on('listening', () => {
      this.socket.setBroadcast(true);
      try {
        this.socket.setMulticastLoopback(true);
      } catch (err) {
        // Ignored on some OS
      }
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
      } catch (e) {
        // Invalid payload format
      }
    });
  }

  public start() {
    this.socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      this.broadcastPresence();
    });
    
    this.broadcastInterval = setInterval(() => {
      this.broadcastPresence();
    }, BROADCAST_INTERVALMs);
  }

  public getPeers(): Peer[] {
    const now = Date.now();
    // Prune stale peers (> 10 seconds unseen)
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > 10000) {
        this.peers.delete(id);
      }
    }
    return Array.from(this.peers.values());
  }

  public stop() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }
    this.socket.close();
  }

  private broadcastPresence() {
    const payload = JSON.stringify({
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      wsPort: this.wsPort
    });
    
    const uniqueBroadcasts = [...new Set([
      ...this.getBroadcastAddresses(),
      '255.255.255.255',
    ])];
    
    uniqueBroadcasts.forEach(addr => {
      this.socket.send(payload, 0, payload.length, DISCOVERY_PORT, addr, (err) => {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        if (err && code !== 'ENETUNREACH' && code !== 'EHOSTUNREACH') {
          console.error(`[Discovery] Failed to broadcast to ${addr}: ${err.message}`);
        }
      });
    });
  }

  private getBroadcastAddresses(): string[] {
    const broadcastAddresses: string[] = [];
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (net.family === 'IPv4' && !net.internal && net.netmask) {
          const ipParts = net.address.split('.').map(Number);
          const maskParts = net.netmask.split('.').map(Number);
          if (ipParts.length !== 4 || maskParts.length !== 4) {
            continue;
          }

          const broadcastParts = ipParts.map((part, i) => {
            const mask = maskParts[i] ?? 255;
            return ((~mask & 255) | part).toString();
          });
          broadcastAddresses.push(broadcastParts.join('.'));
        }
      }
    }

    return broadcastAddresses;
  }
}
