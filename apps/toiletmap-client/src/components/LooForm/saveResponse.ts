import type { LooDetail } from "../../api/loos";
import { describeIssues } from "./issues";
import type { LooFormMode } from "./payload";

/** What the form should do with a response from POST /api/loos or PUT /api/loos/:id. */
export type SaveAction =
  /** 202 `{ queued: true, id }`: the change was queued for moderation (`id` is the pending change). */
  | { kind: "queued"; pendingId?: string }
  /** 200/201 with a record: the change was written; go to the toilet's page. */
  | { kind: "saved"; id: string }
  /** 200 `{ queued: false, unchanged: true }`: the stored record already matched (anonymous PUT). */
  | { kind: "unchanged" }
  /** 409 `{ error: "conflict", current }`: someone else changed the toilet since it was loaded. */
  | { kind: "conflict"; current: LooDetail }
  /** 401: the session expired. */
  | { kind: "auth" }
  /** 404 on edit: the toilet no longer exists. */
  | { kind: "notFound" }
  /**
   * Anything else. For a 400, `issues` is the server's raw validation payload, so the form
   * can map it onto its fields; `details` is the same, flattened into readable lines.
   */
  | { kind: "error"; message: string; details?: string[]; issues?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const hasValidId = (value: unknown): value is LooDetail =>
  isRecord(value) && typeof value.id === "string" && value.id.trim().length > 0;

export const UNEXPECTED_RESPONSE_MESSAGE =
  "The server sent an unexpected response, so we couldn't confirm your change was saved. Please check the toilet's page before trying again.";

const messageFrom = (body: unknown, fallback: string): string =>
  isRecord(body) && typeof body.message === "string" && body.message.trim()
    ? body.message
    : fallback;

export function interpretSaveResponse(
  status: number,
  body: unknown,
  mode: LooFormMode,
): SaveAction {
  if (status === 202) {
    const pendingId =
      isRecord(body) && typeof body.id === "string" && body.id.trim() ? body.id : undefined;
    return pendingId ? { kind: "queued", pendingId } : { kind: "queued" };
  }

  if (status >= 200 && status < 300) {
    if (isRecord(body) && body.unchanged === true) return { kind: "unchanged" };
    if (hasValidId(body)) return { kind: "saved", id: body.id };
    return { kind: "error", message: UNEXPECTED_RESPONSE_MESSAGE };
  }

  if (status === 409 && isRecord(body) && body.error === "conflict" && hasValidId(body.current)) {
    return { kind: "conflict", current: body.current };
  }

  if (status === 401) return { kind: "auth" };

  if (status === 404 && mode === "edit") return { kind: "notFound" };

  if (status === 400) {
    const issues = isRecord(body) ? body.issues : undefined;
    const details = describeIssues(issues);
    return {
      kind: "error",
      message: messageFrom(body, "Some of the details aren't valid."),
      ...(details.length > 0 ? { details } : {}),
      ...(issues !== undefined ? { issues } : {}),
    };
  }

  if (status >= 500) {
    return {
      kind: "error",
      message: messageFrom(
        body,
        `Something went wrong on our side (error ${status}). Please try again.`,
      ),
    };
  }

  return { kind: "error", message: messageFrom(body, `Error ${status}`) };
}
