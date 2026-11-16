import type { LooFormState } from "../../../shared/utils/types";

export type EditPageConfig = {
  api: {
    update: string;
  };
  looId: string;
  /**
   * The record's `updatedAt` when the page was rendered (ISO-8601). Sent back as
   * `baseUpdatedAt` so the API can reject the save (409) if someone else has
   * changed the loo in the meantime.
   */
  baseUpdatedAt?: string | null;
  defaults: Partial<LooFormState>;
};
