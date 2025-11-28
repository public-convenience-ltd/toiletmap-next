# Authentication Overview

The Toilet Map API and Admin Interface use [Auth0](https://auth0.com/) for authentication.

## Core Mechanisms

- **Admin Interface**: Uses the Authorization Code Flow. It redirects users to Auth0 to log in and sets HTTP-only session cookies (`access_token`, `id_token`, `user_info`) upon successful authentication.
- **API**: Read endpoints are public. Mutations (`POST /api/loos`, `PUT /api/loos/:id`) and privileged views still require JWT/session authentication. The API accepts authentication via:
  1. **Bearer Token**: `Authorization: Bearer <token>` header.
  2. **Session Cookie**: If no Bearer token is present, the API checks for a valid `access_token` cookie (shared with the Admin Interface).
