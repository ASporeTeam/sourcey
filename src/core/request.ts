import { effectiveSchema, isRecord, omittedField, validateValue, type ValueIssue } from "./schema.js";
import type {
  EncodingObject,
  NormalizedOperation,
  NormalizedParameter,
  NormalizedSchema,
  SecurityScheme,
  ServerDefinition,
} from "./types.js";
import { generateExample } from "../utils/example-generator.js";

/** One request representation for the browser sender and every language sample. */
export interface RequestDraft {
  parameters: Record<string, unknown>;
  serverIndex: number;
  serverVariables: Record<string, string>;
  mediaType: string;
  body?: unknown;
  securityIndex: number;
  auth: Record<string, { value?: string; username?: string; password?: string }>;
}
export interface RequestIssue extends ValueIssue {
  browserOnly?: boolean;
}
export interface RequestDescription {
  method: string;
  url: string;
  headers: [string, string][];
  body?: { kind: "text"; text: string } | { kind: "multipart"; parts: [string, string | Blob][] };
  credentials: RequestCredentials;
  issues: RequestIssue[];
}
export interface RequestContext {
  operation: NormalizedOperation;
  servers: ServerDefinition[];
  securitySchemes: Record<string, SecurityScheme>;
  baseUrl: string;
  browserOrigin?: string;
  credentials?: RequestCredentials;
}
export const parameterKey = (p: Pick<NormalizedParameter, "in" | "name">) => p.in + ":" + p.name;
const scalar = (value: unknown) => (value === null ? "" : String(value));
const encode = (value: unknown) =>
  encodeURIComponent(scalar(value)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
const reserved = /%(?:3A|2F|3F|23|5B|5D|40|21|24|26|27|28|29|2A|2B|2C|3B|3D)/gi;
const valueEncoder = (allow?: boolean) => (value: unknown) =>
  allow ? encode(value).replace(reserved, (v) => decodeURIComponent(v)) : encode(value);

export function initialDraft(operation: NormalizedOperation): RequestDraft {
  const parameters: Record<string, unknown> = {};
  for (const p of operation.parameters) {
    const media = p.content ? Object.values(p.content)[0] : undefined;
    const namedExample = Object.values(p.examples ?? {})[0]?.value;
    const example = p.example !== undefined ? p.example : namedExample !== undefined ? namedExample : media?.example;
    const value =
      example !== undefined
        ? example
        : p.schema?.default !== undefined
          ? p.schema.default
          : p.required
            ? generateExample(p.schema ?? media?.schema ?? {}, "request")
            : undefined;
    if (value !== undefined) parameters[parameterKey(p)] = value;
  }
  const mediaType = Object.keys(operation.requestBody?.content ?? {})[0] ?? "";
  const media = operation.requestBody?.content[mediaType];
  const namedBody = Object.values(media?.examples ?? {})[0]?.value;
  const body = media?.example !== undefined ? media.example : namedBody !== undefined ? namedBody : media?.schema ? generateExample(media.schema, "request") : undefined;
  const anonymous = operation.security.findIndex((s) => Object.keys(s).length === 0);
  return {
    parameters,
    serverIndex: 0,
    serverVariables: {},
    mediaType,
    body: writableValue(body, media?.schema),
    securityIndex: anonymous >= 0 ? anonymous : 0,
    auth: {},
  };
}

export function writableValue(value: unknown, schema?: NormalizedSchema): unknown {
  if (omittedField(schema, "request") || (schema?.format === "binary" && !(value instanceof Blob)))
    return undefined;
  if (Array.isArray(value))
    return value.map((v) => writableValue(v, effectiveSchema(schema).items)).filter((v) => v !== undefined);
  if (isRecord(value)) {
    const properties = effectiveSchema(schema).properties;
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, writableValue(v, properties?.[k])])
        .filter(([, v]) => v !== undefined),
    );
  }
  return value;
}

