import { MAX_DIRECT_MOVE_METRES, SERVICE_AREA_BOUNDS } from "../../common/constants";
import { haversineDistanceMetres } from "../../services/loo/diff";
import type { Coordinates, LooMutationAttributes } from "../../services/loo/types";

/**
 * Write guards for callers who are not confirmed admins (audit M2, L3, B18,
 * B19). They apply to every non-admin POST/PUT, whether it would be written
 * directly or queued for moderation; admins (`isConfirmedAdmin`) skip them.
 *
 * - `active` and `removalReason` are refused: removing a toilet from the map
 *   and putting it back go through POST /loos/:id/report and /restore, which
 *   keep a category and can be moderated.
 * - `location: null` is refused: it would take the toilet off the map with no
 *   recorded reason.
 * - A new or changed location must lie inside {@link SERVICE_AREA_BOUNDS}.
 * - `id` on create is refused: ids are generated.
 * - A move of an existing toilet by more than {@link MAX_DIRECT_MOVE_METRES}
 *   is queued, even for a trusted contributor (see {@link isLargeMove}).
 */

/** Body fields only admins may send to POST/PUT /loos. */
export const ADMIN_ONLY_MUTATION_FIELDS = ["active", "removalReason"] as const;

/** A refused non-admin write: the 400 body. `issues` uses Zod's formatted shape, keyed by field. */
export type WriteRefusal = {
  error: "admin_only_fields" | "location_required" | "location_out_of_area" | "id_not_allowed";
  message: string;
  issues: { _errors: string[]; [field: string]: string[] | { _errors: string[] } };
};

const refusal = (
  error: WriteRefusal["error"],
  message: string,
  fields: Record<string, string>,
): WriteRefusal => ({
  error,
  message,
  issues: {
    _errors: [],
    ...Object.fromEntries(
      Object.entries(fields).map(([field, fieldMessage]) => [field, { _errors: [fieldMessage] }]),
    ),
  },
});

/** Whether `location` lies inside {@link SERVICE_AREA_BOUNDS} (edges included). */
export const isWithinServiceArea = ({ lat, lng }: Coordinates): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= SERVICE_AREA_BOUNDS.minLat &&
  lat <= SERVICE_AREA_BOUNDS.maxLat &&
  lng >= SERVICE_AREA_BOUNDS.minLng &&
  lng <= SERVICE_AREA_BOUNDS.maxLng;

/**
 * Checks the fields a non-admin sent (before diffing): no admin-only field
 * and no `location: null`. Returns the refusal, or null when allowed.
 */
export const checkNonAdminFields = (mutation: LooMutationAttributes): WriteRefusal | null => {
  const sent = ADMIN_ONLY_MUTATION_FIELDS.filter((field) => mutation[field] !== undefined);
  if (sent.length > 0) {
    return refusal(
      "admin_only_fields",
      "Only admins can set active or removalReason. To take a toilet off the map, report it " +
        "(POST /api/loos/:id/report); to put it back, restore it (POST /api/loos/:id/restore).",
      Object.fromEntries(sent.map((field) => [field, `${field} can only be set by an admin`])),
    );
  }
  if (mutation.location === null) {
    return refusal(
      "location_required",
      "A toilet's location cannot be removed. To take it off the map, report it instead.",
      { location: "location cannot be cleared" },
    );
  }
  return null;
};

/**
 * Checks a location a non-admin would write (a create's, or an edit's after
 * diffing, so an unchanged location never blocks other edits). Returns the
 * refusal, or null when allowed.
 */
export const checkNonAdminLocation = (
  location: Coordinates | null | undefined,
): WriteRefusal | null => {
  if (!location || isWithinServiceArea(location)) return null;
  return refusal(
    "location_out_of_area",
    "This location is outside the area the Toilet Map covers (Great Britain, Northern Ireland, " +
      "the Isle of Man and the Channel Islands).",
    { location: "location must be in the UK, the Isle of Man or the Channel Islands" },
  );
};

/** The refusal for a non-admin create that names its own id. */
export const idNotAllowedRefusal = (): WriteRefusal =>
  refusal("id_not_allowed", "Only admins can choose a toilet's id; leave id out.", {
    id: "id can only be set by an admin",
  });

/**
 * Whether moving a toilet from `from` to `to` counts as a large move (more
 * than {@link MAX_DIRECT_MOVE_METRES}), which a non-admin cannot apply
 * directly. Placing a toilet that had no location is not a move.
 */
export const isLargeMove = (
  from: Coordinates | null | undefined,
  to: Coordinates | null | undefined,
): boolean => !!from && !!to && haversineDistanceMetres(from, to) > MAX_DIRECT_MOVE_METRES;
