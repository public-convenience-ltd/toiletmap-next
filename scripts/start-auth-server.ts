#!/usr/bin/env tsx
import { startAuthServer } from '../test/integration/utils/auth-server';

const FIXED_PORT = 44555;

/**
 * Starts a local test auth server for development.
 * This provides JWKS endpoints, OAuth2 authorization flow, and token issuer for local testing without Auth0.
 * 
 * Supports:
 * - JWKS endpoint for JWT validation
 * - OAuth2 /authorize endpoint for admin UI login
 * - OAuth2 /oauth/token endpoint for code exchange
 * - /userinfo endpoint for user profile data
 * 
 * Usage:
 *   pnpm auth:server   # Standalone (pnpm dev already starts it automatically)
 * 
 * The server will run on http://127.0.0.1:44555/
 * You can now use admin UI login at http://localhost:8787/admin
 */
async function main() {
    console.log('🔐 Starting test auth server...\n');

    const audience = process.env.AUTH0_AUDIENCE || 'https://toiletmap.org.uk';

    const authServer = await startAuthServer({
        audience,
        port: FIXED_PORT // Start on fixed port 44555
    });

    console.log('✅ Test auth server started!\n');
    console.log('📍 Issuer URL:', authServer.issuer);
    console.log('🎯 Audience:', audience);
    console.log('\n🔗 Available endpoints:');
    console.log('  - JWKS:', authServer.issuer + '.well-known/jwks.json');
    console.log('  - OAuth2 Authorize:', authServer.issuer + 'authorize');
    console.log('  - OAuth2 Token:', authServer.issuer + 'oauth/token');
    console.log('  - Userinfo:', authServer.issuer + 'userinfo');
    console.log('🖥️  Login portal: visit the /authorize URL and click "Continue as Test User"');
    console.log('\n---\n');

    // Issue a sample token
    const sampleToken = authServer.issueToken({
        name: 'Local Developer',
        email: 'dev@localhost',
        nickname: 'dev',
    });

    console.log('🎫 Sample Token:');
    console.log(sampleToken);
    console.log('\n---\n');


    console.log('💡 Usage:');
    console.log('  Admin UI: http://localhost:8787/admin (login works!)');
    console.log('  API: curl -H "Authorization: Bearer <token>" http://localhost:8787/api/loos/search\n');
    console.log('🔧 Generate tokens:');
    console.log('  pnpm token:issue\n');
    console.log('⚠️  Press Ctrl+C to stop the server\n');

    // Keep the process running
    process.on('SIGINT', async () => {
        console.log('\n\n🛑 Stopping auth server...');
        await authServer.stop();
        console.log('✅ Auth server stopped');
        process.exit(0);
    });

    // Keep alive
    await new Promise(() => { });
}

main().catch((error) => {
    console.error('❌ Failed to start auth server:', error);
    process.exit(1);
});
