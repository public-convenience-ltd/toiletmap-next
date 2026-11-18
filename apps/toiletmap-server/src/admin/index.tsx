import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";
import { requireAdminAuth } from "../auth/middleware";
import { rateLimiters } from "../middleware/cloudflare-rate-limit";
import { requireAdminRole } from "../middleware/require-admin-role";
import type { AppVariables, Env } from "../types";
import { callback, login, logout } from "./auth";
import { datasetRegenerate } from "./pages/dataset";
import { renderAccessDenied } from "./pages/errors/access-denied";
import { looDetail, looEdit, loosCreate, loosList } from "./pages/loos";
import { pendingApprove, pendingList, pendingReject } from "./pages/pending";
import { userStatistics } from "./pages/users";
import { updateUserPermissions, userAdministration } from "./pages/users/admin";

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Lets the shared Layout read per-request values (the pending badge) without
// threading them through every page.
admin.use("*", contextStorage());

// Public routes (no auth required, with rate limiting to prevent brute force)
admin.get("/login", rateLimiters.auth, login);
admin.get("/callback", rateLimiters.auth, callback);
admin.get("/logout", requireAdminAuth, logout);

// Apply authentication middleware to all other routes
admin.use("*", requireAdminAuth);
admin.use(
  "*",
  requireAdminRole({
    unauthorizedResponse: (c) => renderAccessDenied(c, c.get("user")),
  }),
);

// Nav badge: a cheap indexed count, only for page views.
admin.use("*", async (c, next) => {
  if (c.req.method === "GET") {
    try {
      c.set("pendingCount", await c.get("pendingChangeService").countPending());
    } catch {
      // The badge is cosmetic; never fail a page over it.
    }
  }
  await next();
});

// Protected routes
admin.get("/", loosList);
admin.get("/loos", loosList);
admin.get("/loos/create", loosCreate);
admin.get("/loos/:id/edit", looEdit);
admin.get("/loos/:id", looDetail);
admin.get("/pending", pendingList);
admin.post("/pending/:id/approve", pendingApprove);
admin.post("/pending/:id/reject", pendingReject);
admin.post("/dataset/regenerate", datasetRegenerate);

admin.get("/users", userStatistics);
admin.get("/users/statistics", userStatistics);
admin.get("/users/admin", userAdministration);
admin.post("/users/admin/permissions", updateUserPermissions);

export { admin };
