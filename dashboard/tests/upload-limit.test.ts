import { describe, expect, it } from "vitest";
import { MULTIPART_SLACK_BYTES, PDF_MAX_BYTES, XLSX_MAX_BYTES, uploadRefusal } from "@/lib/uploadLimit";

describe("upload size guard", () => {
  it("lets a body up to the file cap plus the multipart slack through", () => {
    expect(uploadRefusal("12345", XLSX_MAX_BYTES)).toBeNull();
    expect(uploadRefusal(String(XLSX_MAX_BYTES + MULTIPART_SLACK_BYTES), XLSX_MAX_BYTES)).toBeNull();
    expect(uploadRefusal(String(PDF_MAX_BYTES), PDF_MAX_BYTES)).toBeNull();
  });

  it("refuses an oversized body with 413 before it is read", () => {
    expect(uploadRefusal(String(XLSX_MAX_BYTES + MULTIPART_SLACK_BYTES + 1), XLSX_MAX_BYTES)).toEqual({ status: 413, error: "FILE_TOO_LARGE" });
    expect(uploadRefusal(String(25 * 1024 * 1024), PDF_MAX_BYTES)).toEqual({ status: 413, error: "FILE_TOO_LARGE" });
    expect(uploadRefusal("99999999999999999999999", PDF_MAX_BYTES)).toEqual({ status: 413, error: "FILE_TOO_LARGE" });
  });

  it("refuses a missing or malformed Content-Length", () => {
    expect(uploadRefusal(null, PDF_MAX_BYTES)).toEqual({ status: 411, error: "LENGTH_REQUIRED" });
    expect(uploadRefusal("", PDF_MAX_BYTES)).toEqual({ status: 411, error: "LENGTH_REQUIRED" });
    expect(uploadRefusal("-5", PDF_MAX_BYTES)).toEqual({ status: 400, error: "INVALID_CONTENT_LENGTH" });
    expect(uploadRefusal("1e6", PDF_MAX_BYTES)).toEqual({ status: 400, error: "INVALID_CONTENT_LENGTH" });
    expect(uploadRefusal("12.5", PDF_MAX_BYTES)).toEqual({ status: 400, error: "INVALID_CONTENT_LENGTH" });
  });
});
