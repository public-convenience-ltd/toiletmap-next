import { Context } from "hono";
import { Layout } from "../../components/Layout";
import { Button } from "../../components/DesignSystem";
import { Env } from "../../../types";
import { serializeConfig } from "./helpers";
import { createPrismaClient } from "../../../prisma";
import { LooService } from "../../../services/loo";
import type { TriStateValue } from "./shared/utils/types";

const booleanToTriState = (value: boolean | null): TriStateValue => {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
};

export const looEdit = async (c: Context<{ Bindings: Env }>) => {
  const { id } = c.req.param();

  const connectionString =
    c.env.HYPERDRIVE?.connectionString ??
    c.env.TEST_HYPERDRIVE?.connectionString;
  if (!connectionString) {
    throw new Error("No database connection string available");
  }
  const prisma = createPrismaClient(connectionString);
  const looService = new LooService(prisma);
  const loo = await looService.getById(id);

  if (!loo) {
    return c.html(
      <Layout title="Loo not found">
        <div class="page-header">
          <h1>Loo not found</h1>
          <Button href="/admin/loos">Back to dataset</Button>
        </div>
        <div class="empty-state">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <h3>Loo not found</h3>
          <p>
            The loo you're trying to edit doesn't exist or has been removed.
          </p>
        </div>
      </Layout>
    );
  }

  const defaults = {
    name: loo.name || "",
    notes: loo.notes || "",
    lat: loo.location?.lat?.toString() || "",
    lng: loo.location?.lng?.toString() || "",
    accessible: booleanToTriState(loo.accessible),
    radar: booleanToTriState(loo.radar),
    attended: booleanToTriState(loo.attended),
    automatic: booleanToTriState(loo.automatic),
    noPayment: booleanToTriState(loo.noPayment),
    paymentDetails: loo.paymentDetails || "",
    babyChange: booleanToTriState(loo.babyChange),
    men: booleanToTriState(loo.men),
    women: booleanToTriState(loo.women),
    allGender: booleanToTriState(loo.allGender),
    children: booleanToTriState(loo.children),
    urinalOnly: booleanToTriState(loo.urinalOnly),
    active: booleanToTriState(loo.active),
    removalReason: loo.removalReason || "",
    openingTimes: loo.openingTimes ?? null,
  };

  const pageConfig = {
    api: {
      update: `/api/loos/${id}`,
    },
    looId: id,
    defaults,
  };

  const serializedConfig = serializeConfig(pageConfig);

  return c.html(
    <Layout title={`Edit: ${loo.name || "Unnamed Loo"}`}>
      <noscript>
        <div class="empty-state" style="margin-bottom: var(--space-l);">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <h3>JavaScript is required</h3>
          <p>
            This page now renders fully in the browser. Please enable JavaScript
            to edit loos.
          </p>
        </div>
      </noscript>

      <div class="page-header">
        <div>
          <p class="form-label" style="margin: 0;">
            Operations
          </p>
          <h1 style="margin: var(--space-3xs) 0;">Edit loo</h1>
          <p style="max-width: 60ch; color: var(--color-neutral-grey); margin-top: var(--space-2xs);">
            {loo.name || "Unnamed Loo"}
          </p>
        </div>
        <Button href={`/admin/loos/${id}`} variant="secondary">
          Cancel
        </Button>
      </div>

      <section class="create-shell" data-loo-edit-shell>
        <div class="form-card">
          <div class="loading-indicator">
            <span class="loading-spinner" aria-hidden="true"></span>
            <p>Loading edit form…</p>
          </div>
        </div>
      </section>

      <script
        type="application/json"
        id="loo-edit-config"
        dangerouslySetInnerHTML={{ __html: serializedConfig }}
      ></script>
      <div id="loo-edit-root"></div>
      <script type="module" src="/admin/loos-edit.js"></script>
    </Layout>
  );
};
