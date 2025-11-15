/**
 * Normalises query parameters that can be either comma separated string or repeated keys.
 */
export const parseIds = (rawIds: string[] | undefined) =>
  (rawIds ?? [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
