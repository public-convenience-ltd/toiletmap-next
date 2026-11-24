import { createPrismaClient } from "../../prisma";
import type { Env } from "../../types";
import { getEnvironmentName } from "../../utils/environment";
import { createLogger } from "../../utils/logger";
import { LooService } from "../loo";
import { type ExportOutcome, runDatasetExport } from "./export.service";

/** The production cron (wrangler.jsonc `env.production.triggers.crons`). */
export const DATASET_EXPORT_CRON = "17 0 * * *";

/**
 * Runs the dataset export from the worker's `scheduled()` handler, with its
 * own database client (there is no request to hang the services on).
 *
 * Every cron currently runs the export; when another scheduled job arrives,
 * dispatch on `controller.cron` here.
 *
 * Throws when the export failed or refused to publish, so the run shows as
 * an error in the Cron Events log. Skips (no bucket, already published
 * today) return normally.
 */
export const handleScheduled = async (
  controller: Pick<ScheduledController, "cron" | "scheduledTime">,
  env: Env,
): Promise<ExportOutcome> => {
  const logger = createLogger(getEnvironmentName(env));
  logger.info("Scheduled run started", { cron: controller.cron });

  let outcome: ExportOutcome;
  if (!env.EXPORTS) {
    // Checked before connecting, so environments without the bucket do no work.
    outcome = await runDatasetExport({
      bucket: undefined,
      loadRows: async () => [],
      trigger: "scheduled",
      logger,
    });
  } else {
    const connectionString =
      env.HYPERDRIVE?.connectionString ?? env.TEST_HYPERDRIVE?.connectionString;
    if (!connectionString) {
      throw new Error("No database connection string available for the dataset export.");
    }
    const prisma = createPrismaClient(connectionString);
    try {
      const looService = new LooService(prisma);
      outcome = await runDatasetExport({
        bucket: env.EXPORTS,
        loadRows: () => looService.getAllForExport(),
        trigger: "scheduled",
        logger,
      });
    } finally {
      await prisma.$disconnect();
    }
  }

  if (outcome.status === "failed" || outcome.status === "refused") {
    throw new Error(`Dataset export ${outcome.status}: ${outcome.message}`);
  }
  return outcome;
};
