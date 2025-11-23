import { describe, expect, it } from "vitest";
import { callApi } from "./utils/test-client";
import { getTestContext } from "./setup";

describe("Authentication via Cookies", () => {
    it("authenticates using a valid id_token in cookie", async () => {
        const { issueToken } = getTestContext();
        const clientId = process.env.AUTH0_CLIENT_ID;

        // Issue a token with audience = client_id (simulating an ID token)
        const idToken = issueToken({ aud: clientId });

        const response = await callApi("/api/loos", {
            headers: {
                Cookie: `id_token=${idToken}; access_token=dummy; user_info=e30=` // e30= is base64 for {}
            }
        });

        // Should be 400 because query params are missing, but NOT 401 Unauthorized
        expect(response.status).not.toBe(401);
        expect(response.status).toBe(400);
    });

    it("authenticates using a valid access_token in cookie", async () => {
        const { issueToken } = getTestContext();

        // Issue a standard access token (audience = API audience)
        const accessToken = issueToken();

        const response = await callApi("/api/loos", {
            headers: {
                Cookie: `access_token=${accessToken}; id_token=dummy; user_info=e30=`
            }
        });

        expect(response.status).not.toBe(401);
        expect(response.status).toBe(400);
    });

    it("fails when id_token has wrong audience", async () => {
        const { issueToken } = getTestContext();

        // Issue a token with wrong audience
        const idToken = issueToken({ aud: "wrong-audience" });

        const response = await callApi("/api/loos", {
            headers: {
                Cookie: `id_token=${idToken}; access_token=dummy; user_info=e30=`
            }
        });

        expect(response.status).toBe(401);
    });
});

