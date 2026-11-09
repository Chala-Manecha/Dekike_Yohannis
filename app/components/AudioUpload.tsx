import { useState } from "react";
import { useRevalidator } from "react-router";
import { AUDIO_MAX_BYTES } from "../lib/songs";
import { useT } from "../lib/use-t";

/** Sends the recording as the raw request body (see routes/songs.$id.audio.ts). */
export function AudioUpload({ songId }: { songId: string }) {
  const { tr } = useT();
  const s = tr.songs;
  const revalidator = useRevalidator();
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > AUDIO_MAX_BYTES) return setState({ busy: false, error: tr.errors.audioSize });
    setState({ busy: true });
    const res = await fetch(`/songs/${songId}/audio`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    input.value = "";
    if (!body?.ok) return setState({ busy: false, error: (body?.error && (tr.errors as Record<string, string>)[body.error]) || tr.errors.generic });
    setState({ busy: false });
    revalidator.revalidate();
  }

  return (
    <div className="audio-upload">
      <label className="btn btn-quiet btn-sm">
        {state.busy ? s.uploading : s.uploadAudio}
        <input type="file" accept="audio/*" hidden disabled={state.busy} onChange={onChange} />
      </label>
      <small className="muted"> {s.audioHint}</small>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
    </div>
  );
}
