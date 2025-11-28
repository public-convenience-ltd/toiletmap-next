# Admin Interface Authentication

The Admin Interface is protected by middleware that checks for the presence of valid session cookies. If cookies are missing or invalid, the user is redirected to `/admin/login`.

## Auth Flow

- **Login**: `/admin/login` - Initiates the Auth0 flow.
- **Callback**: `/admin/callback` - Handles the Auth0 response, exchanges code for tokens, and sets cookies.
- **Logout**: `/admin/logout` - Clears session cookies.
