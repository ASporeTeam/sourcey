import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  describeRequest,
  initialDraft,
  parameterKey,
  serializeParameter,
} from "../../src/core/request.js";
import { normalizeSpec } from "../../src/core/normalizer.js";
import {
  generateRequestSamples,
  SUPPORTED_CODE_SAMPLE_LANGS,
} from "../../src/utils/code-samples.js";
import { validateValue } from "../../src/core/schema.js";
import { requestInit, sendRequest } from "../../src/components/try-it/transport.js";
import { restoreDraft, saveDraft, storedDraft } from "../../src/components/try-it/drafts.js";
import type { NormalizedOperation, NormalizedParameter } from "../../src/core/types.js";
import type { ConsoleData } from "../../src/core/try-it.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

function operation(overrides: Partial<NormalizedOperation> = {}): NormalizedOperation {
  return {
    method: "get",
    path: "/items",
    parameters: [],
    tags: [],
    responses: [],
    security: [],
    deprecated: false,
    ...overrides,
  };
}
function parameter(name: string, extra: Partial<NormalizedParameter> = {}): NormalizedParameter {
  return {
    name,
    in: "query",
    required: false,
    deprecated: false,
    schema: { type: "string" },
    ...extra,
  };
}
function context(op = operation(), origin = "https://api.example.test/v1") {
  return {
    operation: op,
    servers: [{ url: origin }],
    securitySchemes: {},
    baseUrl: "https://docs.example.test/",
  };
}
function consoleData(op = operation()): ConsoleData {
  return {
    ...context(op),
    specKey: "api",
    version: "1",
    languages: ["curl"],
    credentials: "same-origin",
  };
}

