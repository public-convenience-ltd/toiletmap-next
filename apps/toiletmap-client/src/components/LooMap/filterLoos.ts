import { type ActiveFilters, FILTER_BIT, type FilterKey } from "../../types/filters";
import type { CompressedLoo } from "./useMapData";

/** Rows that pass the active filters (every selected feature bit must be set). */
export function filterLoos(data: CompressedLoo[], activeFilters: ActiveFilters): CompressedLoo[] {
  const requiredMask = (Object.keys(FILTER_BIT) as FilterKey[]).reduce(
    (acc, key) => (activeFilters[key] ? acc | FILTER_BIT[key] : acc),
    0,
  );
  return requiredMask === 0 ? data : data.filter((loo) => (loo[2] & requiredMask) === requiredMask);
}
