import { describe, expect, it } from "vitest";
import { interpretSaveResponse, UNEXPECTED_RESPONSE_MESSAGE } from "./saveResponse";

const loo = { id: "abc123", name: "High Street", updatedAt: "2026-01-01T00:00:00.000Z" };

describe("interpretSaveResponse", () => {
  it("202 → queued, carrying the pending change id when the body has one", () => {
    expect(interpretSaveResponse(202, { queued: true, id: "pending-1" }, "edit")).toStrictEqual({
      kind: "queued",
      pendingId: "pending-1",
    });
    expect(interpretSaveResponse(202, null, "add")).toStrictEqual({ kind: "queued" });
    expect(interpretSaveResponse(202, { queued: true, id: "  " }, "add")).toStrictEqual({
      kind: "queued",
    });
  });

  it("200 with a record → saved with its id", () => {
    expect(interpretSaveResponse(200, loo, "edit")).toEqual({ kind: "saved", id: "abc123" });
  });

  it("200 { queued: false, unchanged: true } → unchanged (no redirect)", () => {
    expect(interpretSaveResponse(200, { queued: false, unchanged: true }, "edit")).toEqual({
      kind: "unchanged",
    });
  });

  it("201 with a record → saved", () => {
    expect(interpretSaveResponse(201, loo, "add")).toEqual({ kind: "saved", id: "abc123" });
  });

  it("2xx without a usable id → error, never a redirect", () => {
    for (const body of [null, {}, { id: "" }, { id: "   " }, { id: 42 }, [loo]]) {
      expect(interpretSaveResponse(200, body, "edit")).toEqual({
        kind: "error",
        message: UNEXPECTED_RESPONSE_MESSAGE,
      });
    }
  });

  it("409 conflict with current record → conflict", () => {
    const body = { message: "changed", error: "conflict", current: loo };
    expect(interpretSaveResponse(409, body, "edit")).toEqual({ kind: "conflict", current: loo });
  });

  it("409 without a conflict payload → error with the server message", () => {
    expect(
      interpretSaveResponse(409, { message: "Loo with id abc123 already exists" }, "add"),
    ).toEqual({ kind: "error", message: "Loo with id abc123 already exists" });
    expect(interpretSaveResponse(409, { error: "conflict", current: {} }, "edit")).toEqual({
      kind: "error",
      message: "Error 409",
    });
  });

  it("400 → error with flattened issue details", () => {
    const body = {
      message: "Invalid upsert request body",
      issues: { _errors: [], name: { _errors: ["Too long"] } },
    };
    expect(interpretSaveResponse(400, body, "edit")).toEqual({
      kind: "error",
      message: "Invalid upsert request body",
      details: ["name: Too long"],
      issues: body.issues,
    });
    expect(interpretSaveResponse(400, {}, "edit")).toEqual({
      kind: "error",
      message: "Some of the details aren't valid.",
      details: undefined,
    });
  });

  it("401 → auth", () => {
    expect(interpretSaveResponse(401, { message: "Unauthorized" }, "edit")).toEqual({
      kind: "auth",
    });
  });

  it("404 on edit → notFound; on add → generic error", () => {
    expect(interpretSaveResponse(404, { message: "Loo not found" }, "edit")).toEqual({
      kind: "notFound",
    });
    expect(interpretSaveResponse(404, { message: "Not Found" }, "add")).toEqual({
      kind: "error",
      message: "Not Found",
    });
  });

  it("5xx → error, falling back to a friendly message", () => {
    expect(interpretSaveResponse(500, null, "edit")).toEqual({
      kind: "error",
      message: "Something went wrong on our side (error 500). Please try again.",
    });
    expect(interpretSaveResponse(503, { message: "Service unavailable" }, "add")).toEqual({
      kind: "error",
      message: "Service unavailable",
    });
  });

  it("other 4xx (e.g. 429) → error with the server message", () => {
    expect(interpretSaveResponse(429, { message: "Too many requests" }, "edit")).toEqual({
      kind: "error",
      message: "Too many requests",
    });
  });
});
