import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { RequestDescription } from "../../src/core/request.js";
import {
  generateRequestSamples,
  SUPPORTED_CODE_SAMPLE_LANGS,
} from "../../src/utils/code-samples.js";
import { requestInit, sendRequest } from "../../src/components/try-it/transport.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateCodeSamples } from "../../src/utils/code-samples.js";
import { requestUrlParts } from "../../src/components/try-it/request-url.js";

let server: Server, origin: string;
beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        tag: request.headers["x-tag"],
        type: request.headers["content-type"],
        body: Buffer.concat(chunks).toString(),
      }),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(
  () =>
    new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    }),
);

async function bodyValues(echo: { type: string; body: string }) {
  return echo.type?.startsWith("multipart/")
    ? [
        ...(
          await new Response(echo.body, { headers: { "Content-Type": echo.type } }).formData()
        ).entries(),
      ]
    : echo.body;
}

describe("executed request projections", () => {
  it("uses an explicit origin variable when a local spec declares only a relative server", async () => {
    const samples = generateCodeSamples({ method: "post", path: "/translate", parameters: [], responses: [], tags: [], security: [], deprecated: false, requestBody: { required: true, content: { "text/plain": { example: "@text-is-not-a-file" } } } }, [{ url: "/api" }], SUPPORTED_CODE_SAMPLE_LANGS);
    for (const sample of samples) {
      expect(sample.source).toContain("YOUR_API_ORIGIN");
      expect(sample.source).not.toContain("https://example.com");
      expect(sample.source).not.toContain("sourcey.invalid");
    }
    const sample = samples.find(sample => sample.lang === "javascript")!;
    let url: string | undefined;
    await new Function("fetch", `return (async () => { ${sample.source.replace("YOUR_API_ORIGIN", origin)} })();`)(async (target: string) => { url = target; return new Response("{}"); });
    expect(url).toBe(origin + "/api/translate");
  });

  it("executes curl text samples without treating @ as a file or losing NUL and Unicode bytes", async () => {
    for (const text of ["@a-file-that-must-not-be-read", "before\0after\n雪\b\f", '{\n  "name": "it\'s `ready` ${now}"\n}']) {
      const request: RequestDescription = { url: origin, method: "POST", credentials: "omit", issues: [], headers: [["Content-Type", "text/plain"]], body: { kind: "text", text } };
      const [sample] = generateRequestSamples(request, ["curl"]);
      const { stdout } = await promisify(execFile)("sh", ["-c", sample.source]);
      expect(JSON.parse(stdout).body).toBe(text);
    }
  });

  it.each(["omit", "same-origin", "include"] as const)(
    "keeps live and copied JS/TS requests consistent with credentials=%s",
    async (credentials) => {
      for (const body of ['{"__proto__":{"own":true},"name":"O\'Brien","count":0}', '{\n  "__proto__": {\n    "own": true\n  },\n  "name": "O\'Brien \\\\ `${x}`",\n  "count": 0\n}', undefined]) {
        const multipart = body === undefined;
        const request: RequestDescription = {
          url: origin,
          method: "POST",
          credentials,
          issues: [],
          headers: [
            ["X-Tag", "one"],
            ["x-tag", "two"],
            ["Content-Type", multipart ? "multipart/form-data" : "application/json"],
          ],
          body: multipart
            ? {
                kind: "multipart",
                parts: [
                  ["tag", "first"],
                  ["tag", "second"],
                ],
              }
            : { kind: "text", text: body },
        };
        const actual = JSON.parse(
          await (await sendRequest(request, new AbortController().signal)).blob.text(),
        );
        for (const sample of generateRequestSamples(request, ["javascript", "typescript"])) {
          let init: RequestInit | undefined;
          let copied: typeof actual;
          const fetcher = async (url: string, options: RequestInit) => {
            init = options;
            const response = await fetch(url, options);
            copied = await response.clone().json();
            return response;
          };
          await new Function("fetch", "console", `return (async () => { ${sample.source} })();`)(
            fetcher,
            { log() {} },
          );
          expect(init?.credentials ?? "same-origin").toBe(requestInit(request).credentials);
          expect([...new Headers(init?.headers)]).toEqual([
            ...new Headers(requestInit(request).headers),
          ]);
          expect(copied.tag).toBe(actual.tag);
          expect(actual.tag).toBe("one, two");
          expect(await bodyValues(copied)).toEqual(await bodyValues(actual));
        }
      }
    },
  );

  it("combines repeated headers consistently for every generated language", () => {
    const request: RequestDescription = {
      url: origin,
      method: "GET",
      headers: [
        ["X-Tag", "one"],
        ["x-tag", "two"],
      ],
      credentials: "omit",
      issues: [],
    };
    for (const sample of generateRequestSamples(request, SUPPORTED_CODE_SAMPLE_LANGS))
      expect(sample.source).toContain("one, two");
  });
});

describe("the live request URL", () => {
  it("breaks between its origin, path segments and parameters, never inside them", () => {
    expect(requestUrlParts("https://api.sourcey.com/v1/search?limit=3&q=postgres")).toEqual(["https://api.sourcey.com", "/v1", "/search", "?limit=3", "&q=postgres"]);
    expect(requestUrlParts("/api/translate")).toEqual(["/api", "/translate"]);
    expect(requestUrlParts("http://127.0.0.1:8080")).toEqual(["http://127.0.0.1:8080"]);
  });
});
