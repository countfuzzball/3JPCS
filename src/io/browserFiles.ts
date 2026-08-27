export interface SaveFileHandle {
  readonly name?: string;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: readonly { description: string; accept: Record<string, readonly string[]> }[];
  }) => Promise<SaveFileHandle>;
}

export async function saveJsonFile(
  value: unknown,
  suggestedName: string,
  existingHandle: SaveFileHandle | null,
): Promise<SaveFileHandle | null> {
  const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  let handle = existingHandle;
  if (!handle) {
    const picker = (window as SavePickerWindow).showSaveFilePicker;
    if (picker) {
      handle = await picker({
        suggestedName,
        types: [{ description: "Polygon County scenery project", accept: { "application/json": [".json"] } }],
      });
    }
  }
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return handle;
  }
  downloadBlob(blob, suggestedName);
  return null;
}

export function downloadJson(value: unknown, filename: string): void {
  downloadBlob(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" }), filename);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  downloadBlob(new Blob([bytes.slice().buffer], { type: mimeType }), filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
