/**
 * The server's write kill switch (toiletmap-server `write_mode`, see its
 * docs/runbooks/kill-switch.md). In read-only mode every loo write (add, edit,
 * report, restore, verify) answers 503 `{ error: "read_only" }` with a
 * `Retry-After` header, which the `/api/*` proxy passes through unchanged.
 * The forms show {@link EDITING_PAUSED_TITLE} instead of a server error.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Whether a write response means editing is paused (read-only mode). */
export const isEditingPaused = (status: number, body: unknown): boolean =>
  status === 503 && isRecord(body) && body.error === "read_only";

export const EDITING_PAUSED_TITLE = "Editing is paused";

export const EDITING_PAUSED_MESSAGE =
  "Changes to the Toilet Map are switched off for a short while. Nothing was sent; please try again later.";
