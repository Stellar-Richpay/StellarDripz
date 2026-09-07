/**
 * Shared clipboard helper.
 *
 * navigator.clipboard is only available in secure contexts (https or
 * localhost); three components previously duplicated a textarea/execCommand
 * fallback with slightly different behavior (e.g. only marking "copied" in
 * the fallback path). This centralizes the write + fallback.
 */

/**
 * Copy text to the clipboard. Resolves successfully even when the async
 * Clipboard API is unavailable (non-secure context), using the legacy
 * textarea/execCommand fallback. Returns false only if both paths fail.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path (e.g. permissions denied)
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; // avoid scrolling to the element
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
