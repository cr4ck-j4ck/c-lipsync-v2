import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { DiscoveryManager } from './discovery/udp.js';
import { NetworkManager } from './network/ws.js';
import { ClipboardManager } from './clipboard/manager.js';
import { PasteSimulator } from './clipboard/paste.js';
import { UIManager } from './ui/cli.js';

async function bootstrap() {
  const deviceId = uuidv4();
  const deviceName = os.hostname() + ' - ' + os.userInfo().username;
  
  console.log(`Starting Local LAN Sync: ${deviceName} [${deviceId}]`);
  
  const pasteSimulator = new PasteSimulator();
  
  const clip = new ClipboardManager(deviceId, (content: string) => {
    // Only send the payload if we have established a connection
    network.broadcast({
      type: 'CLIP_UPDATE',
      sourceId: deviceId,
      payload: content,
      timestamp: Date.now()
    });
  });
  
  let connected = false;
  
  const network = new NetworkManager(deviceId, async (msg) => {
    switch (msg.type) {
      case 'HELLO':
        console.log(`\n[Server] Incoming connection established with peer ${msg.sourceId}`);
        connected = true;
        network.broadcast({ type: 'ACK', sourceId: deviceId, timestamp: Date.now() });
        break;
      case 'ACK':
        console.log(`\n[Client] Connection acknowledged by peer ${msg.sourceId}`);
        connected = true;
        break;
      case 'CLIP_UPDATE':
        if (msg.sourceId !== deviceId && msg.payload !== undefined) {
          await clip.apply(msg.payload);
        }
        break;
      case 'REMOTE_PASTE':
        if (msg.sourceId !== deviceId && msg.payload !== undefined) {
          const preview = msg.payload.length > 60
            ? msg.payload.substring(0, 57) + '...'
            : msg.payload;
          console.log(`\n[Remote Paste] Received from ${msg.sourceId}: "${preview}"`);

          // Step 1: Write to local clipboard
          await clip.apply(msg.payload);

          // Step 2: Simulate Ctrl+V / Cmd+V at the focused window
          await pasteSimulator.paste();

          console.log('[Remote Paste] Pasted to active window.');
        }
        break;
    }
  });

  const assignedPort = await network.init();
  const discovery = new DiscoveryManager(deviceId, deviceName, assignedPort);
  const ui = new UIManager(discovery);
  
  discovery.start();
  await clip.start();
  
  while (!connected) {
    const peer = await ui.selectPeer();
    if (connected) {
      // In case we got connected while waiting for user input
      console.log("Already connected.");
      break;
    }
    
    if (!peer) {
      console.log('Retrying in a moment...');
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    
    console.log(`Attempting connection to ${peer.deviceName} (${peer.ip}:${peer.wsPort})`);
    connected = await network.connect(peer);
    
    if (connected) {
      console.log("Connected Successfully! Clipboard is now synced.");
    } else {
      console.log("Connection failed, retrying...");
    }
  }

  // ── Enter Remote Paste mode ──────────────────────────────────────
  // Clipboard sync (CLIP_UPDATE) continues running in the background
  // via the ClipboardManager polling interval.
  ui.startRemotePasteInput((text: string) => {
    network.broadcast({
      type: 'REMOTE_PASTE',
      sourceId: deviceId,
      payload: text,
      timestamp: Date.now(),
    });
  });
}

bootstrap().catch(console.error);
