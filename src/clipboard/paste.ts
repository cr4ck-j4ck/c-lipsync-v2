import { execFile } from 'child_process';
import os from 'os';

type CommandResult = {
  command: string;
  stderr: string;
};

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
    if (this.platform === 'linux') {
      return this.tryCommands([
        // ydotool writes through Linux uinput, so apps see a virtual keyboard device.
        { command: 'ydotool', args: ['type', '--delay', '25', text], timeout: 30000 },
        { command: 'wtype', args: ['-d', '25', text], timeout: 30000 },
        { command: 'xdotool', args: ['type', '--delay', '25', '--clearmodifiers', text], timeout: 30000 },
      ], `Linux typing simulation requires 'ydotool' for HID-like typing, or 'wtype'/'xdotool' as desktop fallbacks.`);
    }

    if (this.platform === 'darwin') {
      const script = `
        on run argv
          set theText to item 1 of argv
          tell application "System Events"
            repeat with i from 1 to count characters of theText
              keystroke (character i of theText)
              delay 0.02
            end repeat
          end tell
        end run
      `;

      return this.runCommand('osascript', ['-e', script, text], 60000)
        .then(() => undefined)
        .catch(result => {
          throw new Error(`osascript failed: ${result.stderr}`);
        });
    }

    if (this.platform === 'win32') {
      return this.runWindowsSendInputText(text);
    }

    return Promise.reject(new Error(`Unsupported platform: ${this.platform}`));
  }

  private simulateKeystroke(): Promise<void> {
    if (this.platform === 'linux') {
      return this.tryCommands([
        // Linux input-event codes: KEY_LEFTCTRL=29, KEY_V=47.
        { command: 'ydotool', args: ['key', '29:1', '47:1', '47:0', '29:0'], timeout: 3000 },
        { command: 'wtype', args: ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl'], timeout: 3000 },
        { command: 'xdotool', args: ['key', '--clearmodifiers', 'ctrl+v'], timeout: 3000 },
      ], `Linux paste simulation requires 'ydotool', 'wtype', or 'xdotool'.`);
    }

    if (this.platform === 'darwin') {
      return this.runCommand('osascript', [
        '-e',
        'tell application "System Events" to keystroke "v" using command down',
      ], 5000).then(() => undefined);
    }

    if (this.platform === 'win32') {
      return this.runWindowsSendInputPaste();
    }

    return Promise.reject(new Error(`Unsupported platform: ${this.platform}`));
  }

  private getInstallHint(): string {
    switch (this.platform) {
      case 'linux':
        return `
[ACTION REQUIRED] Missing Linux Keystroke Tools!
Since you are on Linux, you need to install a utility to simulate keystrokes.
  - Best compatibility:          Install \`ydotool\` and enable its daemon/service for uinput-backed virtual keyboard events
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

  private async tryCommands(
    commands: Array<{ command: string; args: string[]; timeout: number }>,
    fallbackMessage: string,
  ): Promise<void> {
    const failures: CommandResult[] = [];

    for (const candidate of commands) {
      try {
        await this.runCommand(candidate.command, candidate.args, candidate.timeout);
        return;
      } catch (err) {
        failures.push(err as CommandResult);
      }
    }

    const details = failures
      .map(failure => `${failure.command}: ${failure.stderr || 'not available or failed'}`)
      .join(' | ');
    throw new Error(`${fallbackMessage} ${details}`);
  }

  private runCommand(command: string, args: string[], timeout: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout }, (error, _stdout, stderr) => {
        const result = { command, stderr: stderr.trim() };
        if (error) {
          reject(result);
          return;
        }
        resolve(result);
      });
    });
  }

  private runWindowsSendInputText(text: string): Promise<void> {
    return this.runCommand(
      'powershell',
      [
        '-WindowStyle', 'Hidden',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        this.getWindowsSendInputScript('TypeText'),
        text,
      ],
      60000,
    ).then(() => undefined).catch(result => {
      throw new Error(`Windows SendInput failed: ${result.stderr}`);
    });
  }

  private runWindowsSendInputPaste(): Promise<void> {
    return this.runCommand(
      'powershell',
      [
        '-WindowStyle', 'Hidden',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        this.getWindowsSendInputScript('Paste'),
      ],
      5000,
    ).then(() => undefined).catch(result => {
      throw new Error(`Windows SendInput paste failed: ${result.stderr}`);
    });
  }

  private getWindowsSendInputScript(mode: 'TypeText' | 'Paste'): string {
    return `
param([string]$Text)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class NativeInput {
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("user32.dll")]
  static extern short VkKeyScanEx(char ch, IntPtr dwhkl);

  [DllImport("user32.dll")]
  static extern uint MapVirtualKeyEx(uint uCode, uint uMapType, IntPtr dwhkl);

  [DllImport("user32.dll")]
  static extern IntPtr GetKeyboardLayout(uint idThread);

  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;
  const uint KEYEVENTF_SCANCODE = 0x0008;
  const uint MAPVK_VK_TO_VSC = 0;

  static void Send(INPUT input) {
    uint sent = SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
    if (sent != 1) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
  }

  static INPUT ScanInput(ushort scan, bool up, bool extended) {
    INPUT input = new INPUT();
    input.type = INPUT_KEYBOARD;
    input.U.ki.wScan = scan;
    input.U.ki.dwFlags = KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0);
    return input;
  }

  static INPUT UnicodeInput(char ch, bool up) {
    INPUT input = new INPUT();
    input.type = INPUT_KEYBOARD;
    input.U.ki.wScan = ch;
    input.U.ki.dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0);
    return input;
  }

  static void TapScan(ushort scan, bool extended) {
    Send(ScanInput(scan, false, extended));
    Send(ScanInput(scan, true, extended));
  }

  static void SetModifier(ushort vk, bool down, IntPtr layout) {
    ushort scan = (ushort)MapVirtualKeyEx(vk, MAPVK_VK_TO_VSC, layout);
    Send(ScanInput(scan, !down, false));
  }

  public static void Paste() {
    IntPtr layout = GetKeyboardLayout(0);
    SetModifier(0x11, true, layout);
    TapScan((ushort)MapVirtualKeyEx(0x56, MAPVK_VK_TO_VSC, layout), false);
    SetModifier(0x11, false, layout);
  }

  public static void TypeText(string text) {
    IntPtr layout = GetKeyboardLayout(0);
    foreach (char ch in text) {
      short packed = VkKeyScanEx(ch, layout);
      if (packed == -1) {
        Send(UnicodeInput(ch, false));
        Send(UnicodeInput(ch, true));
      } else {
        ushort vk = (ushort)(packed & 0xff);
        byte shiftState = (byte)((packed >> 8) & 0xff);
        bool shift = (shiftState & 1) != 0;
        bool ctrl = (shiftState & 2) != 0;
        bool alt = (shiftState & 4) != 0;
        ushort scan = (ushort)MapVirtualKeyEx(vk, MAPVK_VK_TO_VSC, layout);

        if (shift) SetModifier(0x10, true, layout);
        if (ctrl) SetModifier(0x11, true, layout);
        if (alt) SetModifier(0x12, true, layout);
        TapScan(scan, false);
        if (alt) SetModifier(0x12, false, layout);
        if (ctrl) SetModifier(0x11, false, layout);
        if (shift) SetModifier(0x10, false, layout);
      }
      Thread.Sleep(20);
    }
  }
}
'@
Start-Sleep -Milliseconds 150
[NativeInput]::${mode}($Text)
`;
  }
}
