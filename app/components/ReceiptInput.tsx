import { useState } from "react";

const MAX_SIDE = 1600;

/**
 * Converts the chosen photo to WebP (max 1600px) in the browser before upload:
 * smaller files for members on mobile data, less R2 storage, no server CPU.
 * If conversion fails, the original file is uploaded unchanged.
 */
export function ReceiptInput({ label, hint, preparing, error }: { label: string; hint: string; preparing: string; error?: string }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.8));
      if (blob && blob.type === "image/webp" && blob.size < file.size) {
        const dt = new DataTransfer();
        dt.items.add(new File([blob], file.name.replace(/\.\w+$/, "") + ".webp", { type: "image/webp" }));
        input.files = dt.files;
      }
      setPreview(URL.createObjectURL(input.files![0]));
    } catch {
      setPreview(URL.createObjectURL(file));
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="field">
      <span>
        {label} <small>{hint}</small>
      </span>
      <input type="file" name="receipt" accept="image/*" required onChange={onChange} aria-invalid={Boolean(error)} />
      {busy && <span className="muted">{preparing}</span>}
      {preview && !busy && <img src={preview} alt="" className="receipt-preview" />}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
