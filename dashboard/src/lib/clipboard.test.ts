import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from './clipboard';

function setSecure(secure: boolean, writeText?: (t: string) => Promise<void>) {
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

// BEAST is often opened as http://<server-ip>:8000. That is not a secure
// context, so navigator.clipboard does not exist there and copy buttons
// silently did nothing.
describe('copyText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('uses the Clipboard API in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setSecure(true, writeText);
    await copyText('secret');
    expect(writeText).toHaveBeenCalledWith('secret');
  });

  it('falls back to execCommand over plain HTTP', async () => {
    setSecure(false);
    let copied = '';
    document.execCommand = vi.fn(() => {
      copied = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    await copyText('claude mcp add beast');
    expect(copied).toBe('claude mcp add beast');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('throws when the browser refuses to copy', async () => {
    setSecure(false);
    document.execCommand = vi.fn(() => false);
    await expect(copyText('x')).rejects.toThrow();
    expect(document.querySelector('textarea')).toBeNull();
  });
});
