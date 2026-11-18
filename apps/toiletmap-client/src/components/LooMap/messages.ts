/** The toast after an edit is saved and live (LooForm's redirect to `/loos/:id?saved=1`). */
export const SAVED_MESSAGE = "Thanks — your changes are live.";
/** The toast after a new toilet is saved (`/loos/:id?saved=added`). */
export const ADDED_MESSAGE = "Thanks — the toilet is now on the map.";
/** The toast when a `/loos/:id` link names a toilet that can't be loaded. */
export const NOT_FOUND_MESSAGE = "We couldn't find that toilet. It may have been removed.";
/** The map's empty state, with nothing in view. */
export const EMPTY_MESSAGE = "No toilets here yet. Zoom out to see more, or add one.";
/** The map's empty state when filters hide everything in view. */
export const EMPTY_FILTERED_MESSAGE = "No toilets here match your filters.";