/** Fetch-compatible, case-insensitive header combination for every projection. */
export function normalizeRequestHeaders(headers: Iterable<[string, string]>): [string, string][] {
  const combined = new Map<string, [string, string]>();
  for (const [rawName, rawValue] of headers) {
    const name = rawName.trim(), value = rawValue.trim(), key = name.toLowerCase();
    const previous = combined.get(key);
    if (previous) previous[1] += (key === "cookie" ? "; " : ", ") + value;
    else combined.set(key, [name, value]);
  }
  return [...combined.values()];
}

/** OpenAPI parameter serialization, shared by query/path/header/cookie and encoded bodies. */
export function serializeParameter(
  p: Pick<NormalizedParameter, "name" | "in" | "style" | "explode" | "allowReserved">,
  value: unknown,
): [string, string][] {
  const style = p.style ?? (p.in === "query" || p.in === "cookie" ? "form" : "simple");
  const explode = p.explode ?? style === "form";
  const enc = p.in === "header" ? scalar : valueEncoder(p.allowReserved);
  const name = p.in === "header" ? p.name : encode(p.name);
  if (style === "deepObject" && isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => {
      const keyName = name + "[" + encode(key) + "]";
      return Array.isArray(item)
        ? item.map((v) => [keyName, enc(v)] as [string, string])
        : [[keyName, enc(item)]];
    });
  }
  const separator = style === "spaceDelimited" ? "%20" : style === "pipeDelimited" ? "|" : ",";
  if (p.in === "path") {
    const join = style === "label" && explode ? "." : ",";
    let result: string;
    if (Array.isArray(value))
      result = value.map(enc).join(style === "matrix" && explode ? ";" + name + "=" : join);
    else if (isRecord(value))
      result = Object.entries(value)
        .map(([k, v]) => encode(k) + (explode ? "=" : ",") + enc(v))
        .join(style === "matrix" && explode ? ";" : join);
    else result = enc(value);
    if (style === "label") result = "." + result;
    if (style === "matrix") result = ";" + (isRecord(value) && explode ? "" : name + "=") + result;
    return [[name, result]];
  }
  if (Array.isArray(value)) {
    if (style === "form" && explode) return value.map((v) => [name, enc(v)]);
    return [[name, value.map(enc).join(separator)]];
  }
  if (isRecord(value)) {
    if (style === "form" && explode)
      return Object.entries(value).map(([k, v]) => [encode(k), enc(v)]);
    return [
      [
        name,
        Object.entries(value)
          .map(([k, v]) => enc(k) + (explode ? "=" : ",") + enc(v))
          .join(separator),
      ],
    ];
  }
  return [[name, enc(value)]];
}

function forbiddenHeader(name: string): boolean {
  return /^(accept-charset|accept-encoding|access-control-request-.+|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|via|proxy-.+|sec-.+)$/i.test(
    name,
  );
}

