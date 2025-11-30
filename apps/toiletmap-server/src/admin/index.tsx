import { Hono } from "hono";
import { requireAdminAuth } from "../auth/middleware";
import { rateLimiters } from "../middleware/cloudflare-rate-limit";
import { requireAdminRole } from "../middleware/require-admin-role";
import type { AppVariables, Env } from "../types";
import { callback, login, logout } from "./auth";
import { renderAccessDenied } from "./pages/errors/access-denied";
import { looDetail, looEdit, loosCreate, loosList } from "./pages/loos";
import { userStatistics } from "./pages/users";
import { updateUserPermissions, userAdministration } from "./pages/users/admin";

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

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

// Protected routes
admin.get("/", loosList);
admin.get("/loos", loosList);
admin.get("/loos/create", loosCreate);
admin.get("/loos/:id/edit", looEdit);
admin.get("/loos/:id", looDetail);
admin.get("/users", userStatistics);
admin.get("/users/statistics", userStatistics);
admin.get("/users/admin", userAdministration);
admin.post("/users/admin/permissions", updateUserPermissions);

export { admin };
