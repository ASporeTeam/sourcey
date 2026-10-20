import { useContext } from "preact/hooks";
import { OptionsContext } from "../../renderer/context.js";

const targetIndexes = new WeakMap<Record<string, string>, Map<string, string[]>>();
function aliasesFor(aliases: Record<string, string> | undefined, target: string): readonly string[] {
  if (!aliases) return [];
  let index = targetIndexes.get(aliases);
  if (!index) {
    index = new Map();
    for (const [alias, section] of Object.entries(aliases)) {
      if (alias === section) continue;
      const group = index.get(section) ?? [];
      group.push(alias); index.set(section, group);
    }
    targetIndexes.set(aliases, index);
  }
  return index.get(target) ?? [];
}

/** An imported fragment stays at the section it originally identified. */
export function AnchorAliases({ target }: { target: string }) {
  const { anchorAliases } = useContext(OptionsContext);
  return <>{aliasesFor(anchorAliases, target).map(alias => <span key={alias} class="reference-anchor-alias" id={alias} aria-hidden="true" />)}</>;
}
