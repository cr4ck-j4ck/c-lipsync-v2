import { WebSocketServer, WebSocket } from 'ws';
import type { NetworkMessage, Peer } from '../core/types.js';
import { randomBytes } from 'crypto';

export class NetworkManager {
  private wss!: WebSocketServer;
  private connections: Set<WebSocket> = new Set();
  public port: number = 0;

  constructor(
    private deviceId: string,
    private onMessage: (msg: NetworkMessage) => void
  ) {}

  public init(): Promise<number> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ host: '0.0.0.0', port: 0 }, () => {
        const address = this.wss.address();
        if (typeof address === 'object' && address !== null) {
          this.port = address.port;
        }
        resolve(this.port);
      });
      
      this.wss.on('connection', (ws) => {
        this.connections.add(ws);
        
        ws.on('message', (data: Buffer) => {
          try {
            const msg: NetworkMessage = JSON.parse(data.toString());
            this.onMessage(msg);
          } catch (e) {
            console.error("Failed to parse network message:", e);
          }
        });
        
        ws.on('close', () => {
          this.connections.delete(ws);
        });
      });
    });
  }

  public connect(peer: Peer): Promise<boolean> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://${peer.ip}:${peer.wsPort}`);
      
      ws.on('open', () => {
        this.connections.add(ws);
        
        // Handshake
        this.broadcast({
          type: 'HELLO',
          sourceId: this.deviceId,
          timestamp: Date.now()
        });
        
        resolve(true);
      });
      
      ws.on('message', (data: Buffer) => {
        try {
          const msg: NetworkMessage = JSON.parse(data.toString());
          this.onMessage(msg);
        } catch (e) {}
      });
      
      ws.on('error', (err) => {
        console.error(`Error connecting to peer ${peer.deviceName}: ${err.message}`);
        resolve(false);
      });
      
      ws.on('close', () => {
        this.connections.delete(ws);
      });
    });
  }

  public broadcast(msg: NetworkMessage) {
    const data = JSON.stringify(msg);
    for (const client of this.connections) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  public stop() {
    this.wss.close();
    for (const client of this.connections) {
      client.close();
    }
  }
}
