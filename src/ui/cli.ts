import inquirer from 'inquirer';
import * as readline from 'readline';
import { type Peer } from '../core/types.js';
import { DiscoveryManager } from '../discovery/udp.js';

export class UIManager {
  constructor(private discovery: DiscoveryManager) {}

  public async selectPeer(): Promise<Peer | null> {
    console.clear();
    console.log("Searching for devices on LAN...\n");
    
    await new Promise(r => setTimeout(r, 2000));
    
    const peers = this.discovery.getPeers();
    if (peers.length === 0) {
      console.log("No devices found.");
      return null;
    }

    const choices = peers.map(peer => ({
      name: `${peer.deviceName} (${peer.ip})`,
      value: peer
    }));
    choices.push({ name: 'Refresh list', value: null as any });

    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Select a device to connect to:',
        choices
      }
    ]);

    return selected;
  }

  public startRemotePasteInput(onSend: (text: string, actionType: 'REMOTE_PASTE' | 'REMOTE_TYPE' | 'REMOTE_SCREENSHOT_REQ') => void): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'paste > ',
    });

    console.log('\n────────────────────────────────────────────');
    console.log('  Remote Command Mode');
    console.log('  Commands: .help | .quit | .screenshot | .type <text>');
    console.log('────────────────────────────────────────────\n');

    rl.prompt();

    rl.on('line', (line: string) => {
      const trimmed = line.trim();

      if (trimmed === '') {
        rl.prompt();
        return;
      }

      if (trimmed === '.quit') {
        console.log('Exiting mode. Clipboard sync remains active.');
        rl.close();
        return;
      }

      if (trimmed === '.help') {
        console.log('\nAvailable commands:');
        console.log('  .quit         — exit remote command mode');
        console.log('  .help         — show this help message');
        console.log('  .screenshot   — command the remote device to take a desktop snapshot and copy it back to you');
        console.log('  .type <text>  — explicitly emulate typing instead of Ctrl+V (Bypasses blocks in games/remote-desktops)');
        console.log('  <text>        — default: copy string to clipboard and trigger Ctrl+V on remote device\n');
        rl.prompt();
        return;
      }
      
      if (trimmed === '.screenshot') {
        onSend('', 'REMOTE_SCREENSHOT_REQ');
        console.log(`  → Requested Remote Screenshot... Waiting for response...`);
        rl.prompt();
        return;
      }

      if (trimmed.startsWith('.type ')) {
        const payload = line.substring(6); // Remove `.type ` but keep spaces after
        onSend(payload, 'REMOTE_TYPE');
        const preview = payload.length > 60 ? payload.substring(0, 57) + '...' : payload;
        console.log(`  → Sent (as keystrokes): "${preview}"`);
        rl.prompt();
        return;
      }

      // Default: send as REMOTE_PASTE
      onSend(line, 'REMOTE_PASTE');
      const preview = line.length > 60 ? line.substring(0, 57) + '...' : line;
      console.log(`  → Sent (via Ctrl+V): "${preview}"`);

      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\n[Command mode ended]');
    });

    rl.on('SIGINT', () => {
      console.log('\nInterrupted — exiting command mode.');
      rl.close();
    });
  }
}
