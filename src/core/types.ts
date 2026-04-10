export interface Peer {
  deviceId: string;
  deviceName: string;
  ip: string;
  wsPort: number;
  lastSeen: number;
}

export type MessageType = 'HELLO' | 'ACK' | 'CLIP_UPDATE' | 'REMOTE_PASTE';

export interface NetworkMessage {
  type: MessageType;
  sourceId: string;
  payload?: string;
  timestamp: number;
}
