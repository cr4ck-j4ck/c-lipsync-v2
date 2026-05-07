export interface Peer {
  deviceId: string;
  deviceName: string;
  ip: string;
  wsPort: number;
  lastSeen: number;
}

export type MessageType = 'HELLO' | 'ACK' | 'CLIP_UPDATE' | 'REMOTE_PASTE' | 'REMOTE_TYPE' | 'REMOTE_SET_TEXT' | 'REMOTE_SCREENSHOT_REQ' | 'REMOTE_SCREENSHOT_RES';

export interface NetworkMessage {
  type: MessageType;
  sourceId: string;
  payload?: string;
  timestamp: number;
}
