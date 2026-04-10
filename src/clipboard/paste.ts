import { execFile } from 'child_process';
import os from 'os';

/**
 * Simulates an OS-level paste (Ctrl+V / Cmd+V) at the currently focused window.
 *
 * Uses zero native dependencies — delegates to platform CLI tools:
 *   Linux:   xdotool key --clearmodifiers ctrl+v
 *   macOS:   osascript -e 'tell app "System Events" to keystroke "v" using command down'
 *   Windows: powershell Add-Type ... SendKeys("^v")
 */
export class PasteSimulator {
  private readonly platform: NodeJS.Platform;

  constructor() {
    this.platform = os.platform();
  }

  /**
   * Triggers a paste action at the currently focused input.
   * Resolves after the simulation completes or if an error is caught.
   * Never throws — errors are logged and swallowed to prevent crashes.
   */
  public async paste(): Promise<void> {
    // Small delay to let the clipboard write settle before simulating the keystroke
    await this.sleep(50);

    try {
      await this.simulateKeystroke();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[PasteSimulator] Failed to simulate paste: ${message}`);
    }
  }

  private simulateKeystroke(): Promise<void> {
    return new Promise((resolve, reject) => {
      let command: string;
      let args: string[];

      switch (this.platform) {
        case 'linux':
          command = 'xdotool';
          args = ['key', '--clearmodifiers', 'ctrl+v'];
          break;

        case 'darwin':
          command = 'osascript';
          args = [
            '-e',
            'tell application "System Events" to keystroke "v" using command down',
          ];
          break;

        case 'win32':
          command = 'powershell';
          args = [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
          ];
          break;

        default:
          reject(new Error(`Unsupported platform: ${this.platform}`));
          return;
      }

      execFile(command, args, { timeout: 5000 }, (error, _stdout, stderr) => {
        if (error) {
          // Exit code non-zero — typically means no focused window or missing tool
          const hint = this.getInstallHint();
          reject(
            new Error(
              `${command} exited with code ${error.code ?? 'unknown'}. ${stderr.trim()}${hint}`
            )
          );
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Returns a helpful install hint for the current platform's paste tool.
   */
  private getInstallHint(): string {
    switch (this.platform) {
      case 'linux':
        return '\nHint: Install xdotool — sudo apt install xdotool (Debian/Ubuntu) or sudo pacman -S xdotool (Arch)';
      case 'darwin':
        return '\nHint: Grant Accessibility permission to your terminal in System Preferences → Privacy & Security → Accessibility';
      default:
        return '';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
