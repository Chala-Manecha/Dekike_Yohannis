import { describe, expect, it } from "vitest";
import {
  canOpenMaterial,
  canViewMaterials,
  checkMaterialFile,
  cleanFileName,
  contentDisposition,
  formatBytes,
  materialMetaSchema,
  MATERIAL_MAX_BYTES,
} from "../app/lib/materials";

const meta = { title: "Mid exam 2016", course: "Data Structures", department: "cs", studyYear: "2", kind: "exam", fileName: "mid.pdf" };

describe("materialMetaSchema", () => {
  it("accepts a normal upload and turns the year into a number", () => {
    const r = materialMetaSchema.parse(meta);
    expect(r.studyYear).toBe(2);
    expect(r.department).toBe("cs");
  });
  it("allows 'all departments' and 'any year'", () => {
    const r = materialMetaSchema.parse({ ...meta, department: "all", studyYear: "" });
    expect(r.studyYear).toBeNull();
  });
  it("rejects bad values", () => {
    expect(materialMetaSchema.safeParse({ ...meta, studyYear: "7" }).success).toBe(false);
    expect(materialMetaSchema.safeParse({ ...meta, kind: "video" }).success).toBe(false);
    expect(materialMetaSchema.safeParse({ ...meta, department: "law" }).success).toBe(false);
    expect(materialMetaSchema.safeParse({ ...meta, title: "a" }).success).toBe(false);
  });
});

describe("checkMaterialFile", () => {
  it("accepts PDFs, images and Office files", () => {
    expect(checkMaterialFile("application/pdf", 1000)).toBeNull();
    expect(checkMaterialFile("image/jpeg", 1000)).toBeNull();
    expect(checkMaterialFile("application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1000)).toBeNull();
  });
  it("rejects empty, unknown or too large files", () => {
    expect(checkMaterialFile("application/pdf", 0)).toBe("fileMissing");
    expect(checkMaterialFile("application/pdf", NaN)).toBe("fileMissing");
    expect(checkMaterialFile("text/html", 100)).toBe("fileType");
    expect(checkMaterialFile("image/svg+xml", 100)).toBe("fileType");
    expect(checkMaterialFile(null, 100)).toBe("fileType");
    expect(checkMaterialFile("application/pdf", MATERIAL_MAX_BYTES + 1)).toBe("fileSize");
  });
});

describe("file names", () => {
  it("strips paths and adds the right extension", () => {
    expect(cleanFileName("C:\\Users\\x\\exam", "application/pdf")).toBe("exam.pdf");
    expect(cleanFileName("../../notes.PDF", "application/pdf")).toBe("notes.PDF");
    expect(cleanFileName('bad"name\n.pdf', "application/pdf")).toBe("badname.pdf");
  });
  it("keeps non-Latin names in the UTF-8 part of the header", () => {
    const h = contentDisposition("ፈተና.pdf", true);
    expect(h).toMatch(/^inline; filename="_+\.pdf"; filename\*=UTF-8''/);
    expect(decodeURIComponent(h.split("''")[1])).toBe("ፈተና.pdf");
    expect(contentDisposition("a.docx", false)).toMatch(/^attachment;/);
  });
  it("formats sizes", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("access", () => {
  it("only active members and reviewers see the library", () => {
    expect(canViewMaterials("active", false)).toBe(true);
    expect(canViewMaterials("pending", false)).toBe(false);
    expect(canViewMaterials(undefined, false)).toBe(false);
    expect(canViewMaterials(undefined, true)).toBe(true);
  });
  it("hides unapproved files from everyone but the uploader and reviewers", () => {
    const pending = { status: "pending", uploadedBy: "u1" };
    expect(canOpenMaterial(pending, "u1", false)).toBe(true);
    expect(canOpenMaterial(pending, "u2", false)).toBe(false);
    expect(canOpenMaterial(pending, "u2", true)).toBe(true);
    expect(canOpenMaterial({ status: "approved", uploadedBy: "u1" }, "u2", false)).toBe(true);
  });
});
