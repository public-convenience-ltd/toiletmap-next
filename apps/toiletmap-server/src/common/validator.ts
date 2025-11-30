import { zValidator } from "@hono/zod-validator";
import type { ZodSchema } from "zod";

export const validate = <T extends ZodSchema>(
  target: "json" | "query" | "param" | "form" | "header" | "cookie",
  schema: T,
  message: string = "Invalid request",
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          message,
          issues: (result as { error: { format: () => unknown } }).error.format(),
        },
        400,
      );
    }
  });
