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
      console.error(`\n[PasteSimulator Error] All insert strategies failed:\n  -> ${message}`);
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
      // Tier 1 & 2 are handled inside the PowerShell script.
      // Exit code 0 = success (EM_REPLACESEL or UIA insert worked).
      // Exit code 10 = no native Edit and no UIA caret — need typing fallback.
      // Any other error = unexpected failure.
      try {
        await this.runWindowsUIAutomationInsertText(text);
        // Tier 1 or 2 succeeded
        return;
      } catch (err) {
        const msg = String(err);

        if (msg.includes('INSERT_NEEDS_TYPING_FALLBACK')) {
          // Tier 3: Type characters via SendInput — types at the real OS caret
          console.log('[PasteSimulator] UIA caret not available. Falling back to SendInput typing at active cursor...');
          try {
            await this.runWindowsSendInputText(text);
            console.log('[PasteSimulator] Text typed successfully via SendInput.');
            return;
          } catch {
            console.log('[PasteSimulator] SendInput typing failed. Falling back to clipboard paste...');
          }

          // Tier 4: Clipboard + Ctrl+V — last resort
          try {
            const oldClip = await clipboard.read().catch(() => '');
            await clipboard.write(text);
            await this.simulateKeystroke();
            await this.sleep(150);
            if (oldClip) await clipboard.write(oldClip);
            console.log('[PasteSimulator] Text pasted via clipboard Ctrl+V fallback.');
            return;
          } catch (pasteErr) {
            console.error('[PasteSimulator] All fallback strategies failed:', pasteErr);
          }
        }

        throw err;
      }
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
    return this.runCommand(
      'powershell',
      [
        '-WindowStyle', 'Hidden',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        this.encodePowerShellCommand(this.getWindowsSendInputScript('TypeText')),
      ],
      60000,
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

throw "UIA_VALUEPAT_NOTFOUND"
    `;
  }

  private getWindowsUIAutomationInsertTextScript(): string {
    return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeInsert {
  [StructLayout(LayoutKind.Sequential)]
  struct RECT { public int Left, Top, Right, Bottom; }

  // EM_REPLACESEL: tells any Win32 Edit/RichEdit control to replace the current
  // selection (or insert at caret if nothing selected) with the given text.
  // The OS handles all caret math internally — zero offset calculation needed.
  const uint EM_REPLACESEL     = 0x00C2;
  const uint EM_GETSEL         = 0x00B0;
  const uint WM_GETTEXTLENGTH  = 0x000E;

  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wP, string lP);

  [DllImport("user32.dll")]
  static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wP, IntPtr lP);

  // Tier 1: Use EM_REPLACESEL — perfect for Notepad, Win32 Edit, RichEdit.
  // Returns true if the control is a real Edit (responds to EM_GETSEL).
  public static bool TryEmReplaceSel(IntPtr hwnd, string text) {
    if (hwnd == IntPtr.Zero) return false;
    // Probe: is this a real Edit control? EM_GETSEL returns 0 for non-Edit HWNDs.
    int lenBefore = (int)SendMessage(hwnd, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero);
    IntPtr r = SendMessage(hwnd, EM_GETSEL, IntPtr.Zero, IntPtr.Zero);
    long v = r.ToInt64();
    int selStart = (int)(v & 0xFFFF);
    int selEnd   = (int)((v >> 16) & 0xFFFF);
    // If both are 0 and there IS text, it is likely not a real Edit control.
    if (selStart == 0 && selEnd == 0 && lenBefore > 0) return false;
    // Looks like a real Edit. Use EM_REPLACESEL with fCanUndo=TRUE (wParam=1).
    SendMessage(hwnd, EM_REPLACESEL, new IntPtr(1), text);
    // Verify the text length actually changed.
    int lenAfter = (int)SendMessage(hwnd, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero);
    return lenAfter != lenBefore || text.Length == 0;
  }
}
'@

$insertText = [Environment]::GetEnvironmentVariable('CLIPSYNC_REMOTE_TEXT', 'Process')
if ($null -eq $insertText) { $insertText = '' }

$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) { throw 'INSERT_NEEDS_TYPING_FALLBACK' }

$focusedHwnd = [System.IntPtr]::new([long]$focused.Current.NativeWindowHandle)

# ── Tier 1: EM_REPLACESEL (Notepad, Win32 Edit, RichEdit) ─────────────────────
# The OS handles caret positioning internally. No offset math needed.
if ($focusedHwnd -ne [System.IntPtr]::Zero) {
  if ([NativeInsert]::TryEmReplaceSel($focusedHwnd, $insertText)) {
    exit 0
  }
}

# ── Tier 2: UIA GetSelection + ValuePattern (WPF, UWP, some Chromium) ─────────
# Key fix: normalize BOTH the ValuePattern text AND the GetSelection offset to
# the same line-ending convention before doing substring math.
function Try-UiaInsert($element) {
  # Find ValuePattern on this element or a parent
  $vpat = $null
  $vpElement = $null
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $cur = $element
  for ($i = 0; $i -lt 6 -and $null -ne $cur; $i++) {
    if ($cur.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vpat)) {
      $vp = [System.Windows.Automation.ValuePattern]$vpat
      if (-not $vp.Current.IsReadOnly) { $vpElement = $cur; break }
    }
    $cur = $walker.GetParent($cur)
  }
  if ($null -eq $vpElement) { return $false }

  # Find TextPattern to get selection/caret
  $tpat = $null
  $tpElement = $null
  $cur = $element
  for ($i = 0; $i -lt 6 -and $null -ne $cur; $i++) {
    if ($cur.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tpat)) {
      $tpElement = $cur; break
    }
    $cur = $walker.GetParent($cur)
  }
  if ($null -eq $tpElement) { return $false }

  $tp = [System.Windows.Automation.TextPattern]$tpat

  # Get selection ranges
  try {
    $ranges = $tp.GetSelection()
    if ($null -eq $ranges -or $ranges.Length -eq 0) { return $false }
  } catch { return $false }

  $selRange = $ranges[0]

  # Get the text BEFORE the selection start by cloning DocumentRange and
  # moving its End endpoint to the selection Start.
  $doc = $tp.DocumentRange
  $beforeRange = $doc.Clone()
  $null = $beforeRange.MoveEndpointByRange(
    [System.Windows.Automation.TextPatternRangeEndpoint]::End,
    $selRange,
    [System.Windows.Automation.TextPatternRangeEndpoint]::Start)
  $beforeText = $beforeRange.GetText(-1)

  # Get the selected text
  $selText = $selRange.GetText(-1)

  # Get the full document text from TextPattern (NOT from ValuePattern)
  # to ensure line endings are consistent for offset calculation.
  $docText = $doc.GetText(-1)

  # Normalize all texts to LF so offset math is consistent
  $crlf = ([char]13).ToString() + ([char]10).ToString()
  $lf = ([char]10).ToString()
  $beforeNorm = $beforeText.Replace($crlf, $lf)
  $selNorm    = $selText.Replace($crlf, $lf)
  $docNorm    = $docText.Replace($crlf, $lf)

  $s = $beforeNorm.Length
  $e = $s + $selNorm.Length

  # Clamp to document bounds
  if ($s -gt $docNorm.Length) { $s = $docNorm.Length }
  if ($e -gt $docNorm.Length) { $e = $docNorm.Length }
  if ($e -lt $s) { $tmp = $s; $s = $e; $e = $tmp }

  # Build the new value from the normalized document text
  $newVal = $docNorm.Substring(0, $s) + $insertText + $docNorm.Substring($e)

  # Now get the ValuePattern value to check if IT uses CRLF.
  # If it does, convert our result to match.
  $vp = [System.Windows.Automation.ValuePattern]$vpat
  $vpVal = [string]$vp.Current.Value
  if ($vpVal.Contains($crlf)) {
    $newVal = $newVal.Replace($lf, $crlf)
  }

  $vp.SetValue($newVal)
  return $true
}

if (Try-UiaInsert $focused) { exit 0 }

# ── No UIA strategy worked — signal Node.js to use SendInput typing ───────────
throw 'INSERT_NEEDS_TYPING_FALLBACK'
    `;
  }

  private encodePowerShellCommand(script: string): string {
    return Buffer.from(script, 'utf16le').toString('base64');
  }
}
