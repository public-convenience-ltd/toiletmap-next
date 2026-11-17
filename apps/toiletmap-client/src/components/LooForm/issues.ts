/**
 * Flatten a validation `issues` payload from the API into readable lines.
 * Handles Zod's `error.format()` tree ({ _errors: string[], field: {...} }) and
 * flat issue arrays ({ path, message }[]).
 */
export function describeIssues(issues: unknown, limit = 5): string[] {
  const lines: string[] = [];

  const walk = (node: unknown, path: string[]) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "_errors") {
        if (Array.isArray(value)) {
          for (const msg of value) {
            if (typeof msg === "string")
              lines.push(path.length ? `${path.join(".")}: ${msg}` : msg);
          }
        }
      } else {
        walk(value, [...path, key]);
      }
    }
  };

  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== "object") continue;
      const { path, message } = issue as { path?: unknown; message?: unknown };
      if (typeof message !== "string") continue;
      const prefix = Array.isArray(path) && path.length ? `${path.join(".")}: ` : "";
      lines.push(`${prefix}${message}`);
    }
  } else {
    walk(issues, []);
  }

  return lines.slice(0, limit);
}

export interface MappedIssues<F extends string> {
  /** The first message for each recognised form field. */
  fields: Partial<Record<F, string>>;
  /** Readable lines for issues that don't belong to a known field. */
  other: string[];
}

/**
 * Map a validation `issues` payload onto form fields, using the first path segment as the
 * field name (the API's payload keys are the form's field names, e.g. `openingTimes.2` →
 * `openingTimes`). Issues for unknown keys, or with no path, are returned in `other`.
 */
export function fieldErrorsFromIssues<F extends string>(
  issues: unknown,
  knownFields: readonly F[],
): MappedIssues<F> {
  const known = new Set<string>(knownFields);
  const fields: Partial<Record<F, string>> = {};
  const other: string[] = [];

  const add = (path: string[], message: string) => {
    const [head] = path;
    if (head !== undefined && known.has(head)) {
      if (!fields[head as F]) fields[head as F] = message;
    } else {
      other.push(path.length ? `${path.join(".")}: ${message}` : message);
    }
  };

  const walk = (node: unknown, path: string[]) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "_errors") {
        if (Array.isArray(value)) {
          for (const msg of value) if (typeof msg === "string") add(path, msg);
        }
      } else {
        walk(value, [...path, key]);
      }
    }
  };

  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== "object") continue;
      const { path, message } = issue as { path?: unknown; message?: unknown };
      if (typeof message !== "string") continue;
      add(Array.isArray(path) ? path.map(String) : [], message);
    }
  } else {
    walk(issues, []);
  }

  return { fields, other };
}
