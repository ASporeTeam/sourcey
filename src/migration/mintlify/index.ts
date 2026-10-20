/**
 * `sourcey migrate mintlify`: a Mintlify `docs.json` project becomes a
 * standalone native Sourcey project. Pages keep their paths as URLs; most of
 * Mintlify's components are native already, and navigation, theme basics,
 * navbar, footer and redirects are converted once.
 */
import { posix } from "node:path";
import type { IconSet, NavbarLink } from "../../config.js";
import { hasIcon } from "../../utils/icons.js";
import type { ConfigValue } from "../config-writer.js";
import { counted, type Diagnostics } from "../diagnostics.js";
import { navbarLink, navbarOption, networkOf, placeUnlisted } from "../navigation.js";
import { markdownSource, type FrameworkMigration, type NativePlan, type PlannedDocument } from "../plan.js";
import type { ProjectFiles } from "../project-files.js";
import { siteFileUrls } from "../site-files.js";
import { readFrontmatter } from "../text-edits.js";
import { MINTLIFY_GLOBALS } from "./components.js";
import { prepareReference, REFERENCE_FILES, takeReferenceSection } from "./reference.js";
import { convertNavigation, type MintlifyPage } from "./navigation.js";

type Node = Record<string, unknown>;

/** Frontmatter native carries some other way. */
const CONSUMED = ["sidebarTitle", "hidden"];
/** Frontmatter with no native equivalent; removed and named in the report. */
const UNCARRIED = ["icon", "iconType", "tag", "keywords", "noindex", "public", "groups", "deprecated", "og:image", "og:title", "og:description", "twitter:image"];
/**
 * Mintlify's page modes as native layouts: `custom` and `center` draw the page
 * without its sidebar, as native's `page` does; `wide` and `frame` keep the
 * sidebar, so the page stays documentation.
 */
