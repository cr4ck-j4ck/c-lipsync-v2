import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { DiscoveryManager } from './discovery/udp.js';
import { NetworkManager } from './network/ws.js';
import { ClipboardManager } from './clipboard/manager.js';
import { PasteSimulator } from './clipboard/paste.js';
import { ImageManager } from './clipboard/image.js';
import { UIManager } from './ui/cli.js';

async function bootstrap() {
  const deviceId = uuidv4();
  const deviceName = os.hostname() + ' - ' + os.userInfo().username;
  
  console.log(`Starting Local LAN Sync: ${deviceName} [${deviceId}]`);
  
  const pasteSimulator = new PasteSimulator();
  const imageManager = new ImageManager();
  
  const clip = new ClipboardManager(deviceId, (content: string) => {
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
      case 'REMOTE_TYPE':
        if (msg.sourceId !== deviceId && msg.payload !== undefined) {
          const preview = msg.payload.length > 60
            ? msg.payload.substring(0, 57) + '...'
            : msg.payload;
            
          if (msg.type === 'REMOTE_PASTE') {
            console.log(`\n[Remote Paste] Received from ${msg.sourceId}: "${preview}"`);
            await clip.apply(msg.payload);
            await pasteSimulator.paste();
            console.log('[Remote Paste] Pasted to active window via Ctrl+V.');
          } else {
            console.log(`\n[Remote Type] Received from ${msg.sourceId}: "${preview}"`);
            await clip.apply(msg.payload);
            await pasteSimulator.typeText(msg.payload);
            console.log('[Remote Type] Type-emulated directly to active window.');
          }
        }
        break;
      case 'REMOTE_SCREENSHOT_REQ':
        if (msg.sourceId !== deviceId) {
          console.log(`\n[Screenshot] Remote device ${msg.sourceId} triggered a screenshot. Rendering...`);
          const base64Img = await imageManager.captureScreen();
          if (base64Img) {
             network.broadcast({
               type: 'REMOTE_SCREENSHOT_RES',
               sourceId: deviceId,
               payload: base64Img,
               timestamp: Date.now()
             });
             console.log(`[Screenshot] Successfully snapped and sent ${(base64Img.length / 1024).toFixed(0)} KB back!`);
          } else {
             console.error(`[Screenshot] Failed to capture desktop. Output empty.`);
          }
        }
        break;
      case 'REMOTE_SCREENSHOT_RES':
        if (msg.sourceId !== deviceId && msg.payload) {
          console.log(`\n[Screenshot] Receiver matched! Incoming snapshot from ${msg.sourceId} (${(msg.payload.length / 1024).toFixed(0)} KB)`);
          const success = await imageManager.writeClipboard(msg.payload);
          if (success) {
             console.log(`[Screenshot SUCCESS] 🎆 The remote image is now in your local clipboard! Paste it wherever you want.`);
          } else {
             console.error(`[Screenshot ERROR] Could not inject the incoming image into your system clipboard.`);
          }
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

  ui.startRemotePasteInput((text: string, actionType: 'REMOTE_PASTE' | 'REMOTE_TYPE' | 'REMOTE_SCREENSHOT_REQ') => {
    network.broadcast({
      type: actionType,
      sourceId: deviceId,
      payload: text,
      timestamp: Date.now(),
    });
  });
}

bootstrap().catch(console.error);
