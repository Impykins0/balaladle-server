import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("Balaladle server", () => {
	it("responds to /test with a server working message", async () => {
        const response = await SELF.fetch("http://example.com/test");

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            message: "The server works!",
        });
	});

    it("returns HTTP status 404 for an invalid endpoint", async () => {
        const response = await SELF.fetch("http://example.com/impykins");

        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data).toEqual({
            error: "404: not found.",
        });
    });
});
