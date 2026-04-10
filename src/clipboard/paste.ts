import { execFile } from 'child_process';
import os from 'os';

/**
 * Simulates an OS-level paste (Ctrl+V / Cmd+V) at the currently focused window.
 * Now also supports raw keystroke typing with human-emulated delays.
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
        execFile('wtype', ['-d', '25', text], { timeout: 30000 }, (err) => {
          if (!err) return resolve();
          
          execFile('xdotool', ['type', '--delay', '25', '--clearmodifiers', text], { timeout: 30000 }, (err2) => {
            if (!err2) return resolve();
            reject(new Error(`Linux typing simulation requires either 'wtype' (Wayland) or 'xdotool' (X11).`));
          });
        });
        return;
      }

      if (this.platform === 'darwin') {
        const escaped = text.replace(/"/g, '\\"');
        const script = `
          tell application "System Events"
            set theText to "${escaped}"
            repeat with i from 1 to count characters of theText
              keystroke (character i of theText)
              delay 0.02
            end repeat
          end tell
        `;
        execFile('osascript', ['-e', script], { timeout: 60000 }, (error, _stdout, stderr) => {
            if (error) reject(new Error(`osascript failed: ${stderr.trim()}`));
            else resolve();
        });
        return;
      }

      if (this.platform === 'win32') {
        // Powershell SendKeys syntax requires escaping these characters: + ^ % ~ ( ) [ ] { }
        const escaped = text.replace(/([+^%~()[\]{}])/g, '{$1}');
        const psString = escaped.replace(/'/g, "''");
        
        // This PowerShell script types each character one by one with a 20ms human-like delay, 
        // completely bypassing bot-detection speed limits.
        const psCommand = `
          Add-Type -AssemblyName System.Windows.Forms;
          Start-Sleep -Milliseconds 200;
          $text = '${psString}';
          
          # Iterate over each block of character vs {} escaped string
          $i = 0;
          while ($i -lt $text.Length) {
              if ($text[$i] -eq '{' -and $i+2 -lt $text.Length -and $text[$i+2] -eq '}') {
                 [System.Windows.Forms.SendKeys]::SendWait($text.Substring($i, 3));
                 $i += 3;
              } else {
                 [System.Windows.Forms.SendKeys]::SendWait($text[$i]);
                 $i++;
              }
              Start-Sleep -Milliseconds 20;
          }
        `;
        
        execFile(
          'powershell',
          [
            '-WindowStyle', 'Hidden', // Prevent powershell from stealing focus
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            psCommand
          ],
          { timeout: 60000 },
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
          '-WindowStyle', 'Hidden',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")'
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
