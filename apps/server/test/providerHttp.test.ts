import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderError, request } from "../src/services/providerHttp.js";

test("Meta error diagnostics reject non-numeric fields and safely handle non-JSON responses", async () => {
  const before = globalThis.fetch;
  try {
    for (const body of [
      JSON.stringify({
        error: {
          code: "private-token",
          error_subcode: "private-secret",
          message: "private-code",
        },
      }),
      "<html>private-token private-secret</html>",
    ]) {
      globalThis.fetch = async () => new Response(body, { status: 400 });
      await assert.rejects(
        () =>
          request(
            "https://graph.facebook.com/test?access_token=private-token",
            {},
            false,
            "Meta account discovery",
          ),
        (error: unknown) => {
          assert(error instanceof ProviderError);
          assert.equal(
            error.message,
            "Meta account discovery failed (HTTP 400). Check permissions, account eligibility, and media requirements.",
          );
          assert(!JSON.stringify(error).includes("private-"));
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = before;
  }
});

test("Meta transport failures identify their stage without including the failing URL", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError(
      "https://graph.facebook.com/token?client_secret=private-secret",
    );
  };
  try {
    await assert.rejects(
      () =>
        request(
          "https://graph.facebook.com/token",
          {},
          false,
          "Meta code exchange",
        ),
      (error: unknown) => {
        assert(error instanceof ProviderError);
        assert.equal(
          error.message,
          "Meta code exchange failed: the platform connection was interrupted.",
        );
        assert.equal(error.retryable, true);
        assert.equal(error.uncertain, false);
        assert(
          !`${error.stack} ${JSON.stringify(error)}`.includes("private-secret"),
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = before;
  }
});

test("stage diagnostics preserve provider retry, authentication, and uncertain-write flags", async () => {
  const before = globalThis.fetch;
  try {
    for (const [status, mutating, retryable, uncertain, auth] of [
      [400, false, false, false, false],
      [401, false, false, false, true],
      [403, false, false, false, true],
      [429, true, true, false, false],
      [503, false, true, false, false],
      [503, true, false, true, false],
    ] as const) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: { code: 190 } }), { status });
      for (const stage of [undefined, "Meta account discovery"] as const)
        await assert.rejects(
          () => request("https://graph.facebook.com/test", {}, mutating, stage),
          (error: unknown) => {
            assert(error instanceof ProviderError);
            assert.equal(error.retryable, retryable);
            assert.equal(error.uncertain, uncertain);
            assert.equal(error.auth, auth);
            assert.equal(
              error.message.includes("Meta code 190"),
              stage !== undefined,
            );
            return true;
          },
        );
    }
  } finally {
    globalThis.fetch = before;
  }
});
