/**
 * Learning materials (አለማዊ ትምህርት): exams, assignments, notes.
 * Any active member can suggest a file; Education (or leader/admin) approves it
 * before other members see it. Pure helpers, tested in tests/materials.test.ts.
 */
import { z } from "zod";
import { ACADEMIC_DEPARTMENTS } from "../config";

export const MATERIAL_KINDS = ["exam", "assignment", "note", "other"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** "all" = useful for every department (common courses). */
export const MATERIAL_DEPARTMENTS = [...ACADEMIC_DEPARTMENTS, "all"] as const;
export const MAX_STUDY_YEAR = 5;

export const MATERIAL_MAX_BYTES = 20 * 1024 * 1024;

/** Accepted files. PDFs and images open in the browser; Office files download. */
export const MATERIAL_TYPES: Record<string, { ext: string; inline: boolean }> = {
  "application/pdf": { ext: "pdf", inline: true },
  "image/jpeg": { ext: "jpg", inline: true },
  "image/png": { ext: "png", inline: true },
  "image/webp": { ext: "webp", inline: true },
  "application/msword": { ext: "doc", inline: false },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", inline: false },
  "application/vnd.ms-powerpoint": { ext: "ppt", inline: false },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", inline: false },
};
export const MATERIAL_ACCEPT = [...Object.keys(MATERIAL_TYPES), ".pdf", ".doc", ".docx", ".ppt", ".pptx"].join(",");

export const materialMetaSchema = z.object({
  title: z.string().trim().min(3).max(140),
  course: z.string().trim().min(2).max(80),
  department: z.enum(MATERIAL_DEPARTMENTS),
  studyYear: z.union([z.literal(""), z.coerce.number().int().min(1).max(MAX_STUDY_YEAR)]).transform((v) => (v === "" ? null : v)),
  kind: z.enum(MATERIAL_KINDS),
  fileName: z.string().trim().min(1).max(200),
});
export type MaterialMeta = z.output<typeof materialMetaSchema>;

export type MaterialFileError = "fileMissing" | "fileType" | "fileSize";

export function checkMaterialFile(type: string | null, size: number): MaterialFileError | null {
  if (!Number.isFinite(size) || size <= 0) return "fileMissing";
  if (!type || !(type in MATERIAL_TYPES)) return "fileType";
  if (size > MATERIAL_MAX_BYTES) return "fileSize";
  return null;
}

export function materialKey(id: string) {
  return `materials/${id}`;
}

/** Keeps a readable name for the download; strips path parts and control characters. */
export function cleanFileName(name: string, type: string) {
  const base = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 120) || "file";
  const ext = MATERIAL_TYPES[type]?.ext;
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base;
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name (Amharic/Oromo titles survive). */
export function contentDisposition(fileName: string, inline: boolean) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Only active members see materials; reviewers always can (they may not have a member record). */
export function canViewMaterials(memberStatus: string | null | undefined, isReviewer: boolean) {
  return isReviewer || memberStatus === "active";
}

/** Who may open one file: anyone allowed once approved; before that only the uploader and reviewers. */
export function canOpenMaterial(m: { status: string; uploadedBy: string | null }, userId: string, isReviewer: boolean) {
  return m.status === "approved" || isReviewer || m.uploadedBy === userId;
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
