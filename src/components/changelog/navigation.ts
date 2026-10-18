import type { SiteNavGroup, SiteNavigation } from "../../core/navigation.js";
import type { CurrentPage } from "../../renderer/context.js";

/** A tab containing only its changelog uses the left rail for releases. */
export function changelogNavigation(page: CurrentPage, navigation: SiteNavigation) {
  if (page.kind !== "changelog") return null;
  const tab = navigation.tabs.find((item) => item.slug === navigation.activeTabSlug);
  const pages = tab?.groups.flatMap((group) => group.items) ?? [];
  if (pages.length !== 1) return null;

  const versions = page.changelog.changelog.versions;
  if (!versions.length) return null;
  const groups: SiteNavGroup[] = [{
    label: "Releases",
    items: versions.map((version) => ({
      id: version.id,
      label: version.version ?? "Unreleased",
      href: `${pages[0].href}#${version.id}`,
    })),
  }];
  return {
    groups,
    activeId: page.changelog.permalinkVersionId ?? versions[0]?.id ?? "",
  };
}
