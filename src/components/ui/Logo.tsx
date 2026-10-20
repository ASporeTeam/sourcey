import { themePictureSources } from "../../utils/theme-picture.js";
import type { SiteConfig } from "../../renderer/context.js";
import type { SiteNavigation } from "../../core/navigation.js";
import { joinHref } from "../../site-url.js";

/** Where the logo leads: the configured link, the site's home page, or the first section. */
export function logoHref(site: SiteConfig, nav: SiteNavigation, base: string): string {
  return site.logo?.href ?? site.home ?? joinHref(base, nav.tabs[0]?.href ?? "");
}

interface LogoProps {
  href: string;
  logo?: { light?: string; dark?: string; mark?: boolean };
  name?: string;
  height?: string;
}

export function LogoImage({ light, dark, alt, className }: { light: string; dark?: string; alt: string; className?: string }) {
  return <picture data-sourcey-picture>{themePictureSources(light, dark).map(source => <source {...source} />)}<img src={light} alt={alt} class={className} /></picture>;
}

/**
 * Shared logo rendering — light/dark images with text fallback.
 * Used by both Header and mobile drawer.
 */
export function Logo({ href, logo, name, height = "h-7" }: LogoProps) {
  const label = (
    <span class="text-sm font-semibold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]">
      {name || "Docs"}
    </span>
  );
  if (!logo?.light) return <a href={href} class="sourcey-logo select-none inline-block">{label}</a>;
  // A mark is drawn with the site's name beside it; a wordmark already carries the name.
  return (
    <a href={href} class={`sourcey-logo select-none ${logo.mark ? "inline-flex items-center gap-2.5" : "inline-block"}`}>
      <LogoImage light={logo.light} dark={logo.dark} alt={logo.mark ? "" : name || "Home"} className={`w-auto ${height} object-contain block`} />
      {logo.mark && label}
    </a>
  );
}