const MODES: Record<string, { layout?: "page"; review?: string }> = {
  default: {},
  custom: { layout: "page" },
  center: { layout: "page", review: "mode: center is drawn as page, full width rather than in a centred column" },
  wide: { review: "mode: wide hides the contents list; native lists a page's sections beside it" },
  frame: { review: "mode: frame keeps the sidebar and is drawn as documentation, with its contents list" },
};
/** `docs.json` settings with no native equivalent, and why that is fine or what to do. */
const UNCARRIED_SETTINGS: Record<string, string> = {
  theme: "the Mintlify theme is replaced by Sourcey's",
  background: "native themes set their own background",
  styling: "native themes style code blocks and eyebrows themselves",
  thumbnails: "native pages generate their own social images",
  contextual: "native pages offer their own copy and Markdown exports",
  integrations: "analytics and chat integrations are not carried over",
  seo: "native pages set their own metadata",
  search: "native search replaces it",
  banner: "the banner is not carried over",
  errors: "native publishes its own 404 page",
};
/** An icon Mintlify draws from Font Awesome's brands. */
const BRANDS = /\biconType=["']brands["']/;
const MAPPED = new Set(["$schema", "name", "colors", "appearance", "logo", "favicon", "fonts", "icons", "navigation", "navbar", "footer", "redirects", "api", "description"]);

export async function prepareMintlify(project: ProjectFiles, diagnostics: Diagnostics): Promise<FrameworkMigration> {
  if (!(await project.exists("docs.json"))) {
    const legacy = await project.exists("mint.json");
    diagnostics.error({
      file: legacy ? "mint.json" : "docs.json",
      code: "mintlify",
      message: legacy ? "mint.json is Mintlify's earlier configuration" : "No docs.json found in the project root",
      suggestion: legacy ? "Upgrade it to docs.json with Mintlify's own CLI first, then migrate." : undefined,
    });
    return { plans: [], dependencies: [] };
  }
  const config = JSON.parse(await project.readText("docs.json")) as Node;
  const fail = (message: string) => diagnostics.error({ file: "docs.json", code: "mintlify", message });
  const review = (message: string) => diagnostics.review({ file: "docs.json", code: "mintlify", message });
  for (const [key, why] of Object.entries(UNCARRIED_SETTINGS)) if (config[key] !== undefined) review(`${key}: ${why}`);
  for (const key of Object.keys(config)) if (!MAPPED.has(key) && !UNCARRIED_SETTINGS[key]) fail(`Setting "${key}" has no native conversion`);
  const icons = iconSet(config.icons, fail, review);

  // Mintlify serves every Markdown page under the docs root at its path, listed or not; snippets are partials.
  const files = await project.list(".", (path) => /\.mdx?$/.test(path) && !/^(snippets|node_modules)\//.test(path));
  const pages = new Map<string, MintlifyPage & { file: string; frontmatter: Record<string, unknown> }>();
  // Brand icons draw from Font Awesome's package, which the project then needs.
  let brands = false;
  for (const file of files) {
    const path = file.replace(/\.mdx?$/, "");
    const text = await project.readText(file);
    brands ||= BRANDS.test(text);
    const frontmatter = readFrontmatter(text).data;
    pages.set(path, {
      file,
      frontmatter,
      reference: path.replace(/(^|\/)index$/, "") || "index",
      label: typeof frontmatter.sidebarTitle === "string" ? frontmatter.sidebarTitle : typeof frontmatter.title === "string" ? frontmatter.title : undefined,
      ...(typeof frontmatter.url === "string" ? { url: frontmatter.url } : {}),
      ...(typeof frontmatter.openapi === "string" ? { operation: frontmatter.openapi } : {}),
    });
  }
  const route = (path: string) => `/${path.replace(/(^|\/)index$/, "")}`;
  const dialect = { fragments: "github" as const, mdx: true, globals: MINTLIFY_GLOBALS, fenceTitles: true };
  // Pages Mintlify generates from API operations become a native reference tab.
  const operations = [...pages.values()].flatMap((page) => (page.operation ? [{ file: page.file, reference: page.reference, operation: page.operation, frontmatter: page.frontmatter }] : []));
  const reference = operations.length ? await prepareReference(project, config, operations, { dialect, route, fail, review }) : undefined;
  const navigation = convertNavigation((config.navigation ?? {}) as Node, pages, route, fail, reference?.entry);
  const section = reference && takeReferenceSection(navigation.groups, navigation.sets);
  if (reference && !section && navigation.listed.size && operations.some((page) => navigation.listed.has(page.reference)))
    fail("Mintlify's API pages are spread over several navigation sets; native gives the reference one section of the navigation");
  // Pages the reference's navigation links, and stale API pages, stay documentation pages, loaded by its tab.
  placeUnlisted(navigation.groups, [...new Set([...(section?.pages ?? []), ...(reference?.stale ?? [])])]);
  if (navigation.missing.length)
    review(`docs.json lists ${counted(navigation.missing.length, "page")} with no file, which Mintlify left out and so does native navigation: ${navigation.missing.slice(0, 3).join(", ")}${navigation.missing.length > 3 ? ", ..." : ""}`);
  // The reference's set is its own tab; the other sets share the documentation's sidebar.
  const sections = navigation.sections.filter((name) => name !== section?.label);
  if (sections.length) review(`Navigation sets ${sections.join(", ")} become sections of one sidebar: the navigation is reorganised, and every page keeps its URL`);
  const published = [...pages.values()].filter((page) => !page.url && (!page.operation || reference?.stale.has(page.reference))).map((page) => ({ page, reference: page.reference, path: page.reference }));
  const markdown = markdownSource(".", navigation.groups, published);

  const documents: PlannedDocument[] = published.map((entry) => {
    const { page } = entry;
    const data = page.frontmatter;
    const set: Record<string, string | boolean> = {};
    const slug = markdown.slugs.get(entry);
    if (slug) set.slug = slug;
    // Mintlify titles a page from `title`, else its sidebar title.
    if (typeof data.title !== "string" && typeof data.sidebarTitle === "string") set.title = data.sidebarTitle;
    else if (typeof data.sidebarTitle === "string" && data.sidebarTitle !== data.title) set.navTitle = data.sidebarTitle;
    if (data.hidden === true) set.hideInMenu = true;
    if (data.mode !== undefined) {
      const mode = MODES[String(data.mode)];
      if (!mode) diagnostics.error({ file: page.file, code: "mintlify-frontmatter", message: `mode: ${String(data.mode)} is not a Mintlify page mode` });
      if (mode?.layout) set.layout = mode.layout;
      if (mode?.review) diagnostics.review({ file: page.file, code: "mintlify-frontmatter", message: mode.review });
    }
    const uncarried = UNCARRIED.filter((key) => data[key] !== undefined);
    if (uncarried.length) diagnostics.review({ file: page.file, code: "mintlify-frontmatter", message: `Frontmatter ${uncarried.join(", ")} has no native equivalent and is removed` });
    const documentRoute = route(page.reference === "index" ? "index" : page.reference);
    return {
      file: page.file,
      route: documentRoute,
      dialect: { ...dialect, mdx: page.file.endsWith(".mdx") },
      // Mintlify serves the docs root at the site root, so `/images/x.png` names a project file.
      after: (text) => siteFileUrls(text, { file: page.file, route: documentRoute, root: ".", exists: (path) => project.exists(path) }),
      frontmatter: { set, remove: [...CONSUMED, ...uncarried, "openapi", "mode"].filter((key) => data[key] !== undefined) },
    };
  });
  const partials = await snippetDocuments(project, published.map((entry) => entry.page.file), dialect);
  for (const partial of partials) brands ||= BRANDS.test(await project.readText(partial.file));
  review("Mintlify keeps the path it serves the docs at in its dashboard; set siteUrl and baseUrl if they are served below a site's root");

  const brand = await brandOptions(project, config, review);
  const native: Record<string, ConfigValue> = {
    name: typeof config.name === "string" ? config.name : "",
    ...brand,
    ...(icons === "lucide" ? { theme: { ...(brand.theme as Record<string, ConfigValue> | undefined), icons } } : {}),
    prettyUrls: "strip",
    ...navbarOptions(config.navbar, review),
    ...footerOptions(config.footer, review),
    navigation: { tabs: [{ ...(reference ? { id: "docs" } : {}), tab: "Documentation", slug: "", source: markdown.source }, ...(reference ? [reference.tab(section?.label || "API", section?.navigation ?? [])] : [])] },
    ...redirectOptions(config.redirects, reference?.redirects),
  };
  const plan: NativePlan = {
    configDir: ".",
    config: { imports: [{ from: "sourcey", names: ["defineConfig", "markdown", ...(reference ? ["openapi"] : [])] }, ...(reference?.imports.filter((item) => section?.navigation.length || item.default !== "apiNavigation") ?? [])], config: native },
    documents,
    partials,
    routes: reference?.routes ?? [],
    files: new Map([
      ...(reference?.files ?? []),
      ...(section?.navigation.length ? [[REFERENCE_FILES.navigation, { bytes: `${JSON.stringify(section.navigation, null, 2)}\n`, reason: "Mintlify's API navigation, by operation" }] as const] : []),
    ]),
    ...(icons === "lucide" ? { icons } : {}),
  };
  return {
    plans: [plan],
    dependencies: [
      { name: "sourcey", status: "required", detail: "Install it to build the native project; Mintlify's hosting and CLI are no longer used." },
      ...(icons === "lucide" ? [{ name: "lucide-static", status: "required" as const, detail: "The project's icons are Lucide (theme.icons)." }] : []),
      ...(brands ? [{ name: "@fortawesome/fontawesome-free", status: "required" as const, detail: "Pages draw Font Awesome brand icons (brand:<name>)." }] : []),
    ],
  };
}

/** The Markdown snippets pages import or `<Snippet>`, and the snippets those use, converted as partials. */
async function snippetDocuments(project: ProjectFiles, pages: string[], dialect: PlannedDocument["dialect"]): Promise<PlannedDocument[]> {
  const snippets = new Set<string>();
  const queue = [...pages];
  while (queue.length) {
    for (const match of (await project.readText(queue.pop()!)).matchAll(/from\s+["']\/?(snippets\/[^"']+\.mdx?)["']|<Snippet\b[^>]*\bfile=["']([^"']+\.mdx?)["']/g)) {
      const file = match[1] ?? `snippets/${match[2]}`;
      if (snippets.has(file) || !(await project.exists(file))) continue;
      snippets.add(file);
      queue.push(file);
    }
  }
  return [...snippets].sort().map((file) => {
    const route = `/${file.replace(/\.mdx?$/, "")}`;
    return {
      file,
      route,
      dialect: { ...dialect, mdx: file.endsWith(".mdx") },
      after: (text: string) => siteFileUrls(text, { file, route, root: ".", exists: (path) => project.exists(path) }),
      frontmatter: { set: {}, remove: [] },
    };
  });
}

/** Mintlify's icon library as the native set: Lucide is one; Font Awesome, Mintlify's default, is not. */
function iconSet(icons: unknown, fail: (message: string) => void, review: (message: string) => void): IconSet {
  const library = (icons as { library?: string } | undefined)?.library ?? "fontawesome";
  if (library !== "lucide") {
    if (icons !== undefined) review(`icons: ${library} has no native set; native draws Heroicons, and card icons Heroicons lacks are reported where used`);
    return "heroicons";
  }
  try {
    hasIcon("lucide", "info");
  } catch (error) {
    fail((error as Error).message);
  }
  return "lucide";
}

/** Colours, appearance, logo and favicon. Mintlify paths are relative to the docs root. */
async function brandOptions(project: ProjectFiles, config: Node, review: (message: string) => void): Promise<Record<string, ConfigValue>> {
  const local = async (path: unknown) => {
    if (typeof path !== "string") return undefined;
    const file = posix.normalize(path.replace(/^\/+/, ""));
    if (await project.exists(file)) return `./${file}`;
    review(`${path} is not in the project and is not carried over`);
    return undefined;
  };
  const colors = (config.colors ?? {}) as { primary?: string; light?: string; dark?: string };
  const appearance = (config.appearance ?? {}) as { default?: string };
  // Mintlify draws text in Inter, as native does, unless `fonts` names a family (for body text, or for all).
  type Font = { family?: string; source?: string };
  const fonts = (config.fonts ?? {}) as Font & { body?: Font };
  const body = fonts.body?.family ? fonts.body : fonts;
  if (body.source) review(`Fonts: "${body.family}" is served from ${body.source}, which native loads from Google Fonts; to keep serving yours, set theme.fonts.google: false and add an @font-face rule to a theme.css stylesheet`);
  const theme: Record<string, ConfigValue> = {
    ...(appearance.default === "light" || appearance.default === "dark" ? { appearance: { default: appearance.default } } : {}),
    ...(colors.primary ? { colors: { primary: colors.primary, ...(colors.light ? { light: colors.light } : {}), ...(colors.dark ? { dark: colors.dark } : {}) } } : {}),
    ...(body.family ? { fonts: { sans: body.family } } : {}),
  };
  const logo = config.logo as string | { light?: string; dark?: string; href?: string } | undefined;
  const light = await local(typeof logo === "string" ? logo : logo?.light);
  const dark = typeof logo === "object" ? await local(logo.dark) : undefined;
  const href = typeof logo === "object" && logo.href && logo.href !== "/" ? logo.href : undefined;
  return {
    ...(light ? { logo: dark || href ? { light, ...(dark ? { dark } : {}), ...(href ? { href } : {}) } : light } : {}),
    ...(config.favicon ? { favicon: await local(config.favicon) } : {}),
    ...(Object.keys(theme).length ? { theme } : {}),
  };
}

/** Navbar links and the primary button; a GitHub primary becomes the GitHub link. */
function navbarOptions(navbar: unknown, review: (message: string) => void): Record<string, ConfigValue> {
  const value = (navbar ?? {}) as { links?: { label?: string; href?: string }[]; primary?: { type?: string; label?: string; href?: string } };
  const links: NavbarLink[] = (value.links ?? []).filter((link) => link.href).map((link) => navbarLink(networkOf(link.href!), link.href!, link.label));
  const primary = value.primary;
  if (primary?.type === "github" && primary.href) links.push(navbarLink("github", primary.href));
  else if (primary && primary.type !== "button") review(`The navbar's primary ${primary.type} is not carried over`);
  const button = primary?.type === "button" && primary.href ? { primary: { type: "button", label: primary.label ?? "", href: primary.href } } : {};
  const option = navbarOption(links);
  return option || Object.keys(button).length ? { navbar: { ...((option as Record<string, ConfigValue> | undefined) ?? {}), ...button } } : {};
}

/** Footer socials keep their network; link columns flatten into the same row. */
function footerOptions(footer: unknown, review: (message: string) => void): Record<string, ConfigValue> {
  const value = (footer ?? {}) as { socials?: Record<string, string>; links?: { header?: string; items?: { label?: string; href?: string }[] }[] };
  const links: NavbarLink[] = [
    // A network native has no icon for keeps its name as the label.
    ...Object.entries(value.socials ?? {}).map(([network, href]) => navbarLink(network, href, network.charAt(0).toUpperCase() + network.slice(1).replace(/-/g, " "))),
    ...(value.links ?? []).flatMap((column) => column.items ?? []).filter((item) => item.href).map((item) => navbarLink(networkOf(item.href!), item.href!, item.label)),
  ];
  if (value.links?.some((column) => column.header)) review("Footer column headers are not carried over; their links join one row");
  return links.length ? { footer: { links: links as unknown as ConfigValue } } : {};
}

/** Mintlify redirects: permanent unless they say otherwise. */
function redirectOptions(redirects: unknown, pages: Record<string, string> = {}): Record<string, ConfigValue> {
  const entries = (redirects ?? []) as { source: string; destination: string; permanent?: boolean }[];
  const all = { ...Object.fromEntries(entries.map((entry) => [entry.source, entry.permanent === false ? { to: entry.destination, status: 307 } : entry.destination])), ...pages };
  return Object.keys(all).length ? { redirects: all } : {};
}
