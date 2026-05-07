import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { DiscoveryManager } from './discovery/udp.js';
import { NetworkManager } from './network/ws.js';
import { ClipboardManager } from './clipboard/manager.js';
import { PasteSimulator } from './clipboard/paste.js';
import { ImageManager } from './clipboard/image.js';
import { UIManager } from './ui/cli.js';

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  printHelp();
  process.exit(0);
}

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
      case 'REMOTE_SET_TEXT':
      case 'REMOTE_INSERT_TEXT':
        if (msg.sourceId !== deviceId && msg.payload !== undefined) {
          const preview = msg.payload.length > 60
            ? msg.payload.substring(0, 57) + '...'
            : msg.payload;
            
          if (msg.type === 'REMOTE_PASTE') {
            console.log(`\n[Remote Paste] Received from ${msg.sourceId}: "${preview}"`);
            await clip.apply(msg.payload);
            const pasted = await pasteSimulator.paste();
            if (pasted) {
              console.log('[Remote Paste] Pasted to active window via Ctrl+V.');
            } else {
              console.log('[Remote Paste] Paste simulation failed. Check the error above on this receiver.');
            }
          } else if (msg.type === 'REMOTE_TYPE') {
            console.log(`\n[Remote Type] Received from ${msg.sourceId}: "${preview}"`);
            await clip.apply(msg.payload);
            const typed = await pasteSimulator.typeText(msg.payload);
            if (typed) {
              console.log('[Remote Type] Type-emulated directly to active window.');
            } else {
              console.log('[Remote Type] Typing simulation failed. Check the error above on this receiver.');
            }
          } else {
            const label = msg.type === 'REMOTE_SET_TEXT' ? 'Remote Set Text' : 'Remote Insert Text';
            console.log(`\n[${label}] Received from ${msg.sourceId}: "${preview}"`);
            await clip.apply(msg.payload);
            if (msg.type === 'REMOTE_SET_TEXT') {
              const set = await pasteSimulator.setFocusedText(msg.payload);
              if (set) {
                console.log('[Remote Set Text] Focused text control replaced through accessibility/UI Automation.');
              } else {
                console.log('[Remote Set Text] Focused text update failed. Check the error above on this receiver.');
              }
            } else {
              const inserted = await pasteSimulator.insertFocusedText(msg.payload);
              if (inserted) {
                console.log('[Remote Insert Text] Text inserted at focused control caret through accessibility/UI Automation.');
              } else {
                console.log('[Remote Insert Text] Focused text insert failed. Check the error above on this receiver.');
              }
            }
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
  const localAddresses = getLocalIPv4Addresses();
  console.log(`Listening for direct connections on port ${assignedPort}`);
  if (localAddresses.length > 0) {
    console.log(`Local IPs: ${localAddresses.join(', ')}`);
  }
  console.log('If discovery is one-way, choose "Manual connect by IP/port" on the other device.\n');

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

  ui.startRemotePasteInput((text: string, actionType: 'REMOTE_PASTE' | 'REMOTE_TYPE' | 'REMOTE_SET_TEXT' | 'REMOTE_INSERT_TEXT' | 'REMOTE_SCREENSHOT_REQ') => {
    network.broadcast({
      type: actionType,
      sourceId: deviceId,
      payload: text,
      timestamp: Date.now(),
    });
  });
}

bootstrap().catch(console.error);

function getLocalIPv4Addresses(): string[] {
  const addresses: string[] = [];
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  return addresses;
}

function printHelp() {
  console.log(`
C-Lipsync LAN clipboard and remote text helper

Usage:
  pnpm start
  pnpm start -- -h
  pnpm start -- --help

Startup flow:
  1. Run this app on both computers on the same WiFi/LAN.
  2. Select the visible peer from the device list.
  3. If discovery is one-way, use "Manual connect by IP/port" with the IP/port printed by the other device.
  4. Focus the target text box/window on the receiving computer.
  5. Send one of the remote commands below from the sender.

Remote command mode:
  <text>
      Default path. Copies text to the receiver clipboard and sends Ctrl+V.
      Good for normal paste-friendly apps.

  .type <text>
      Sends keyboard-like events to the focused receiver window.
      Good for Notepad and standard desktop apps.
      Some apps reject synthetic keyboard input.

  .set <text>
      Replaces the whole focused text control through Windows UI Automation.

  .insert <text>
      Inserts text at the focused control caret, or replaces selected text.

  .set
      Starts multiline replace mode. Paste/type formatted code, then enter .end.
      Use .cancel to abort.

  .insert
      Starts multiline insert mode. Paste/type formatted code, then enter .end.
      Use .cancel to abort.

  .setclip
      Replaces the focused text with the sender's local clipboard.

  .insertclip
      Inserts the sender's local clipboard at the caret.
      Best choice for adding formatted code because it preserves newlines and indentation.

  .screenshot
      Requests a screenshot from the receiver and places it on the sender clipboard.

  .help
      Shows command help inside remote command mode.

  .quit
      Exits remote command mode. Clipboard sync remains active.

Docs:
  See docs/USAGE.md for detailed examples, troubleshooting, and input-method tradeoffs.
`);
}
