import type { NormalizedOperation, SecurityScheme, ServerDefinition } from "./types.js";

/** What the console reads of an operation: how to call it. Its responses and prose stay on the page. */
export type ConsoleOperation = Pick<NormalizedOperation, "method" | "path" | "parameters" | "requestBody" | "security">;

export interface ConsoleData {
  operation: ConsoleOperation;
  servers: ServerDefinition[];
  securitySchemes: Record<string, SecurityScheme>;
  languages: string[];
  credentials: RequestCredentials;
  specKey: string;
  version: string;
  sourceUrl?: string;
}
