/** Prints the native `sourcey.config.ts` a converter proposes. */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ConfigValue[]
  | Call
  | Reference
  | Environment
  | { [key: string]: ConfigValue };

/** A call to an imported function, such as `markdown({...})`. */
export class Call {
  constructor(
    readonly name: string,
    readonly args: ConfigValue[],
  ) {}
}

/** A reference to an imported binding, such as a native component definition. */
export class Reference {
  constructor(readonly name: string) {}
}

/** A value the build reads from an environment variable, as the source configuration did; `part` takes one part of a URL. */
export class Environment {
  constructor(
    readonly name: string,
    readonly fallback?: string,
    readonly part?: "origin" | "pathname",
  ) {}

  print(): string {
    const read = `process.env${IDENTIFIER.test(this.name) ? `.${this.name}` : `[${JSON.stringify(this.name)}]`}`;
    const value = this.fallback === undefined ? read : `${read} ?? ${JSON.stringify(this.fallback)}`;
    if (!this.part) return value;
    return this.fallback === undefined ? `${read} && new URL(${read}).${this.part}` : `new URL(${value}).${this.part}`;
  }
}

export interface ConfigImport {
  from: string;
  names?: string[];
  default?: string;
}

export interface ConfigSource {
  imports: ConfigImport[];
  config: { [key: string]: ConfigValue };
}


export function printConfig(source: ConfigSource): string {
  const lines: string[] = [];
  for (const item of source.imports) {
    const parts = [item.default, item.names?.length ? `{ ${item.names.join(", ")} }` : undefined].filter(Boolean);
    lines.push(`import ${parts.join(", ")} from ${JSON.stringify(item.from)};`);
  }
  lines.push("", `export default defineConfig(${print(source.config, 0)});`, "");
  return lines.join("\n");
}

export function print(value: ConfigValue, depth: number): string {
  const indent = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  if (value === undefined) return "undefined";
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Reference) return value.name;
  if (value instanceof Environment) return value.print();
  if (value instanceof Call) {
    const args = value.args.map((arg) => print(arg, depth)).join(", ");
    return `${value.name}(${args})`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const inline = `[${value.map((item) => print(item, depth)).join(", ")}]`;
    if (inline.length <= 72 && !inline.includes("\n") && value.every((item) => typeof item !== "object" || item === null)) return inline;
    return `[\n${value.map((item) => `${indent}${print(item, depth + 1)},`).join("\n")}\n${close}]`;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (!entries.length) return "{}";
  const key = (name: string) => (IDENTIFIER.test(name) ? name : JSON.stringify(name));
  const inline = `{ ${entries.map(([name, item]) => `${key(name)}: ${print(item, depth)}`).join(", ")} }`;
  if (inline.length <= 72 && !inline.includes("\n") && entries.every(([, item]) => typeof item !== "object" || item === null || item instanceof Reference || item instanceof Environment))
    return inline;
  return `{\n${entries.map(([name, item]) => `${indent}${key(name)}: ${print(item, depth + 1)},`).join("\n")}\n${close}}`;
}
