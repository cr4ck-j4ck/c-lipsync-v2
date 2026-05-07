import clipboard from 'clipboardy';
import inquirer from 'inquirer';
import * as readline from 'readline';
import { type Peer } from '../core/types.js';
import { DiscoveryManager } from '../discovery/udp.js';

type RemoteCommandType = 'REMOTE_PASTE' | 'REMOTE_TYPE' | 'REMOTE_SET_TEXT' | 'REMOTE_SCREENSHOT_REQ';

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
    choices.push({
      name: 'Manual connect by IP/port',
      value: 'manual' as any
    });
    choices.push({ name: 'Refresh list', value: null as any });

    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Select a device to connect to:',
        choices
      }
    ]);

    if (selected === 'manual') {
      const manual = await inquirer.prompt([
        {
          type: 'input',
          name: 'ip',
          message: 'Remote device IP:',
          validate: (value: string) => value.trim() ? true : 'Enter an IP address'
        },
        {
          type: 'input',
          name: 'port',
          message: 'Remote WebSocket port:',
          validate: (value: string) => {
            const port = Number(value);
            return Number.isInteger(port) && port > 0 && port <= 65535
              ? true
              : 'Enter a valid port number';
          }
        }
      ]);

      return {
        deviceId: `manual-${manual.ip}:${manual.port}`,
        deviceName: `Manual ${manual.ip}:${manual.port}`,
        ip: manual.ip.trim(),
        wsPort: Number(manual.port),
        lastSeen: Date.now(),
      };
    }

    return selected;
  }

  public startRemotePasteInput(onSend: (text: string, actionType: RemoteCommandType) => void): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'paste > ',
    });
    let multilineMode: RemoteCommandType | null = null;
    let multilineLines: string[] = [];

    console.log('\n────────────────────────────────────────────');
    console.log('  Remote Command Mode');
    console.log('  Commands: .help | .quit | .screenshot | .type <text> | .set <text> | .setclip');
    console.log('────────────────────────────────────────────\n');

    rl.prompt();

    rl.on('line', async (line: string) => {
      const trimmed = line.trim();

      if (multilineMode) {
        if (trimmed === '.end') {
          const payload = multilineLines.join('\n');
          onSend(payload, multilineMode);
          console.log(`  → Sent ${multilineLines.length} line(s): "${this.preview(payload)}"`);
          multilineMode = null;
          multilineLines = [];
          rl.setPrompt('paste > ');
          rl.prompt();
          return;
        }

        if (trimmed === '.cancel') {
          multilineMode = null;
          multilineLines = [];
          rl.setPrompt('paste > ');
          console.log('  → Multiline input cancelled.');
          rl.prompt();
          return;
        }

        multilineLines.push(line);
        rl.prompt();
        return;
      }

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
        console.log(`
Available commands:
  <text>
      Copy text to the receiver clipboard and trigger Ctrl+V.

  .type <text>
      Send keyboard-like events to the focused receiver window.
      Works in many normal apps, but some apps reject synthetic input.

  .set <text>
      Set the focused text control through OS accessibility/UI Automation.
      Best for target apps where .type is ignored.

  .set
      Start multiline focused-text mode. Paste/type formatted text,
      enter .end on its own line to send, or .cancel to abort.

  .setclip
      Send your local clipboard through .set. Best for formatted code,
      because it preserves newlines and indentation.

  .screenshot
      Ask the receiver to take a screenshot and copy it back to you.

  .quit
      Exit remote command mode. Clipboard sync remains active.

More docs: docs/USAGE.md
`);
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
        console.log(`  → Sent (as keystrokes): "${this.preview(payload)}"`);
        rl.prompt();
        return;
      }

      if (trimmed === '.set') {
        multilineMode = 'REMOTE_SET_TEXT';
        multilineLines = [];
        rl.setPrompt('set > ');
        console.log('  → Multiline .set mode. Paste/type text now, then enter .end on its own line.');
        rl.prompt();
        return;
      }

      if (trimmed.startsWith('.set ')) {
        const payload = line.substring(5); // Remove `.set ` but keep spaces after
        onSend(payload, 'REMOTE_SET_TEXT');
        console.log(`  → Sent (as focused text value): "${this.preview(payload)}"`);
        rl.prompt();
        return;
      }

      if (trimmed === '.setclip') {
        try {
          const payload = await clipboard.read();
          onSend(payload, 'REMOTE_SET_TEXT');
          console.log(`  → Sent clipboard as focused text: "${this.preview(payload)}"`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`  → Failed to read local clipboard: ${message}`);
        }
        rl.prompt();
        return;
      }

      // Default: send as REMOTE_PASTE
      onSend(line, 'REMOTE_PASTE');
      console.log(`  → Sent (via Ctrl+V): "${this.preview(line)}"`);

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

  private preview(text: string): string {
    const compact = text.replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
    return compact.length > 60 ? compact.substring(0, 57) + '...' : compact;
  }
}
