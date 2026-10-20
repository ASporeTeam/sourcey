import type { NormalizedOperation, NormalizedSpec } from "./types.js";
import { operationKey } from "./reference-identity.js";

/**
 * Reuse unchanged immutable facts, including their source-owned projections.
 * JSON order matters: field order is visible in the reference. The new snapshot
 * retains all metadata; its tags point at its canonical operation membership.
 */
export function shareReferenceSnapshot(next: NormalizedSpec, previous?: NormalizedSpec): NormalizedSpec {
  const prior = new Map(previous?.operations.map(operation => [operationKey(operation), operation]));
  const canonical = new Map<string, NormalizedOperation>();
  next.operations = next.operations.map(operation => {
    const key = operationKey(operation);
    if (canonical.has(key)) throw new Error(`Duplicate reference operation identity: ${key}`);
    const candidate = prior.get(key);
    const value = candidate && JSON.stringify(candidate) === JSON.stringify(operation) ? candidate : operation;
    canonical.set(key, value);
    return value;
  });
  for (const tag of next.tags) tag.operations = tag.operations.map(operation => {
    const key = operationKey(operation), value = canonical.get(key);
    if (!value) throw new Error(`Tag ${JSON.stringify(tag.name)} names an operation outside its reference: ${key}`);
    return value;
  });
  if (previous) for (const [name, schema] of Object.entries(next.schemas)) {
    const candidate = previous.schemas[name];
    if (candidate && JSON.stringify(candidate) === JSON.stringify(schema)) next.schemas[name] = candidate;
  }
  return next;
}
