export type MigrationFramework = "astro" | "mkdocs" | "docusaurus" | "mintlify";

export interface MigrationOptions {
  framework: MigrationFramework;
  /** Project root containing the source framework configuration. */
  root: string;
  /** Prepare and verify the same change set without writing it. */
  dryRun?: boolean;
  /**
   * One-time mapping module for decisions a converter cannot infer: project
   * components, MDX element overrides, and content assembled before a build.
   */
  mapping?: string;
}

export interface SourceLocation {
  /** Project-relative path. */
  file: string;
  line?: number;
  column?: number;
}

export interface MigrationDiagnostic extends SourceLocation {
  /** `error` stops the migration. `review` is applied but needs a human decision. */
  severity: "error" | "review";
  code: string;
  message: string;
  suggestion?: string;
}

/** One file edit, applied only when the file still has the bytes it was read with. */
export interface MigrationChange {
  /** Project-relative path. */
  path: string;
  /** SHA-256 of the bytes read during preparation, or null when the file must not exist yet. */
  expectedSha256: string | null;
  /** Proposed bytes, or null to remove the file. */
  bytes: Buffer | null;
  /** Why the file changes. */
  reason: string;
}

export interface PreservedRoute {
  /** Route the source framework publishes. */
  source: string;
  /** Route the native build publishes for the same document. */
  native: string;
  /** Source file that owns the route. */
  file: string;
  /** Fragment identifiers the source publishes on this route. */
  anchors: string[];
}

export interface HostDependency {
  /** Package name. */
  name: string;
  /** Why the host still needs it, or that native builds no longer import it. */
  status: "still-used" | "unused-after-migration" | "required";
  detail: string;
}

export interface MigrationReport {
  framework: MigrationFramework;
  root: string;
  dryRun: boolean;
  applied: boolean;
  changes: MigrationChange[];
  changed: string[];
  unchanged: string[];
  routes: PreservedRoute[];
  diagnostics: MigrationDiagnostic[];
  dependencies: HostDependency[];
}