describe("canonical request serialization", () => {
  it("keeps private spec URL credentials out of the published console facts", () => {
    const spec = normalizeSpec({
      source: "https://reader:private@example.test/spec/api.json?token=private#section",
      document: {
        openapi: "3.1.0",
        info: { title: "Test", version: "1" },
        paths: {},
      },
    });
    expect(spec.sourceUrl).toBe("https://example.test/spec/api.json");
  });
  it("normalizes path servers and serialization metadata at the existing owner", () => {
    const spec = normalizeSpec({
      source: "https://api.example.test/openapi.json",
      document: {
        openapi: "3.1.0",
        info: { title: "Test", version: "1" },
        servers: [{ url: "https://default.test" }],
        security: [{ Key: [] }],
        paths: {
          "/items": {
            servers: [{ url: "https://path.test" }],
            get: {
              security: [],
              parameters: [
                {
                  name: "tag",
                  in: "query",
                  style: "pipeDelimited",
                  explode: false,
                  allowReserved: true,
                  schema: { type: "array", items: { type: "string" }, "x-enumNames": ["One"] },
                },
              ],
              responses: {},
            },
          },
        },
      },
    });
    expect(spec.sourceUrl).toBe("https://api.example.test/openapi.json");
    expect(spec.operations[0].servers?.[0].url).toBe("https://path.test");
    expect(spec.operations[0].security).toEqual([]);
    expect(spec.operations[0].parameters[0]).toMatchObject({
      style: "pipeDelimited",
      explode: false,
      allowReserved: true,
      schema: { enumNames: ["One"] },
    });
  });
  it.each([
    [{ name: "id", in: "path", style: "simple" }, ["red", "blue"], "red,blue"],
    [{ name: "id", in: "path", style: "label", explode: true }, ["red", "blue"], ".red.blue"],
    [
      { name: "id", in: "path", style: "matrix", explode: true },
      ["red", "blue"],
      ";id=red;id=blue",
    ],
    [
      { name: "id", in: "path", style: "matrix", explode: true },
      { role: "admin", active: true },
      ";role=admin;active=true",
    ],
    [
      { name: "X-Filter", in: "header", explode: true },
      { role: "admin", active: true },
      "role=admin,active=true",
    ],
  ] as const)("encodes fixed OpenAPI style cases %j", (p, value, expected) => {
    expect(serializeParameter(p, value)[0][1]).toBe(expected);
  });
  it("keeps repeated query keys, deep objects and reserved characters", () => {
    const op = operation({
      parameters: [
        parameter("tag", { schema: { type: "array", items: { type: "string" } } }),
        parameter("filter", { style: "deepObject", schema: { type: "object" } }),
        parameter("fields", { style: "pipeDelimited", explode: false, schema: { type: "array" } }),
      ],
    });
    const draft = initialDraft(op);
    draft.parameters = {
      "query:tag": ["red & blue", "small"],
      "query:filter": { status: "ready", min: 0 },
      "query:fields": ["name", "price"],
    };
    expect(describeRequest(context(op), draft).url).toBe(
      "https://api.example.test/v1/items?tag=red%20%26%20blue&tag=small&filter[status]=ready&filter[min]=0&fields=name|price",
    );
    expect(
      serializeParameter({ name: "path", in: "query", allowReserved: true }, "/a?b=c")[0],
    ).toEqual(["path", "/a?b=c"]);
  });
  it("distinguishes absent, empty, false, zero and null", () => {
    const op = operation({
      parameters: ["absent", "empty", "bool", "zero", "nil"].map((name) => parameter(name)),
    });
    const draft = initialDraft(op);
    draft.parameters = {
      "query:empty": "",
      "query:bool": false,
      "query:zero": 0,
      "query:nil": null,
    };
    expect(describeRequest(context(op), draft).url).toBe(
      "https://api.example.test/v1/items?empty=&bool=false&zero=0&nil=",
    );
  });
  it("replaces path fields once and preserves the server base path/query", () => {
    const op = operation({
      path: "/items/{id}",
      parameters: [parameter("id", { in: "path", required: true })],
    });
    const draft = initialDraft(op);
    draft.parameters["path:id"] = "a/b & c";
    expect(describeRequest(context(op, "https://api.example.test/v2?tenant=a"), draft).url).toBe(
      "https://api.example.test/v2/items/a%2Fb%20%26%20c?tenant=a",
    );
  });
  it("resolves and validates server variables and rejects non-HTTP destinations", () => {
    const op = operation();
    const draft = initialDraft(op);
    const ctx = {
      ...context(op),
      servers: [
        {
          url: "https://{region}.example.test/{version}",
          variables: {
            region: { default: "eu", enum: ["eu", "us"] },
            version: { default: "v2" },
          },
        },
      ],
    };
    expect(describeRequest(ctx, draft).url).toBe("https://eu.example.test/v2/items");
    draft.serverVariables.region = "bad";
    expect(describeRequest(ctx, draft).issues[0].field).toBe("server.region");
    expect(describeRequest(context(op, "javascript:alert(1)"), draft).issues).toContainEqual(
      expect.objectContaining({ field: "server" }),
    );
  });
  it("preserves OR alternatives and AND credentials, including anonymous", () => {
    const op = operation({ security: [{ Token: [], Key: [] }, {}] });
    const draft = initialDraft(op);
    const ctx = {
      ...context(op),
      securitySchemes: {
        Token: { type: "http", scheme: "bearer" },
        Key: { type: "apiKey", in: "query", name: "api_key" },
      },
    } as const;
    expect(draft.securityIndex).toBe(1);
    expect(describeRequest(ctx, draft).headers).toEqual([]);
    draft.securityIndex = 0;
    draft.auth = { Token: { value: "abc" }, Key: { value: "a b" } };
    const result = describeRequest(ctx, draft);
    expect(result.headers).toContainEqual(["Authorization", "Bearer abc"]);
    expect(result.url).toBe("https://api.example.test/v1/items?api_key=a%20b");
    expect(result.issues).toEqual([]);
  });
  it("encodes basic credentials in UTF-8", () => {
    const op = operation({ security: [{ Basic: [] }] });
    const draft = initialDraft(op);
    draft.auth.Basic = { username: "élise", password: "hello:world" };
    const result = describeRequest(
      { ...context(op), securitySchemes: { Basic: { type: "http", scheme: "basic" } } },
      draft,
    );
    expect(result.headers).toContainEqual([
      "Authorization",
      "Basic " + Buffer.from("élise:hello:world").toString("base64"),
    ]);
  });
  it("uses browser-managed cookie sessions without fabricating Cookie headers", () => {
    const op = operation({ security: [{ Session: [] }] });
    const draft = initialDraft(op);
    const ctx = {
      ...context(op),
      securitySchemes: { Session: { type: "apiKey", in: "cookie", name: "session" } },
    } as const;
    expect(describeRequest(ctx, draft).issues[0].message).toContain("browser session");
    expect(describeRequest({ ...ctx, credentials: "include" }, draft).issues).toEqual([]);
    expect(describeRequest({ ...ctx, credentials: "include" }, draft).headers).toEqual([]);
  });
  it("diagnoses forbidden headers, unsupported methods and missing values before fetch", () => {
    const op = operation({
      method: "trace",
      path: "/{id}",
      parameters: [
        parameter("id", { in: "path", required: true }),
        parameter("Host", { in: "header" }),
      ],
    });
    const draft = initialDraft(op);
    delete draft.parameters["path:id"];
    draft.parameters["header:Host"] = "other.test";
    const fields = describeRequest(context(op), draft).issues.map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(["path:id", "path", "header:Host", "method"]));
  });
  it("serializes JSON and URL-encoded bodies without losing repeated fields", () => {
    const op = operation({
      method: "post",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", properties: { ok: { type: "boolean" } } },
          },
          "application/x-www-form-urlencoded": { schema: { type: "object" } },
        },
      },
    });
    const draft = initialDraft(op);
    draft.body = { ok: false };
    expect(describeRequest(context(op), draft).body).toEqual({
      kind: "text",
      text: '{\n  "ok": false\n}',
    });
    draft.mediaType = "application/x-www-form-urlencoded";
    draft.body = { tag: ["a b", "c"], count: 0 };
    expect(describeRequest(context(op), draft).body).toEqual({
      kind: "text",
      text: "tag=a%20b&tag=c&count=0",
    });
  });
  it("validates nested required fields, enums, nulls and array entries", () => {
    expect(
      validateValue(
        {
          type: "object",
          properties: { count: { type: "integer", minimum: 1 } },
          required: ["name"],
        },
        { count: 0 },
        "body",
      ),
    ).toEqual([
      { field: "body.name", message: "This field is required." },
      { field: "body.count", message: "Minimum: 1." },
    ]);
    expect(validateValue({ type: ["string", "number"] }, 0, "mixed")).toEqual([]);
    expect(
      validateValue({ type: "array", items: { type: "string" } }, [undefined], "list")[0].field,
    ).toBe("list.0");
  });
  it("keeps read-only fields and imaginary file placeholders out of initial drafts", () => {
    const op = operation({
      method: "post",
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                id: { type: "integer", readOnly: true },
                file: { type: "string", format: "binary" },
                name: { type: "string" },
              },
            },
          },
        },
      },
    });
    expect(initialDraft(op).body).toEqual({ name: "string" });
  });
});