export function describeRequest(context: RequestContext, draft: RequestDraft): RequestDescription {
  const { operation: op } = context;
  const issues: RequestIssue[] = [];
  const headers: [string, string][] = [];
  const query: [string, string][] = [];
  let path = op.path;
  let server = context.servers[draft.serverIndex] ?? context.servers[0] ?? { url: "/" };
  server = { ...server };
  server.url = server.url.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const definition = server.variables?.[name];
    const value = draft.serverVariables[name] ?? definition?.default;
    if (value === undefined || (definition?.enum && !definition.enum.includes(value)))
      issues.push({ field: "server." + name, message: "Choose a valid server variable." });
    return value ?? "";
  });
  for (const p of op.parameters) {
    const key = parameterKey(p);
    const value = draft.parameters[key];
    if (value === undefined) {
      if (p.required) issues.push({ field: key, message: "This field is required." });
      continue;
    }
    const media = p.content ? Object.entries(p.content)[0] : undefined;
    issues.push(...validateValue(p.schema ?? media?.[1].schema, value, key));
    if (!media) {
      const styles =
        p.in === "path"
          ? ["simple", "label", "matrix"]
          : p.in === "header"
            ? ["simple"]
            : p.in === "cookie"
              ? ["form"]
              : ["form", "spaceDelimited", "pipeDelimited", "deepObject"];
      if (p.style && !styles.includes(p.style))
        issues.push({
          field: key,
          message: "This parameter uses an unsupported serialization style: " + p.style + ".",
        });
      if (
        (isRecord(value) && Object.values(value).some((v) => isRecord(v) || Array.isArray(v))) ||
        (Array.isArray(value) && value.some((v) => isRecord(v) || Array.isArray(v)))
      )
        issues.push({
          field: key,
          message:
            "Nested parameter values need an explicit content encoding in the API description.",
        });
    }
    let serialized = media
      ? [
          [
            encode(p.name),
            valueEncoder(p.allowReserved)(
              media[0].includes("json") ? JSON.stringify(value) : scalar(value),
            ),
          ] as [string, string],
        ]
      : serializeParameter(p, value);
    if (p.in === "query" || p.in === "querystring") {
      if (p.in === "querystring" && isRecord(value))
        serialized = Object.entries(value).map(([k, v]) => [encode(k), encode(v)]);
      query.push(...serialized);
    } else if (p.in === "path") {
      path = path.split("{" + p.name + "}").join(serialized[0][1]);
    } else if (p.in === "header") {
      if (/[\r\n]/.test(p.name + scalar(value)))
        issues.push({ field: key, message: "Headers cannot contain line breaks." });
      headers.push([
        p.name,
        media
          ? media[0].includes("json")
            ? JSON.stringify(value)
            : scalar(value)
          : serialized.map((x) => x[1]).join(","),
      ]);
    } else if (p.in === "cookie") {
      headers.push(["Cookie", serialized.map(([k, v]) => k + "=" + v).join("; ")]);
    }
  }
  if (/\{[^}]+\}/.test(path))
    issues.push({ field: "path", message: "Fill in every path parameter." });
  let url = "";
  try {
    const base = new URL(server.url, context.baseUrl);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error();
    const baseQuery = base.search.slice(1);
    base.pathname = base.pathname.replace(/\/$/, "") + (path.startsWith("/") ? path : "/" + path);
    base.search = "";
    base.hash = "";
    url =
      base.href +
      (baseQuery || query.length
        ? "?" +
          [baseQuery, ...query.map(([k, v]) => k + "=" + v)]
            .filter(Boolean)
            .join("&")
            .replace(/#/g, "%23")
        : "");
  } catch {
    issues.push({ field: "server", message: "Choose a valid HTTP or HTTPS server URL." });
  }
  const requirement = op.security[draft.securityIndex] ?? {};
  for (const name of Object.keys(requirement)) {
    const scheme = context.securitySchemes[name];
    const auth = draft.auth[name] ?? {};
    if (!scheme) {
      issues.push({
        field: "auth." + name,
        message: "The spec does not define this security scheme.",
      });
      continue;
    }
    if (scheme.type === "apiKey") {
      if (scheme.in === "cookie") {
        const sameOrigin =
          url && new URL(url).origin === (context.browserOrigin ?? new URL(context.baseUrl).origin);
        if (context.credentials === "omit" || (!sameOrigin && context.credentials !== "include"))
          issues.push({
            field: "auth." + name,
            message:
              "This API uses a browser session cookie. Its console must explicitly enable the appropriate browser credentials.",
            browserOnly: true,
          });
        continue;
      }
      if (!auth.value)
        issues.push({ field: "auth." + name, message: "Enter " + (scheme.name ?? name) + "." });
      if (scheme.in === "query") {
        if (auth.value)
          url +=
            (url.includes("?") ? "&" : "?") +
            encode(scheme.name ?? name) +
            "=" +
            encode(auth.value);
      } else headers.push([scheme.name ?? name, auth.value ?? ""]);
    } else if (scheme.type === "http" && scheme.scheme?.toLowerCase() === "basic") {
      if (!auth.username && !auth.password)
        issues.push({ field: "auth." + name, message: "Enter your username and password." });
      const bytes = new TextEncoder().encode((auth.username ?? "") + ":" + (auth.password ?? ""));
      headers.push([
        "Authorization",
        "Basic " + btoa(Array.from(bytes, (v) => String.fromCharCode(v)).join("")),
      ]);
    } else if (
      scheme.type === "oauth2" ||
      scheme.type === "openIdConnect" ||
      (scheme.type === "http" && scheme.scheme?.toLowerCase() === "bearer")
    ) {
      if (!auth.value) issues.push({ field: "auth." + name, message: "Enter an access token." });
      headers.push(["Authorization", "Bearer " + (auth.value ?? "")]);
    } else {
      issues.push({
        field: "auth." + name,
        message:
          "This browser console cannot perform " +
          (scheme.scheme ?? scheme.type) +
          " authentication.",
        browserOnly: true,
      });
    }
  }
  let body: RequestDescription["body"];
  const media = op.requestBody?.content[draft.mediaType];
  const bodyValue = writableValue(draft.body, media?.schema);
  if (op.requestBody?.required && bodyValue === undefined)
    issues.push({ field: "body", message: "A request body is required." });
  if (bodyValue !== undefined && media) {
    issues.push(...validateValue(media.schema, bodyValue, "body"));
    if (/^(GET|HEAD)$/i.test(op.method))
      issues.push({
        field: "body",
        message: "Browser requests cannot send a body with " + op.method.toUpperCase() + ".",
        browserOnly: true,
      });
    if (draft.mediaType.includes("multipart/form-data")) {
      if (!isRecord(bodyValue))
        issues.push({ field: "body", message: "Multipart bodies must contain named fields." });
      else body = { kind: "multipart", parts: bodyParts(bodyValue, media.encoding) };
    } else {
      const text =
        bodyValue instanceof Blob
          ? undefined
          : draft.mediaType.includes("json")
            ? // Sent as the samples show it, so a reader can read the body they copy.
              JSON.stringify(bodyValue, null, 2)
            : draft.mediaType === "application/x-www-form-urlencoded" && isRecord(bodyValue)
              ? Object.entries(bodyValue)
                  .flatMap(([name, value]) =>
                    serializeParameter({ name, in: "query", ...media.encoding?.[name] }, value),
                  )
                  .map(([k, v]) => k + "=" + v)
                  .join("&")
              : scalar(bodyValue);
      if (text === undefined)
        issues.push({ field: "body", message: "Choose multipart/form-data for file uploads." });
      else body = { kind: "text", text };
      headers.push(["Content-Type", draft.mediaType]);
    }
  }
  for (const [name, value] of headers) {
    if (forbiddenHeader(name))
      issues.push({
        field: "header:" + name,
        message: name + " is controlled by the browser. Use its session credentials instead.",
        browserOnly: true,
      });
    if (/[\r\n]/.test(name + value))
      issues.push({ field: "header:" + name, message: "Headers cannot contain line breaks." });
  }
  if (/^(CONNECT|TRACE|TRACK)$/i.test(op.method))
    issues.push({
      field: "method",
      message: "Browsers do not allow the " + op.method.toUpperCase() + " method.",
      browserOnly: true,
    });
  return {
    method: op.method.toUpperCase(),
    url,
    headers: normalizeRequestHeaders(headers),
    body,
    credentials: context.credentials ?? "same-origin",
    issues,
  };
}

function bodyParts(
  value: Record<string, unknown>,
  encoding?: Record<string, EncodingObject>,
): [string, string | Blob][] {
  return Object.entries(value).flatMap(([name, item]) => {
    const values = Array.isArray(item) && encoding?.[name]?.explode !== false ? item : [item];
    return values
      .filter((v) => v !== undefined)
      .map(
        (v) =>
          [
            name,
            v instanceof Blob ? v : isRecord(v) || Array.isArray(v) ? JSON.stringify(v) : scalar(v),
          ] as [string, string | Blob],
      );
  });
}
