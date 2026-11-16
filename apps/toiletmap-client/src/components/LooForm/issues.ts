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
