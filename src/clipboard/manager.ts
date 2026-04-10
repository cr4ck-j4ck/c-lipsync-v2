import clipboard from 'clipboardy';
import { createHash } from 'crypto';

const POLL_INTERVAL = 500;

export class ClipboardManager {
  private lastHash: string = '';
  private interval?: NodeJS.Timeout;
  
  constructor(
    private deviceId: string,
    private onClipChange: (content: string) => void
  ) {}

  public async start() {
    try {
      const initialText = await clipboard.read();
      this.lastHash = this.hash(initialText);
    } catch {
      // Ignored if clipboard empty
    }

    this.interval = setInterval(async () => {
      try {
        const text = await clipboard.read();
        const currentHash = this.hash(text);

        if (currentHash !== this.lastHash) {
          this.lastHash = currentHash;
          this.onClipChange(text);
        }
      } catch {
        // Ignored reading errors
      }
    }, POLL_INTERVAL);
  }

  public async apply(content: string) {
    const currentHash = this.hash(content);
    if (currentHash !== this.lastHash) {
      this.lastHash = currentHash;
      await clipboard.write(content);
    }
  }

  private hash(str: string): string {
    return createHash('sha256').update(str).digest('hex');
  }

  public stop() {
    if (this.interval) clearInterval(this.interval);
  }
}
