import { execFile } from 'child_process';
import os from 'os';
import clipboard from 'clipboardy';

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

  public async paste(): Promise<boolean> {
    await this.sleep(150);

    try {
      await this.simulateKeystroke();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n[PasteSimulator Error] Failed to simulate paste:\n  -> ${message}`);
      
      const hint = this.getInstallHint();
      if (hint) {
        console.log(`\x1b[33m${hint}\x1b[0m`);
      }
      return false;
    }
  }

  public async typeText(text: string): Promise<boolean> {
    await this.sleep(150);

    try {
      await this.simulateTyping(text);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n[PasteSimulator Error] Failed to simulate typing:\n  -> ${message}`);
      return false;
    }
  }

  public async setFocusedText(text: string): Promise<boolean> {
    await this.sleep(150);

    try {
      await this.setFocusedTextControl(text);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // If UIA couldn't find ValuePattern, fall back to clipboard + Ctrl+V
      if (message.includes('UIA_VALUEPAT_NOTFOUND') || message.includes('UIAutomation_End_Fallback')) {
        console.log(`[PasteSimulator] App does not expose ValuePattern via UIA. Falling back to native system Paste (Ctrl+V)...`);
        try {
          const oldClip = await clipboard.read().catch(() => '');
          await clipboard.write(text);
          await this.simulateKeystroke();
          await this.sleep(100);
          if (oldClip) await clipboard.write(oldClip);
          return true;
        } catch (pasteErr) {
          console.error(`[PasteSimulator] Fallback paste failed:`, pasteErr);
        }
      }
      console.error(`\n[PasteSimulator Error] Failed to set focused text:\n  -> ${message}`);
      return false;
    }
  }

  public async insertFocusedText(text: string): Promise<boolean> {
    await this.sleep(150);

    try {
      await this.insertFocusedTextControl(text);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n[PasteSimulator Error] Failed to insert focused text:\n  -> ${message}`);
      
      // Provide helpful context based on error type
      if (message.includes('UIAutomation_End_Fallback')) {
        console.log('[PasteSimulator] This is expected for Chromium/Electron apps or when caret detection fails.');
      }
      
      return false;
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
      const charCount = text.length;
      const lineCount = (text.match(/\n/g) || []).length + 1;
      const estimatedSeconds = Math.ceil(charCount * 0.02); // ~20ms per char
      
      if (charCount > 100) {
        console.log(`[PasteSimulator] Typing ${charCount} characters (${lineCount} lines), estimated ${estimatedSeconds}s...`);
      }
      
      return this.runWindowsSendInputText(text);
    }

    return Promise.reject(new Error(`Unsupported platform: ${this.platform}`));
  }

  private setFocusedTextControl(text: string): Promise<void> {
    if (this.platform === 'win32') {
      return this.runWindowsUIAutomationSetText(text);
    }

    return Promise.reject(new Error(`Focused text setting is currently implemented only on Windows UI Automation.`));
  }

  private async insertFocusedTextControl(text: string): Promise<void> {
    if (this.platform === 'win32') {
      try {
        await this.runWindowsUIAutomationInsertText(text);
      } catch (err) {
        const errorMsg = String(err);
        if (errorMsg.includes('UIAutomation_End_Fallback')) {
          console.log(`[PasteSimulator] UIA insertion not available or unreliable.`);
          console.log(`[PasteSimulator] Attempting character-by-character typing (Monaco/CodeMirror compatible)...`);
          
          try {
            // For browser-based editors (Monaco, CodeMirror), character-by-character typing
            // is the ONLY reliable method because:
            // 1. Paste events get intercepted by JavaScript
            // 2. Synthetic Ctrl+V is not trusted by editor frameworks
            // 3. Character events bypass paste handlers and go directly to editor model
            await this.simulateTyping(text);
            console.log('[PasteSimulator] Character-by-character typing completed successfully.');
          } catch (typeErr) {
            console.error(`[PasteSimulator] Character typing failed:`, typeErr);
            
            // Final fallback: try clipboard paste anyway (may work in some apps)
            console.log(`[PasteSimulator] Falling back to clipboard paste as last resort...`);
            try {
              const oldClip = await clipboard.read().catch(() => '');
              await clipboard.write(text);
              await this.sleep(50);
              await this.simulateKeystroke();
              await this.sleep(100);
              if (oldClip) await clipboard.write(oldClip);
              console.log('[PasteSimulator] Clipboard fallback completed.');
            } catch (pasteErr) {
              console.error(`[PasteSimulator] All insertion methods failed:`, pasteErr);
              throw pasteErr;
            }
          }
          
          return;
        }
        throw err;
      }
      return;
    }

    return Promise.reject(new Error(`Focused text insertion is currently implemented only on Windows UI Automation.`));
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

  private runCommand(
    command: string,
    args: string[],
    timeout: number,
    env?: NodeJS.ProcessEnv,
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout, env: env ? { ...process.env, ...env } : process.env }, (error, _stdout, stderr) => {
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
    // Calculate timeout based on text length
    // ~20ms per character + 2s buffer
    const estimatedMs = text.length * 20 + 2000;
    const timeout = Math.max(10000, Math.min(estimatedMs, 300000)); // 10s min, 5min max
    
    return this.runCommand(
      'powershell',
      [
        '-WindowStyle', 'Hidden',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        this.encodePowerShellCommand(this.getWindowsSendInputScript('TypeText')),
      ],
      timeout,
      { CLIPSYNC_REMOTE_TEXT: text },
    )
      .then(() => undefined)
      .catch(() => this.runWindowsSendKeysText(text));
  }

  private runWindowsSendInputPaste(): Promise<void> {
    return this.runCommand(
      'powershell',
      [
        '-WindowStyle', 'Hidden',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        this.encodePowerShellCommand(this.getWindowsSendInputScript('Paste')),
      ],
      5000,
    )
      .then(() => undefined)
      .catch(() => this.runWindowsSendKeysPaste());
  }

  private runWindowsSendKeysText(text: string): Promise<void> {
    // SendKeys syntax requires escaping these characters: + ^ % ~ ( ) [ ] { }
    const escaped = text.replace(/([+^%~()[\]{}])/g, '{$1}');

    const psCommand = `
      Add-Type -AssemblyName System.Windows.Forms;
      Start-Sleep -Milliseconds 150;
      $text = [Environment]::GetEnvironmentVariable('CLIPSYNC_REMOTE_TEXT', 'Process');

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

    return this.runCommand(
      'powershell',
      [
        '-WindowStyle', 'Hidden',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        this.encodePowerShellCommand(psCommand),
      ],
      60000,
      { CLIPSYNC_REMOTE_TEXT: escaped },
    ).then(() => undefined).catch(result => {
      throw new Error(`Windows typing failed. SendInput and SendKeys both failed: ${result.stderr}`);
    });
  }

  private runWindowsSendKeysPaste(): Promise<void> {
    return this.runCommand(
      'powershell',
      [
        '-WindowStyle', 'Hidden',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        this.encodePowerShellCommand('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")')
      ],
      5000,
    ).then(() => undefined).catch(result => {
      throw new Error(`Windows paste failed. SendInput and SendKeys both failed: ${result.stderr}`);
    });
  }

  private runWindowsUIAutomationSetText(text: string): Promise<void> {
    return this.runCommand(
      'powershell',
      [
        '-WindowStyle', 'Hidden',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        this.encodePowerShellCommand(this.getWindowsUIAutomationSetTextScript()),
      ],
      10000,
      { CLIPSYNC_REMOTE_TEXT: text },
    ).then(() => undefined).catch(result => {
      throw new Error(`Windows UI Automation SetValue failed: ${result.stderr}`);
    });
  }

  private runWindowsUIAutomationInsertText(text: string): Promise<void> {
    return this.runCommand(
      'powershell',
      [
        '-WindowStyle', 'Hidden',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        this.encodePowerShellCommand(this.getWindowsUIAutomationInsertTextScript()),
      ],
      10000,
      { CLIPSYNC_REMOTE_TEXT: text },
    ).then(() => undefined).catch(result => {
      throw new Error(`Windows UI Automation caret insert failed: ${result.stderr}`);
    });
  }

  private getWindowsSendInputScript(mode: 'TypeText' | 'Paste'): string {
    const invocation = mode === 'TypeText'
      ? `[NativeInput]::TypeText([Environment]::GetEnvironmentVariable("CLIPSYNC_REMOTE_TEXT", "Process"))`
      : '[NativeInput]::Paste()';

    return `
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
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct HARDWAREINPUT {
    public uint uMsg;
    public ushort wParamL;
    public ushort wParamH;
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
    
    // For Monaco/CodeMirror editors, we need human-like timing
    // Too fast = editor may batch/drop events
    // Too slow = user frustration
    // Sweet spot: 15-25ms per character with slight randomization
    Random rnd = new Random();
    
    foreach (char ch in text) {
      // Handle newlines specially - they need to be Enter key, not literal \\n
      if (ch == '\\n') {
        ushort enterScan = (ushort)MapVirtualKeyEx(0x0D, MAPVK_VK_TO_VSC, layout);
        TapScan(enterScan, false);
        Thread.Sleep(rnd.Next(30, 50)); // Slightly longer delay after newline
        continue;
      }
      
      // Handle carriage return (skip it, we already handled \\n)
      if (ch == '\\r') {
        continue;
      }
      
      // Handle tab specially
      if (ch == '\\t') {
        ushort tabScan = (ushort)MapVirtualKeyEx(0x09, MAPVK_VK_TO_VSC, layout);
        TapScan(tabScan, false);
        Thread.Sleep(rnd.Next(20, 35));
        continue;
      }
      
      short packed = VkKeyScanEx(ch, layout);
      if (packed == -1) {
        // Character not in keyboard layout - use Unicode input
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
      
      // Human-like timing with randomization to avoid detection/batching
      Thread.Sleep(rnd.Next(15, 25));
    }
  }
}
'@
Start-Sleep -Milliseconds 150
${invocation}
    `;
  }

  private getWindowsUIAutomationSetTextScript(): string {
    return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$text = [Environment]::GetEnvironmentVariable('CLIPSYNC_REMOTE_TEXT', 'Process')

function Try-SetAutomationValue($element, $value) {
  if ($null -eq $element) { return $false }
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    $vp = [System.Windows.Automation.ValuePattern]$pattern
    if ($vp.Current.IsReadOnly) { throw "Focused control is read-only." }
    $vp.SetValue($value)
    return $true
  }

  $legacyPattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {
    ([System.Windows.Automation.LegacyIAccessiblePattern]$legacyPattern).SetValue($value)
    return $true
  }
  return $false
}

$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) { throw "No focused UI Automation element found." }

$current = $focused
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
for ($i = 0; $i -lt 6 -and $null -ne $current; $i++) {
  if (Try-SetAutomationValue $current $text) { exit 0 }
  $current = $walker.GetParent($current)
}

throw "UIAutomation_End_Fallback"
    `;
  }

  private getWindowsUIAutomationInsertTextScript(): string {
    return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;

public struct NativePoint {
  public int X;
  public int Y;
}

public static class NativeCaret {
  [StructLayout(LayoutKind.Sequential)]
  struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  struct GUITHREADINFO {
    public int cbSize, flags;
    public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
    public RECT rcCaret;
  }

  const uint EM_GETSEL        = 0x00B0;
  const uint WM_GETTEXTLENGTH = 0x000E;
  const uint WM_GETTEXT       = 0x000D;

  [DllImport("user32.dll")] static extern bool    GetGUIThreadInfo(uint id, ref GUITHREADINFO i);
  [DllImport("user32.dll")] static extern bool    ClientToScreen(IntPtr hWnd, ref NativePoint p);
  [DllImport("user32.dll")] static extern uint    GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr  SendMessage(IntPtr hWnd, uint msg, IntPtr wP, IntPtr lP);
  [DllImport("user32.dll")] static extern IntPtr  SendMessage(IntPtr hWnd, uint msg, IntPtr wP, StringBuilder lP);
  [DllImport("user32.dll")] static extern int     GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  // Try EM_GETSEL to get caret offset — works for any Win32 EDIT or RichEdit control.
  public static bool TryEmGetSel(IntPtr hwnd, out int selStart, out int selEnd) {
    selStart = selEnd = -1;
    if (hwnd == IntPtr.Zero) return false;
    IntPtr r = SendMessage(hwnd, EM_GETSEL, IntPtr.Zero, IntPtr.Zero);
    long v = r.ToInt64();
    selStart = (int)(v & 0xFFFF);
    selEnd   = (int)((v >> 16) & 0xFFFF);
    return selStart >= 0 && selEnd >= selStart;
  }

  // Read control text via WM_GETTEXT — works for standard EDIT/RichEdit.
  public static bool TryWmGetText(IntPtr hwnd, out string text) {
    text = "";
    if (hwnd == IntPtr.Zero) return false;
    int len = (int)SendMessage(hwnd, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero);
    if (len < 0) return false;
    if (len == 0) return true;  // empty string is valid
    var sb = new StringBuilder(len + 2);
    SendMessage(hwnd, WM_GETTEXT, new IntPtr(len + 1), sb);
    text = sb.ToString();
    return true;
  }

  // Try GetGUIThreadInfo using the element's own HWND thread (more accurate than foreground window).
  public static bool TryGetCaretPoint(IntPtr elementHwnd, out NativePoint point) {
    point = new NativePoint();
    if (elementHwnd == IntPtr.Zero) return false;
    uint pid;
    uint tid = GetWindowThreadProcessId(elementHwnd, out pid);
    if (tid == 0) return false;
    var info = new GUITHREADINFO();
    info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(tid, ref info) || info.hwndCaret == IntPtr.Zero) return false;
    point.X = info.rcCaret.Left + 1;
    point.Y = info.rcCaret.Top + Math.Max(0, (info.rcCaret.Bottom - info.rcCaret.Top) / 2);
    return ClientToScreen(info.hwndCaret, ref point);
  }

  // Get window class name
  public static string GetWindowClass(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return "";
    var sb = new StringBuilder(256);
    GetClassName(hwnd, sb, sb.Capacity);
    return sb.ToString();
  }

  // Check if process is Chromium/Electron-based
  public static bool IsChromiumBased(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return false;
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    try {
      var proc = Process.GetProcessById((int)pid);
      string name = proc.ProcessName.ToLowerInvariant();
      // Common Chromium/Electron process names
      return name.Contains("electron") || name.Contains("chrome") || 
             name.Contains("msedge") || name.Contains("brave") ||
             name.Contains("discord") || name.Contains("slack") ||
             name.Contains("vscode") || name.Contains("code");
    } catch {
      return false;
    }
  }
}
'@

$insertText = [Environment]::GetEnvironmentVariable('CLIPSYNC_REMOTE_TEXT', 'Process')

$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) { 
  Write-Host "[DEBUG] No focused UIA element found - falling back to clipboard paste"
  throw "UIAutomation_End_Fallback" 
}

$focusedHwnd = [System.IntPtr]::new([long]$focused.Current.NativeWindowHandle)
$windowClass = [NativeCaret]::GetWindowClass($focusedHwnd)
$isChromium = [NativeCaret]::IsChromiumBased($focusedHwnd)

Write-Host "[DEBUG] Window class: $windowClass, Chromium-based: $isChromium"

# ── Strategy 0: Chromium/Electron Detection → Immediate Clipboard Fallback ──────────────────
# Chromium apps (Electron, VS Code, Discord, web-based editors) have unreliable UIA TextPattern.
# The most reliable method is clipboard + Ctrl+V, which they handle natively.
if ($isChromium -or $windowClass -match "Chrome_RenderWidgetHostHWND|Intermediate D3D Window") {
  Write-Host "[DEBUG] Detected Chromium/Electron app - using clipboard fallback for maximum reliability"
  throw "UIAutomation_End_Fallback"
}

# ── Strategy 1: EM_GETSEL + WM_GETTEXT (fastest, works for any Win32 EDIT/RichEdit) ──────────
$emStart = -1; $emEnd = -1
if ([NativeCaret]::TryEmGetSel($focusedHwnd, [ref]$emStart, [ref]$emEnd)) {
  Write-Host "[DEBUG] EM_GETSEL succeeded: start=$emStart, end=$emEnd"
  $windowText = ""
  if ([NativeCaret]::TryWmGetText($focusedHwnd, [ref]$windowText)) {
    Write-Host "[DEBUG] WM_GETTEXT succeeded: length=$($windowText.Length)"
    $s = [Math]::Max(0, [Math]::Min($emStart, $windowText.Length))
    $e = [Math]::Max(0, [Math]::Min($emEnd,   $windowText.Length))
    if ($e -lt $s) { $tmp = $s; $s = $e; $e = $tmp }
    $newText = $windowText.Substring(0, $s) + $insertText + $windowText.Substring($e)

    $vpat = $null
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $cur = $focused
    for ($i = 0; $i -lt 6 -and $null -ne $cur; $i++) {
      if ($cur.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vpat)) {
        $vp = [System.Windows.Automation.ValuePattern]$vpat
        if (-not $vp.Current.IsReadOnly) { 
          Write-Host "[DEBUG] Setting value via ValuePattern (EM_GETSEL strategy)"
          $vp.SetValue($newText)
          exit 0 
        }
      }
      $cur = $walker.GetParent($cur)
    }
  }
}

# ── Strategy 2: UIA TextPattern + ValuePattern (works for WPF, some Electron) ────────────────
function Get-OffsetsFromRange($tp, $range) {
  $doc = $tp.DocumentRange; $before = $doc.Clone()
  $null = $before.MoveEndpointByRange(
    [System.Windows.Automation.TextPatternRangeEndpoint]::End, $range,
    [System.Windows.Automation.TextPatternRangeEndpoint]::Start)
  $sel = $range.GetText(-1)
  return @{ Start = $before.GetText(-1).Length; End = ($before.GetText(-1).Length + $sel.Length) }
}

function Try-GetCaret($element, $valueLen) {
  $tpat = $null
  if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tpat)) { 
    return $null 
  }
  $tp = [System.Windows.Automation.TextPattern]$tpat

  # Try GetGUIThreadInfo + RangeFromPoint
  $cp = New-Object NativePoint
  if ([NativeCaret]::TryGetCaretPoint($focusedHwnd, [ref]$cp)) {
    try {
      $pt = New-Object System.Windows.Point([double]$cp.X, [double]$cp.Y)
      $range = $tp.RangeFromPoint($pt)
      $off = Get-OffsetsFromRange $tp $range
      Write-Host "[DEBUG] RangeFromPoint succeeded: start=$($off.Start), end=$($off.End), valueLen=$valueLen"
      
      # Validate: caret should not be beyond text length
      if ($off.Start -le $valueLen -and $off.End -le $valueLen) {
        return $off
      } else {
        Write-Host "[DEBUG] RangeFromPoint returned invalid offset (beyond text length) - rejecting"
      }
    } catch {
      Write-Host "[DEBUG] RangeFromPoint failed: $_"
    }
  }

  # Try GetSelection
  try {
    $ranges = $tp.GetSelection()
    if ($ranges -and $ranges.Length -gt 0) {
      $off = Get-OffsetsFromRange $tp $ranges[0]
      Write-Host "[DEBUG] GetSelection succeeded: start=$($off.Start), end=$($off.End), valueLen=$valueLen"
      
      # Validate: selection should be within text bounds
      if ($off.Start -le $valueLen -and $off.End -le $valueLen) {
        # Additional validation: if offset is at the very end and text is non-empty,
        # this might be a false positive (common in virtualized editors)
        if ($off.Start -eq $valueLen -and $valueLen -gt 0) {
          Write-Host "[DEBUG] GetSelection returned end-of-document - likely unreliable, rejecting"
          return $null
        }
        return $off
      } else {
        Write-Host "[DEBUG] GetSelection returned invalid offset (beyond text length) - rejecting"
      }
    }
  } catch {
    Write-Host "[DEBUG] GetSelection failed: $_"
  }
  
  return $null
}

$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$current = $focused
for ($i = 0; $i -lt 6 -and $null -ne $current; $i++) {
  $vpat2 = $null
  $legacyPat = $null
  $isLegacy = $false
  $val = ""

  if ($current.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vpat2)) {
    $vp2 = [System.Windows.Automation.ValuePattern]$vpat2
    if (-not $vp2.Current.IsReadOnly) {
      $val = [string]$vp2.Current.Value
    } else { $vpat2 = $null }
  } elseif ($current.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPat)) {
    $isLegacy = $true
    $val = [string]([System.Windows.Automation.LegacyIAccessiblePattern]$legacyPat).Current.Value
  }

  if (($null -ne $vpat2) -or ($isLegacy)) {
    Write-Host "[DEBUG] Found ValuePattern/LegacyIAccessible at level $i, value length: $($val.Length)"
    
    $off = Try-GetCaret $focused $val.Length
    if ($null -eq $off -and $current -ne $focused) { 
      $off = Try-GetCaret $current $val.Length 
    }
    
    # CRITICAL CHANGE: Do NOT silently fall back to end-of-document
    # If caret detection failed, throw fallback error to trigger clipboard paste
    if ($null -eq $off) {
      Write-Host "[DEBUG] Caret detection failed completely - falling back to clipboard paste"
      throw "UIAutomation_End_Fallback"
    }

    # Apply insertion
    $s = [Math]::Max(0, [Math]::Min([int]$off.Start, $val.Length))
    $e = [Math]::Max(0, [Math]::Min([int]$off.End,   $val.Length))
    if ($e -lt $s) { $tmp = $s; $s = $e; $e = $tmp }
    
    Write-Host "[DEBUG] Inserting at offset: start=$s, end=$e"
    $newVal = $val.Substring(0, $s) + $insertText + $val.Substring($e)
    
    if ($isLegacy) {
      Write-Host "[DEBUG] Setting value via LegacyIAccessiblePattern"
      ([System.Windows.Automation.LegacyIAccessiblePattern]$legacyPat).SetValue($newVal)
    } else {
      Write-Host "[DEBUG] Setting value via ValuePattern"
      $vp2.SetValue($newVal)
    }
    exit 0
  }
  $current = $walker.GetParent($current)
}

Write-Host "[DEBUG] No suitable ValuePattern found - falling back to clipboard paste"
throw "UIAutomation_End_Fallback"
    `;
  }

  private encodePowerShellCommand(script: string): string {
    return Buffer.from(script, 'utf16le').toString('base64');
  }
}
