import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { ACADEMIC_DEPARTMENTS } from "../config";
import { formatBytes, MATERIAL_ACCEPT, MATERIAL_KINDS, MATERIAL_MAX_BYTES, MAX_STUDY_YEAR } from "../lib/materials";
import { useT } from "../lib/use-t";

/**
 * Sends the file as the raw request body (see routes/materials.upload.ts) with the
 * details in a header, so the Worker streams it to R2 without parsing it.
 */
export function MaterialUpload({ courses, reviewer }: { courses: string[]; reviewer: boolean }) {
  const { tr } = useT();
  const m = tr.materials;
  const revalidator = useRevalidator();
  const form = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "error"; message?: string }>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setState({ kind: "error", message: m.errors.fileMissing });
    if (file.size > MATERIAL_MAX_BYTES) return setState({ kind: "error", message: m.errors.fileSize });
    const meta = {
      title: fd.get("title"),
      course: fd.get("course"),
      department: fd.get("department"),
      studyYear: fd.get("studyYear"),
      kind: fd.get("kind"),
      fileName: file.name,
    };
    setState({ kind: "busy" });
    try {
      const res = await fetch("/materials/upload", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-Material-Meta": encodeURIComponent(JSON.stringify(meta)) },
        body: file,
      });
      const body = (await res.json().catch(() => null)) as { id?: string; approved?: boolean; error?: keyof typeof m.errors } | null;
      if (!res.ok || !body?.id) {
        return setState({ kind: "error", message: (body?.error && m.errors[body.error]) || tr.errors.generic });
      }
      form.current?.reset();
      setState({ kind: "done", message: body.approved ? m.publishedNow : m.sentForReview });
      revalidator.revalidate();
    } catch {
      setState({ kind: "error", message: tr.errors.generic });
    }
  }

  return (
    <details className="panel upload-panel" open={state.kind !== "idle" || undefined}>
      <summary>{m.share}</summary>
      <p className="muted">{reviewer ? m.shareHintReviewer : m.shareHint}</p>
      <form ref={form} className="form" onSubmit={onSubmit}>
        <label className="field">
          <span>{m.file} <small>{m.fileHint(formatBytes(MATERIAL_MAX_BYTES))}</small></span>
          <input type="file" name="file" accept={MATERIAL_ACCEPT} required />
        </label>
        <label className="field"><span>{m.titleLabel}</span><input name="title" required minLength={3} maxLength={140} placeholder={m.titlePlaceholder} /></label>
        <label className="field">
          <span>{m.course}</span>
          <input name="course" required minLength={2} maxLength={80} list="material-courses" autoComplete="off" />
          <datalist id="material-courses">{courses.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <div className="field-row">
          <label className="field"><span>{m.department}</span>
            <select name="department" defaultValue="all">
              <option value="all">{m.allDepartments}</option>
              {ACADEMIC_DEPARTMENTS.map((d) => <option key={d} value={d}>{tr.dept[d]}</option>)}
            </select>
          </label>
          <label className="field"><span>{m.year}</span>
            <select name="studyYear" defaultValue="">
              <option value="">{m.anyYear}</option>
              {Array.from({ length: MAX_STUDY_YEAR }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{m.yearN(y)}</option>)}
            </select>
          </label>
          <label className="field"><span>{m.kind}</span>
            <select name="kind" defaultValue="exam">
              {MATERIAL_KINDS.map((k) => <option key={k} value={k}>{m.kinds[k]}</option>)}
            </select>
          </label>
        </div>
        {state.kind === "error" && <p className="form-error" role="alert">{state.message}</p>}
        {state.kind === "done" && <p className="notice" role="status">{state.message}</p>}
        <button className="btn btn-primary" disabled={state.kind === "busy"}>{state.kind === "busy" ? m.uploading : m.send}</button>
      </form>
    </details>
  );
}
