import { toast } from './toast';

// navigator.clipboard exists only in a secure context (HTTPS or localhost).
// BEAST is often opened as http://<server-ip>:8000, where it is undefined, so
// there the copy goes through a temporary textarea and execCommand('copy') —
// deprecated, but still the only way to copy on a plain-HTTP page.
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.className = 'beast-offscreen';
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    if (!document.execCommand('copy')) {
      throw new Error('The browser refused to copy to the clipboard');
    }
  } finally {
    textarea.remove();
  }
}

/** For copy buttons: a failed copy must say so, not leave the user pasting stale text. */
export function reportCopyError(err: unknown): void {
  toast.show({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
}
