# C-Lipsync Usage Guide

C-Lipsync connects two computers on the same WiFi/LAN, syncs clipboard text, and can send remote paste/type/set commands to the currently focused window on the receiver.

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
| `.set <text>` | Apps where `.type` is ignored, but the input is accessible | Only for one-line text |
| `.set` ... `.end` | Multiline text/code through UI Automation | Yes |
| `.setclip` | Formatted code copied from your local clipboard | Yes |
| `.screenshot` | Copy receiver screenshot back to sender clipboard | Not applicable |
| `.quit` | Exit command mode | Not applicable |

## Recommended Ways To Paste Code

### Best: `.setclip`

Use this when sending Python, JavaScript, or any code where indentation matters.

1. Copy the formatted code on the sender computer.
2. Focus the target input box on the receiver computer.
3. Run:

```text
.setclip
```

This reads the sender clipboard and sets the focused text control on the receiver. Newlines, tabs, and spaces are preserved.

### Multiline Manual Mode

Use this when you want to type or paste directly into the terminal.

```text
.set
import sys

def main():
    print("hello")

if __name__ == "__main__":
    main()
.end
```

Everything between `.set` and `.end` is sent as one multiline payload. Use `.cancel` to abort.

### One-Line `.set`

Use this only for short one-line text:

```text
.set hello world
```

There must be a space after `.set`. This is not valid:

```text
.sethello world
```

Without the space, the app treats it as normal paste text.

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

### Focused Text Set: `.set <text>` / `.setclip`

```text
.set hello world
.setclip
```

On Windows, this uses UI Automation:

1. Get the currently focused UI Automation element.
2. Try `ValuePattern.SetValue`.
3. Try `LegacyIAccessiblePattern.SetValue`.
4. Walk a few parent controls and try again.

This is why `.set` can work in apps where `.type` is ignored. It is not pretending to be a keyboard. It asks the OS accessibility layer to set the focused text control value.

## Why `.type` Works In Notepad But Not Some Apps

Notepad uses normal Windows edit controls and accepts software-generated keyboard events.

Some apps do not. They may:

- reject injected input;
- read raw HID keyboard input only;
- run with higher privileges than the Node process;
- use a custom canvas/game/remote-desktop text field;
- expose no normal editable accessibility control.

If `.type` fails but `.set` works, keep using `.setclip` for code.

If both `.type` and `.set` fail, the app likely requires real HID-level input. That means a Bluetooth HID keyboard, USB HID device, ESP32 BLE keyboard, Raspberry Pi Pico/Zero USB HID, or a signed Windows virtual HID driver.

## Troubleshooting

### Device Discovery Is One-Way

If Linux can see Windows but Windows cannot see Linux, or the reverse:

1. Run the app on both machines.
2. Read the `Local IPs` and `Listening for direct connections on port ...` from the receiver.
3. On the sender, choose `Manual connect by IP/port`.
4. Enter that IP and port.

On Windows, make sure the network is marked Private and firewall allows Node.js on private networks.

### `.setclip` Sends Old Text

Make sure you copied the formatted code on the sender computer before running `.setclip`.

### `.set` Sends One Long Line

Use `.setclip` or multiline `.set` mode. One-line `.set <text>` cannot preserve line breaks because the terminal input itself is one line.

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
