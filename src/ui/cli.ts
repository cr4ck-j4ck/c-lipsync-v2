import inquirer from 'inquirer';
import * as readline from 'readline';
import { type Peer } from '../core/types.js';
import { DiscoveryManager } from '../discovery/udp.js';

export class UIManager {
  constructor(private discovery: DiscoveryManager) {}

  public async selectPeer(): Promise<Peer | null> {
    console.clear();
    console.log("Searching for devices on LAN...\n");
    
    // Give discovery some time to populate
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

  /**
   * Starts a continuous readline input loop for remote paste mode.
   * Each line typed by the user is passed to the `onSend` callback.
   *
   * Special commands:
   *   .quit  — exit paste mode
   *   .help  — show available commands
   */
  public startRemotePasteInput(onSend: (text: string) => void): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'paste > ',
    });

    console.log('\n────────────────────────────────────────────');
    console.log('  Remote Paste Mode');
    console.log('  Type any string and press ENTER to send');
    console.log('  Commands: .help | .quit');
    console.log('────────────────────────────────────────────\n');

    rl.prompt();

    rl.on('line', (line: string) => {
      const trimmed = line.trim();

      if (trimmed === '') {
        rl.prompt();
        return;
      }

      if (trimmed === '.quit') {
        console.log('Exiting paste mode. Clipboard sync remains active.');
        rl.close();
        return;
      }

      if (trimmed === '.help') {
        console.log('\nAvailable commands:');
        console.log('  .quit   — exit remote paste mode');
        console.log('  .help   — show this help message');
        console.log('  <text>  — send text to remote device and trigger paste\n');
        rl.prompt();
        return;
      }

      // Send the full original line (preserve spaces, only trim was for command detection)
      onSend(line);

      // Truncate preview for display
      const preview = line.length > 60 ? line.substring(0, 57) + '...' : line;
      console.log(`  → Sent: "${preview}"`);

      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\n[Paste mode ended]');
    });

    // Handle SIGINT gracefully — don't kill the process, just exit paste mode
    rl.on('SIGINT', () => {
      console.log('\nInterrupted — exiting paste mode.');
      rl.close();
    });
  }
}
