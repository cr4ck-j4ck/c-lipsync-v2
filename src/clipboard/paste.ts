import { execFile } from 'child_process';
import os from 'os';

/**
 * Simulates an OS-level paste (Ctrl+V / Cmd+V) at the currently focused window.
 * Now also supports raw keystroke typing to bypass Ctrl+V blocks.
 */
export class PasteSimulator {
  private readonly platform: NodeJS.Platform;

  constructor() {
    this.platform = os.platform();
  }

  public async paste(): Promise<void> {
    await this.sleep(150);

    try {
      await this.simulateKeystroke();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n[PasteSimulator Error] Failed to simulate paste:\n  -> ${message}`);
      
      const hint = this.getInstallHint();
      if (hint) {
        console.log(`\x1b[33m${hint}\x1b[0m`);
      }
    }
  }

  public async typeText(text: string): Promise<void> {
    await this.sleep(150);

    try {
      await this.simulateTyping(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n[PasteSimulator Error] Failed to simulate typing:\n  -> ${message}`);
    }
  }

  private simulateTyping(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.platform === 'linux') {
        execFile('wtype', [text], { timeout: 10000 }, (err) => {
          if (!err) return resolve();
          
          execFile('xdotool', ['type', '--clearmodifiers', text], { timeout: 10000 }, (err2) => {
            if (!err2) return resolve();
            reject(new Error(`Linux typing simulation requires either 'wtype' (Wayland) or 'xdotool' (X11).`));
          });
        });
        return;
      }

      if (this.platform === 'darwin') {
        const escaped = text.replace(/"/g, '\\"');
        execFile(
          'osascript', 
          ['-e', `tell application "System Events" to keystroke "${escaped}"`], 
          { timeout: 10000 }, 
          (error, _stdout, stderr) => {
            if (error) reject(new Error(`osascript failed: ${stderr.trim()}`));
            else resolve();
          }
        );
        return;
      }

      if (this.platform === 'win32') {
        // Powershell SendKeys syntax requires escaping these characters: + ^ % ~ ( ) [ ] { }
        // The escape mechanism is wrapping the character in curly braces: {+}
        const escaped = text.replace(/([+^%~()[\]{}])/g, '{$1}');
        
        // Single quotes also need to be doubled for powershell literal strings
        const psString = escaped.replace(/'/g, "''");
        
        execFile(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psString}')`
          ],
          { timeout: 30000 },
          (error, _stdout, stderr) => {
            if (error) reject(new Error(`powershell failed: ${stderr.trim()}`));
            else resolve();
          }
        );
        return;
      }

      reject(new Error(`Unsupported platform: ${this.platform}`));
    });
  }

  private simulateKeystroke(): Promise<void> {
    return new Promise((resolve, reject) => {
      
      if (this.platform === 'linux') {
        execFile('wtype', ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl'], { timeout: 3000 }, (err) => {
          if (!err) return resolve();
          
          execFile('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], { timeout: 3000 }, (err2) => {
            if (!err2) return resolve();
            
            reject(new Error(`Linux paste simulation requires either 'wtype' (Wayland) or 'xdotool' (X11) installed on the system.`));
          });
        });
        return;
      }

      let command: string;
      let args: string[];

      if (this.platform === 'darwin') {
        command = 'osascript';
        args = [
          '-e',
          'tell application "System Events" to keystroke "v" using command down',
        ];
      } else if (this.platform === 'win32') {
        command = 'powershell';
        args = [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
        ];
      } else {
         return reject(new Error(`Unsupported platform: ${this.platform}`));
      }

      execFile(command, args, { timeout: 5000 }, (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} exited with code ${error.code ?? 'unknown'}. ${stderr.trim()}`));
          return;
        }
        resolve();
      });
    });
  }

  private getInstallHint(): string {
    switch (this.platform) {
      case 'linux':
        return `
[ACTION REQUIRED] Missing Linux Keystroke Tools!
Since you are on Linux, you need to install a utility to simulate keystrokes.
  - If using Fedora (Wayland): Run \`sudo dnf install wtype\`
  - If using Ubuntu/Debian:    Run \`sudo apt install wtype xdotool\`
  - General X11 Fallback:      Run \`sudo dnf install xdotool\`
`;
      case 'darwin':
        return '\n[ACTION REQUIRED] Grant Accessibility permission to your terminal in System Preferences → Privacy & Security → Accessibility';
      default:
        return '';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
