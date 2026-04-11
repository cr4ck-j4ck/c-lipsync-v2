import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

/**
 * Handles capturing images from the system desktop and injecting
 * Base64 image payloads into system clipboards using native OS binaries.
 */
export class ImageManager {
  private readonly platform: NodeJS.Platform;

  constructor() {
    this.platform = os.platform();
  }

  /**
   * Captures the screen to a temporary file, reads it as Base64, and deletes the file.
   * Returns empty string if failed.
   */
  public async captureScreen(): Promise<string> {
    const tempUuid = Math.random().toString(36).substring(2, 10);
    const tempPath = path.join(os.tmpdir(), `screenshot-${tempUuid}.png`);
    
    try {
      if (this.platform === 'win32') {
        const psCommand = `
          Add-Type -AssemblyName System.Windows.Forms;
          Add-Type -AssemblyName System.Drawing;
          $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
          $bmp = New-Object System.Drawing.Bitmap $bounds.width, $bounds.height;
          $graphics = [System.Drawing.Graphics]::FromImage($bmp);
          $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.size);
          $bmp.Save('${tempPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);
          $graphics.Dispose();
          $bmp.Dispose();
        `;
        await this.runCmd('powershell', ['-WindowStyle', 'Hidden', '-NoProfile', '-Command', psCommand]);
      } else if (this.platform === 'darwin') {
        await this.runCmd('screencapture', ['-x', tempPath]);
      } else if (this.platform === 'linux') {
        // Try grim (Wayland), then fallback to scrot or gnome-screenshot
        try {
          await this.runCmd('grim', [tempPath]);
        } catch {
          try {
             await this.runCmd('scrot', [tempPath]);
          } catch {
             await this.runCmd('gnome-screenshot', ['-f', tempPath]);
          }
        }
      }

      // Read file and encode 
      const buffer = await fs.readFile(tempPath);
      const base64 = buffer.toString('base64');
      
      // Cleanup
      await fs.unlink(tempPath).catch(() => {});
      return base64;
    } catch (err) {
       console.error(`[ImageManager] Failed to capture screen: ${err}`);
       await fs.unlink(tempPath).catch(() => {});
       return '';
    }
  }

  /**
   * Writes a Base64 encoded image directly to the System Clipboard
   */
  public async writeClipboard(base64: string): Promise<boolean> {
    const tempUuid = Math.random().toString(36).substring(2, 10);
    const tempPath = path.join(os.tmpdir(), `clipped-${tempUuid}.png`);

    try {
      const buffer = Buffer.from(base64, 'base64');
      await fs.writeFile(tempPath, buffer);

      if (this.platform === 'win32') {
        const psCommand = `
          Add-Type -AssemblyName System.Windows.Forms;
          Add-Type -AssemblyName System.Drawing;
          $img = [System.Drawing.Image]::FromFile('${tempPath.replace(/\\/g, '\\\\')}');
          [System.Windows.Forms.Clipboard]::SetImage($img);
          $img.Dispose();
        `;
        await this.runCmd('powershell', ['-WindowStyle', 'Hidden', '-NoProfile', '-Command', psCommand]);
      } else if (this.platform === 'darwin') {
        const script = `set the clipboard to (read (POSIX file "${tempPath}") as «class PNGf»)`;
        await this.runCmd('osascript', ['-e', script]);
      } else if (this.platform === 'linux') {
        try {
           await this.runCmd('wl-copy', ['-t', 'image/png'], buffer);
        } catch {
           await this.runCmd('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', tempPath]);
        }
      }

      await fs.unlink(tempPath).catch(() => {});
      return true;
    } catch (err) {
      console.error(`[ImageManager] Failed to write clipboard: ${err}`);
      await fs.unlink(tempPath).catch(() => {});
      return false;
    }
  }

  private runCmd(cmd: string, args: string[], stdin?: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, args, { timeout: 60000 }, (error, _stdout, stderr) => {
        if (error) reject(new Error(`${cmd} failed: ${stderr.trim()} / ${error.message}`));
        else resolve();
      });
      if (stdin && child.stdin) {
         child.stdin.write(stdin);
         child.stdin.end();
      }
    });
  }
}
