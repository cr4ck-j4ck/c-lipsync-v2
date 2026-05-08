# C-Lipsync Usage Guide

C-Lipsync connects two computers on the same WiFi/LAN, syncs clipboard text, and can send remote paste/type/set/insert commands to the currently focused window on the receiver.

## Quick Start

Run the app on both computers:

```bash
pnpm start
```

Select the other device from the list. If one device cannot see the other, use `Manual connect by IP/port` and enter the IP/port printed by the other device.

After connection, focus the target input box on the receiving computer, then type commands in the sender terminal.

## Command Summary

| Command | Best use | Preserves indentation? |
| --- | --- | --- |
| `<text>` | Normal paste into regular apps | Only for one-line text |
| `.type <text>` | Apps that accept synthetic keyboard events | Only for one-line text |
| `.set <text>` | Replace the whole focused accessible input | Only for one-line text |
| `.insert <text>` | Insert at the caret in an accessible input | Only for one-line text |
| `.set` ... `.end` | Replace whole input with multiline text/code | Yes |
| `.insert` ... `.end` | Insert multiline text/code at the caret | Yes |
| `.setclip` | Replace whole input with your local clipboard | Yes |
| `.insertclip` | Insert your local clipboard at the caret | Yes |
| `.screenshot` | Copy receiver screenshot back to sender clipboard | Not applicable |
| `.quit` | Exit command mode | Not applicable |

## Recommended Ways To Paste Code

### Best For Adding Code: `.insertclip`

Use this when sending Python, JavaScript, or any code where indentation matters and you want to insert at the current cursor position.

1. Copy the formatted code on the sender computer.
2. Focus the target input box on the receiver computer.
3. Put the cursor where you want the code inserted.
4. Run:

```text
.insertclip
```

This reads the sender clipboard and inserts it into the focused text control on the receiver. Newlines, tabs, and spaces are preserved.

### Replace Everything: `.setclip`

Use this when you intentionally want to replace the entire focused input box.

```text
.setclip
```

This does not insert at the cursor. It replaces the whole field value.

### Multiline Manual Insert

Use `.insert` when you want to type or paste formatted text directly into the terminal and insert it at the receiver caret.

```text
.insert
import sys

def main():
    print("hello")

if __name__ == "__main__":
    main()
.end
```

Everything between `.insert` and `.end` is sent as one multiline payload. Use `.cancel` to abort.

### Multiline Manual Replace

Use `.set` only when you want to replace the whole receiver field.

```text
.set
full replacement text
.end
```

## What Each Input Method Does

### Default Paste: `<text>`

Typing a normal line without a dot command sends a remote paste:

```text
hello world
```

Receiver behavior:

1. Put `hello world` on the receiver clipboard.
2. Send Ctrl+V / Cmd+V to the focused receiver window.

Use this for normal apps that accept paste.

### Keyboard Injection: `.type <text>`

```text
.type hello world
```

Receiver behavior:

- Windows: native `SendInput` first, fallback to `SendKeys`
- Linux: `ydotool`, then `wtype`, then `xdotool`
- macOS: AppleScript `System Events`

This works in Notepad and many normal desktop apps. Some target apps reject it because it is software-generated input, not real HID keyboard input.

### Focused Text Replace: `.set <text>` / `.setclip`

```text
.set hello world
.setclip
```

On Windows, this uses UI Automation:

1. Get the currently focused UI Automation element.
2. Try `ValuePattern.SetValue`.
3. Try `LegacyIAccessiblePattern.SetValue`.
4. Walk a few parent controls and try again.

Because `SetValue` sets the whole value, `.set` and `.setclip` replace the full contents of the focused field.

### Focused Text Insert: `.insert <text>` / `.insertclip`

```text
.insert hello world
.insertclip
```

On Windows, this uses a 4-tier fallback hierarchy to insert at the caret:

1. **EM_REPLACESEL** — Send a native Win32 message that tells the Edit control to insert text at the current caret. The OS handles all caret math. Works perfectly in Notepad, RichEdit, and all standard Win32 text controls.
2. **UIA GetSelection + SetValue** — Use UI Automation `TextPattern.GetSelection()` to find the caret offset, then reconstruct the value with the text inserted at that offset. Line endings are normalized to prevent CRLF/LF offset mismatches. Works in WPF and some UWP/Chromium apps.
3. **SendInput typing** — Type each character via `SendInput` keystrokes at the real OS caret. Works in Electron apps (VS Code, Discord, Slack) and most other apps.
4. **Clipboard + Ctrl+V** — Last resort: set the clipboard and send Ctrl+V.

Use `.insertclip` when you want paste-like behavior but `.type` or normal paste is blocked.

## Troubleshooting

### `.setclip` Replaces Everything

That is expected. `.setclip` means "set the whole focused value." Use `.insertclip` to insert at the cursor.

### `.insertclip` Fallback Behavior

If `.insertclip` cannot insert via native Win32 Edit messages or UI Automation caret detection, it automatically falls back to typing the text via `SendInput` keystrokes. This ensures your text lands right at your actual cursor position. If keystroke typing is also rejected by the app, it will fall back to clipboard paste (Ctrl+V) as a last resort.

### Cannot Find The Cursor?

Some controls do not expose reliable caret information through any method. In that case:
- The app will automatically try typing the text via `SendInput` (like `.type`)
- If typing is also rejected, it uses clipboard paste (Ctrl+V)
- If the target app blocks both, use `.setclip` to replace the whole field

### `.set` Sends One Long Line

Use `.insertclip`, `.setclip`, multiline `.insert`, or multiline `.set` mode. One-line `.set <text>` cannot preserve line breaks because the terminal input itself is one line.

### Device Discovery Is One-Way

If Linux can see Windows but Windows cannot see Linux, or the reverse:

1. Run the app on both machines.
2. Read the `Local IPs` and `Listening for direct connections on port ...` from the receiver.
3. On the sender, choose `Manual connect by IP/port`.
4. Enter that IP and port.

On Windows, make sure the network is marked Private and firewall allows Node.js on private networks.

### Target App Runs As Administrator

If the target app is elevated, run the receiver terminal as Administrator and test again.

### Quick Help

Before launching:

```bash
pnpm start -- --help
```

Inside remote command mode:

```text
.help
```