describe("the real HTTP boundary", () => {
  it("bounds streamed capture and identifies a partial download", async () => {
    const request = describeRequest(context(), initialDraft(operation()));
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(11 * 1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const result = await sendRequest(
      request,
      new AbortController().signal,
      (async () => response) as typeof fetch,
    );
    expect(result.blob.size).toBe(10 * 1024 * 1024);
    expect(result.truncated).toBe(true);
    expect(cancelled).toBe(true);
  });
  let server: Server, origin: string;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 500);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      res.writeHead(req.url === "/unauthorized" ? 401 : 200, {
        "Content-Type": "application/json",
        "X-Echo": "yes",
      });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  });
  afterAll(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );
  it("sends headers, encoded paths/queries and JSON exactly as described", async () => {
    const op = operation({
      method: "post",
      path: "/echo/{id}",
      parameters: [
        parameter("id", { in: "path", required: true }),
        parameter("tag", { schema: { type: "array" } }),
      ],
      security: [{ Token: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
    });
    const draft = initialDraft(op);
    draft.parameters = { "path:id": "a/b", "query:tag": ["one", "two"] };
    draft.body = { name: "O'Brien", count: 0 };
    draft.auth.Token = { value: "test-token" };
    const request = describeRequest(
      { ...context(op, origin), securitySchemes: { Token: { type: "http", scheme: "bearer" } } },
      draft,
    );
    expect(request.issues).toEqual([]);
    const response = await sendRequest(request, new AbortController().signal);
    const echo = JSON.parse(await response.blob.text());
    expect(echo).toMatchObject({
      method: "POST",
      url: "/echo/a%2Fb?tag=one&tag=two",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: '{\n  "name": "O\'Brien",\n  "count": 0\n}',
    });
    const curl = generateRequestSamples(request, ["curl"])[0].source;
    const result = await promisify(execFile)("/bin/sh", ["-c", curl]);
    expect(JSON.parse(result.stdout).body).toBe(echo.body);
    const javascript = generateRequestSamples(request, ["javascript"])[0].source;
    const execute = new Function("return (async () => {" + javascript + "; return data; })()");
    expect(JSON.parse(await execute()).body).toBe(echo.body);
    for (const sample of generateRequestSamples(request, SUPPORTED_CODE_SAMPLE_LANGS)) {
      expect(sample.source).toContain("test-token");
      expect(sample.source).toContain(origin);
    }
  });
  it("lets FormData create the boundary and sends repeated values plus real file bytes", async () => {
    const op = operation({
      method: "post",
      path: "/upload",
      requestBody: {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object" } } },
      },
    });
    const draft = initialDraft(op);
    draft.body = {
      tag: ["one", "two"],
      file: new File(["hello upload"], "hello.txt", { type: "text/plain" }),
    };
    const request = describeRequest(context(op, origin), draft);
    const init = requestInit(request);
    expect(new Headers(init.headers).has("content-type")).toBe(false);
    const response = await sendRequest(request, new AbortController().signal);
    const echo = JSON.parse(await response.blob.text());
    expect(echo.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(echo.body).toContain('name="file"; filename="hello.txt"');
    expect(echo.body).toContain("hello upload");
    expect(echo.body.match(/name="tag"/g)).toHaveLength(2);
    expect(generateRequestSamples(request, SUPPORTED_CODE_SAMPLE_LANGS)).toHaveLength(
      SUPPORTED_CODE_SAMPLE_LANGS.length,
    );
  });
  it("returns HTTP errors as responses and aborts an outstanding request", async () => {
    const request = describeRequest(
      context(operation({ path: "/unauthorized" }), origin),
      initialDraft(operation()),
    );
    expect((await sendRequest(request, new AbortController().signal)).status).toBe(401);
    const controller = new AbortController();
    const pending = sendRequest({ ...request, url: origin + "/slow" }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("local drafts", () => {
  it("persists useful fields while excluding credentials, password fields and uploads", () => {
    const op = operation({
      parameters: [
        parameter("limit", { schema: { type: "integer" } }),
        parameter("api_key"),
        parameter("password", { schema: { type: "string", format: "password" } }),
      ],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                password: { type: "string", writeOnly: true },
                file: { type: "string", format: "binary" },
              },
            },
          },
        },
      },
    });
    const data = consoleData(op),
      draft = initialDraft(op);
    draft.parameters = {
      "query:limit": 10,
      "query:api_key": "private-api-key",
      "query:password": "private-password",
    };
    draft.auth = { Auth: { value: "private-token" } };
    draft.body = { name: "example", password: "private-body", file: new Blob(["private-file"]) };
    const record = JSON.stringify(storedDraft(data, draft));
    expect(record).not.toContain("private-");
    expect(JSON.parse(record)).toMatchObject({
      parameters: { "query:limit": 10 },
      body: { name: "example" },
    });
  });
  it("ignores corrupted, expired and removed fields and survives unavailable storage", () => {
    const data = consoleData(
      operation({ parameters: [parameter("limit", { schema: { type: "integer" } })] }),
    );
    const values = new Map<string, string>();
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      removeItem: (k: string) => values.delete(k),
      setItem: (k: string, v: string) => values.set(k, v),
    };
    const draft = initialDraft(data.operation);
    draft.parameters[parameterKey(data.operation.parameters[0])] = 7;
    saveDraft(storage, "draft", data, draft);
    expect(restoreDraft(storage, "draft", data, initialDraft(data.operation))?.parameters).toEqual({
      "query:limit": 7,
    });
    values.set("draft", "bad json");
    expect(restoreDraft(storage, "draft", data, draft)).toBeUndefined();
    values.set("draft", JSON.stringify({ at: 0 }));
    expect(restoreDraft(storage, "draft", data, draft)).toBeUndefined();
    expect(() =>
      saveDraft(
        {
          setItem: () => {
            throw new Error("disabled");
          },
        },
        "draft",
        data,
        draft,
      ),
    ).toThrow("disabled");
  });
});
