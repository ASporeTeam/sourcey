import type { NormalizedOperation, SecurityScheme, ServerDefinition } from "./types.js";

export interface ConsoleData {
  operation: NormalizedOperation;
  servers: ServerDefinition[];
  securitySchemes: Record<string, SecurityScheme>;
  languages: string[];
  credentials: RequestCredentials;
  specKey: string;
  version: string;
  sourceUrl?: string;
}
