# Authentication Guide

The Toilet Map API and Admin Interface use [Auth0](https://auth0.com/) for authentication.

## Overview

- **Admin Interface**: Uses the Authorization Code Flow. It redirects users to Auth0 to log in and sets HTTP-only session cookies (`access_token`, `id_token`, `user_info`) upon successful authentication.
- **API**: Protected by JWT verification. It accepts authentication via:
  1. **Bearer Token**: `Authorization: Bearer <token>` header.
  2. **Session Cookie**: If no Bearer token is present, the API checks for a valid `access_token` cookie (shared with the Admin Interface).

## API Authentication

All API endpoints under `/api/*` (except documentation at `/api/docs`) require authentication.

### Method 1: Bearer Token (Recommended for Clients)

Clients (mobile apps, third-party integrations) should use a Bearer token.

**Request Header:**
```http
Authorization: Bearer <YOUR_ACCESS_TOKEN>
```

### Method 2: Session Cookie (Browser/Admin)

If you are logged into the Admin Interface in the same browser, the API will automatically use your session cookies. This is useful for:
- The Admin Interface itself making API calls.
- Developers testing API endpoints in the browser after logging into the Admin UI.

## Obtaining an Access Token

### For Development/Testing

1. **Via Admin Login**:
   - Navigate to `/admin/login`.
   - Log in with your credentials.
   - You are now authenticated. You can inspect your browser cookies to see the `access_token`.
   - You can also visit `/api/loos` directly in the browser.

2. **Via Auth0 (Machine-to-Machine)**:
   - If you have a Machine-to-Machine application set up in Auth0, you can request a token using the Client Credentials Flow:
     ```bash
     curl --request POST \
       --url 'https://YOUR_DOMAIN/oauth/token' \
       --header 'content-type: application/json' \
       --data '{"client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET","audience":"YOUR_AUDIENCE","grant_type":"client_credentials"}'
     ```

## Admin Interface Authentication

The Admin Interface is protected by middleware that checks for the presence of valid session cookies. If cookies are missing or invalid, the user is redirected to `/admin/login`.

- **Login**: `/admin/login` - Initiates the Auth0 flow.
- **Callback**: `/admin/callback` - Handles the Auth0 response, exchanges code for tokens, and sets cookies.
- **Logout**: `/admin/logout` - Clears session cookies.

## Configuration

Authentication is configured via environment variables (see `.env`):

- `AUTH0_ISSUER_BASE_URL`: The Auth0 domain.
- `AUTH0_AUDIENCE`: The API Identifier.
- `AUTH0_CLIENT_ID`: Client ID for the application.
- `AUTH0_CLIENT_SECRET`: Client Secret.
- `AUTH0_REDIRECT_URI`: Callback URL (e.g., `http://localhost:8787/admin/callback`).
