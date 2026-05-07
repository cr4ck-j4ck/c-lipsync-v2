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

  private insertFocusedTextControl(text: string): Promise<void> {
    if (this.platform === 'win32') {
      return this.runWindowsUIAutomationInsertText(text);
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
  if ($null -eq $element) {
    return $false
  }

  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    $valuePattern = [System.Windows.Automation.ValuePattern]$pattern
    if ($valuePattern.Current.IsReadOnly) {
      throw "Focused control exposes ValuePattern but is read-only."
    }
    $valuePattern.SetValue($value)
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
if ($null -eq $focused) {
  throw "No focused UI Automation element was found."
}

$current = $focused
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
for ($i = 0; $i -lt 6 -and $null -ne $current; $i++) {
  if (Try-SetAutomationValue $current $text) {
    exit 0
  }
  $current = $walker.GetParent($current)
}

throw "Focused element and nearby parents do not expose ValuePattern or LegacyIAccessiblePattern."
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

public struct NativePoint {
  public int X;
  public int Y;
}

public static class NativeCaret {
  [StructLayout(LayoutKind.Sequential)]
  struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct GUITHREADINFO {
    public int cbSize;
    public int flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }

  [DllImport("user32.dll")]
  static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);

  [DllImport("user32.dll")]
  static extern bool ClientToScreen(IntPtr hWnd, ref NativePoint point);

  [DllImport("user32.dll")]
  static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  public static bool TryGetCaretPoint(out NativePoint point) {
    point = new NativePoint();
    
    IntPtr fgHost = GetForegroundWindow();
    if (fgHost == IntPtr.Zero) {
      return false;
    }

    uint processId;
    uint threadId = GetWindowThreadProcessId(fgHost, out processId);
    if (threadId == 0) {
      return false;
    }

    GUITHREADINFO info = new GUITHREADINFO();
    info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));

    if (!GetGUIThreadInfo(threadId, ref info) || info.hwndCaret == IntPtr.Zero) {
      return false;
    }

    // Shift point slightly into the text to avoid boundary ArgumentExceptions
    point.X = info.rcCaret.Left + 1;
    point.Y = info.rcCaret.Top + Math.Max(0, (info.rcCaret.Bottom - info.rcCaret.Top) / 2);
    return ClientToScreen(info.hwndCaret, ref point);
  }
}
'@

$insertText = [Environment]::GetEnvironmentVariable('CLIPSYNC_REMOTE_TEXT', 'Process')

function Get-EditableValue($element) {
  if ($null -eq $element) {
    return $null
  }

  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    $valuePattern = [System.Windows.Automation.ValuePattern]$pattern
    if ($valuePattern.Current.IsReadOnly) {
      throw "Focused control exposes ValuePattern but is read-only."
    }
    return @{
      Kind = "ValuePattern"
      Pattern = $valuePattern
      Value = [string]$valuePattern.Current.Value
    }
  }

  $legacyPattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {
    $legacy = [System.Windows.Automation.LegacyIAccessiblePattern]$legacyPattern
    return @{
      Kind = "LegacyIAccessiblePattern"
      Pattern = $legacy
      Value = [string]$legacy.Current.Value
    }
  }

  return $null
}

function Set-EditableValue($editable, $value) {
  if ($editable.Kind -eq "ValuePattern") {
    ([System.Windows.Automation.ValuePattern]$editable.Pattern).SetValue($value)
    return
  }

  if ($editable.Kind -eq "LegacyIAccessiblePattern") {
    ([System.Windows.Automation.LegacyIAccessiblePattern]$editable.Pattern).SetValue($value)
    return
  }

  throw "Unsupported editable pattern."
}

function Get-OffsetsFromRange($textPattern, $range, $source) {
  $document = $textPattern.DocumentRange
  $before = $document.Clone()
  $null = $before.MoveEndpointByRange(
    [System.Windows.Automation.TextPatternRangeEndpoint]::End,
    $range,
    [System.Windows.Automation.TextPatternRangeEndpoint]::Start
  )

  $selectedText = $range.GetText(-1)
  $start = $before.GetText(-1).Length
  $end = $start + $selectedText.Length

  return @{
    Start = $start
    End = $end
    SelectedLength = $selectedText.Length
    Source = $source
  }
}

function Get-CaretOffsetsFromPoint($textPattern) {
  $caretPoint = New-Object NativePoint
  if (-not [NativeCaret]::TryGetCaretPoint([ref]$caretPoint)) {
    return $null
  }

  try {
    $screenPoint = New-Object System.Windows.Point([double]$caretPoint.X, [double]$caretPoint.Y)
    $range = $textPattern.RangeFromPoint($screenPoint)
    return Get-OffsetsFromRange $textPattern $range "SystemCaretPoint"
  } catch {
    return $null
  }
}

function Get-SelectionOffsets($element, $valueLength) {
  if ($null -eq $element) {
    return $null
  }

  $pattern = $null
  if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    return $null
  }

  $textPattern = [System.Windows.Automation.TextPattern]$pattern

  $caretOffsets = Get-CaretOffsetsFromPoint $textPattern
  if ($null -ne $caretOffsets) {
    return $caretOffsets
  }

  $ranges = $null
  try {
    $ranges = $textPattern.GetSelection()
  } catch {
    return $null
  }
  if ($null -eq $ranges -or $ranges.Length -lt 1) {
    return $null
  }

  $offsets = Get-OffsetsFromRange $textPattern $ranges[0] "TextPatternSelection"
  
  # Return offsets. We removed the "Refusing to append blindly" throw
  # because a) "at the end" is a completely valid cursor position, and 
  # b) if UIA falls back here, throwing an error makes .insertclip look broken.
  return $offsets
}

$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) {
  throw "No focused UI Automation element was found."
}

$current = $focused
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
for ($i = 0; $i -lt 6 -and $null -ne $current; $i++) {
  $editable = Get-EditableValue $current
  if ($null -ne $editable) {
    $value = [string]$editable.Value
    
    # TRUCIAL FIX: Check the FOCUSED child element for TextPattern first!
    # The parent container often lazy-reports "End" when you query its TextPattern.
    $selection = Get-SelectionOffsets $focused $value.Length
    
    # If the focused child doesn't have TextPattern, fallback to the parent wrapper
    if ($null -eq $selection -and $current -ne $focused) {
      $selection = Get-SelectionOffsets $current $value.Length
    }

    if ($null -eq $selection) {
      # Fallback to appending if we have absolutely no caret info.
      $start = $value.Length
      $end = $value.Length
    } else {
      $start = [Math]::Max(0, [Math]::Min([int]$selection.Start, $value.Length))
      $end = [Math]::Max(0, [Math]::Min([int]$selection.End, $value.Length))
    }
    if ($end -lt $start) {
      $tmp = $start
      $start = $end
      $end = $tmp
    }

    $newValue = $value.Substring(0, $start) + $insertText + $value.Substring($end)
    Set-EditableValue $editable $newValue
    exit 0
  }

  $current = $walker.GetParent($current)
}

throw "Focused element and nearby parents do not expose ValuePattern or LegacyIAccessiblePattern."
    `;
  }

  private encodePowerShellCommand(script: string): string {
    return Buffer.from(script, 'utf16le').toString('base64');
  }
}
