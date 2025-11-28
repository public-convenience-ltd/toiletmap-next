import { describe, expect, it } from "vitest";
import { callApi, jsonRequest } from "./utils/test-client";
import { getTestContext } from "./setup";

describe("Authentication via Cookies", () => {
    it("authenticates using a valid id_token in cookie for protected routes", async () => {
        const { issueToken } = getTestContext();
        const clientId = process.env.AUTH0_CLIENT_ID;

        // Issue a token with audience = client_id (simulating an ID token)
        const idToken = issueToken({ aud: clientId });

        const response = await callApi(
            "/api/loos",
            jsonRequest(
                "POST",
                { openingTimes: [["invalid"]] },
                {
                    Cookie: `id_token=${idToken}; access_token=dummy; user_info=e30=`,
                },
            ),
        );

        // Should be 400 because the body is invalid, but NOT 401 Unauthorized
        expect(response.status).not.toBe(401);
        expect(response.status).toBe(400);
    });

    it("authenticates using a valid access_token in cookie for protected routes", async () => {
        const { issueToken } = getTestContext();

        // Issue a standard access token (audience = API audience)
        const accessToken = issueToken();

        const response = await callApi(
            "/api/loos",
            jsonRequest(
                "POST",
                { openingTimes: [["invalid"]] },
                {
                    Cookie: `access_token=${accessToken}; id_token=dummy; user_info=e30=`,
                },
            ),
        );

        expect(response.status).not.toBe(401);
        expect(response.status).toBe(400);
    });

    it("accepts access_token cookies when Auth0 returns a comma-delimited audience string", async () => {
        const { issueToken } = getTestContext();
        const apiAudience = process.env.AUTH0_AUDIENCE;
        if (!apiAudience) {
            throw new Error("AUTH0_AUDIENCE is not configured for tests");
        }

        const multiAudience = `${apiAudience},https://example.auth0.com/userinfo`;
        const accessToken = issueToken({ aud: multiAudience });

        const response = await callApi(
            "/api/loos",
            jsonRequest(
                "POST",
                { openingTimes: [["invalid"]] },
                {
                    Cookie: `access_token=${accessToken}; id_token=dummy; user_info=e30=`,
                },
            ),
        );

        expect(response.status).not.toBe(401);
        expect(response.status).toBe(400);
    });

    it("accepts access_token cookies when the audience claim is an array", async () => {
        const { issueToken } = getTestContext();
        const apiAudience = process.env.AUTH0_AUDIENCE;
        if (!apiAudience) {
            throw new Error("AUTH0_AUDIENCE is not configured for tests");
        }

        const accessToken = issueToken({
            aud: [apiAudience, "https://example.auth0.com/userinfo"],
        });

        const response = await callApi(
            "/api/loos",
            jsonRequest(
                "POST",
                { openingTimes: [["invalid"]] },
                {
                    Cookie: `access_token=${accessToken}; id_token=dummy; user_info=e30=`,
                },
            ),
        );

        expect(response.status).not.toBe(401);
        expect(response.status).toBe(400);
    });

    it("fails when id_token has wrong audience", async () => {
        const { issueToken } = getTestContext();

        // Issue a token with wrong audience
        const idToken = issueToken({ aud: "wrong-audience" });

        const response = await callApi(
            "/api/loos",
            jsonRequest(
                "POST",
                { openingTimes: [["invalid"]] },
                {
                    Cookie: `id_token=${idToken}; access_token=dummy; user_info=e30=`,
                },
            ),
        );

        expect(response.status).toBe(401);
    });
});
