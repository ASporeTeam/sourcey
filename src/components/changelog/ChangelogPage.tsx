import type { ChangelogPage as ChangelogPageData } from "../../core/markdown-loader.js";
import { renderMarkdownInline } from "../../utils/markdown.js";
import { VersionCard } from "./VersionCard.js";

export function ChangelogPage({ page }: { page: ChangelogPageData }) {
  const versions = page.permalinkVersionId
    ? page.changelog.versions.filter((version) => version.id === page.permalinkVersionId)
    : page.changelog.versions;

  return (
    <div class="sourcey-changelog-page">
      <header class="sourcey-changelog-header">
        <div class="mt-0.5 space-y-2.5">
          <h1 class="text-2xl sm:text-3xl text-[rgb(var(--color-gray-900))] tracking-tight dark:text-[rgb(var(--color-gray-200))] font-bold" style="overflow-wrap: anywhere">
            {page.title}
          </h1>
        </div>
        {page.description && (
          <p
            class="sourcey-changelog-description"
            dangerouslySetInnerHTML={{ __html: renderMarkdownInline(page.description) }}
          />
        )}
      </header>

      {versions.length > 1 && (
        <details class="sourcey-changelog-jump" data-changelog-jump>
          <summary>
            <span>Jump to release</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </summary>
          <nav aria-label="Release versions">
            {versions.map((version) => (
              <a href={`#${version.id}`}>{version.version ?? "Unreleased"}</a>
            ))}
          </nav>
        </details>
      )}

      <div class="sourcey-changelog-list">
        {versions.map((version) => (
          <VersionCard key={version.id} version={version} />
        ))}
      </div>
    </div>
  );
}
