import { useContext } from "preact/hooks";
import { SiteContext } from "../../renderer/context.js";
import { linkTarget } from "../../utils/html.js";

/**
 * The navbar's call to action (`navbar.primary`), shared by the header and the
 * mobile drawer. Themes restyle it through `.sourcey-primary-action`.
 */
export function PrimaryAction({ label, href, block = false }: { label: string; href: string; block?: boolean }) {
  const site = useContext(SiteContext);
  return (
    <a
      href={href}
      {...linkTarget(href, site.siteUrl)}
      class={`sourcey-primary-action ${block ? "flex w-full justify-center h-11" : "inline-flex h-8"} items-center gap-2 px-3.5 rounded-[var(--sourcey-control-radius)] text-sm font-medium whitespace-nowrap text-white bg-[rgb(var(--color-primary-dark))] hover:opacity-90`}
    >
      {label}
      <svg width="3" height="6" viewBox="0 0 3 6" aria-hidden="true" class="overflow-visible opacity-90">
        <path d="M0 0L3 3L0 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </a>
  );
}
