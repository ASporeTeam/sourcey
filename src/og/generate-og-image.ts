import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedTheme } from "../config.js";
import { heavyBuildJob } from "../core/build-jobs.js";
import { cachedArtifacts } from "../core/artifact-cache.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontFiles = ["Inter-Regular.ttf", "Inter-Bold.ttf"].map((file) =>
  resolve(__dirname, "fonts", file),
);

export interface OgImageOptions {
  title: string;
  description?: string;
  siteName: string;
  theme: ResolvedTheme;
  logo?: string; // data URI
  /** The logo is a mark without the name, so the name shows beside it, as in the site header. */
  logoMark?: boolean;
}

const LOGO_HEIGHT = 48;
const LOGO_MAX_WIDTH = 480;

/** The size an embedded image declares in its own header, so a logo keeps its proportions. */
function imageSize(dataUri: string): { width: number; height: number } | undefined {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUri);
  if (!match) return undefined;
  const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
  const type = match[1].toLowerCase();
  if (type === "image/png" && bytes.length >= 24)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (type === "image/gif" && bytes.length >= 10)
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (type === "image/jpeg") {
    for (let i = 2; i + 9 < bytes.length && bytes[i] === 0xff; i += 2 + bytes.readUInt16BE(i + 2)) {
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
    }
    return undefined;
  }
  if (type === "image/svg+xml") {
    const root = /<svg\b[^>]*>/i.exec(bytes.toString("utf8"))?.[0];
    if (!root) return undefined;
    const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1];
    const pixels = (value?: string) => (value && /^\s*[\d.]+(?:px)?\s*$/.test(value) ? Number.parseFloat(value) : undefined);
    const box = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    const width = pixels(attribute("width")) ?? box?.[2];
    const height = pixels(attribute("height")) ?? box?.[3];
    return width && height ? { width, height } : undefined;
  }
  return undefined;
}

/** A logo LOGO_HEIGHT tall at its own proportions, narrowed to fit a long wordmark. */
function logoBox(logo: string): { width: number; height: number } {
  const size = imageSize(logo);
  if (!size) return { width: LOGO_HEIGHT, height: LOGO_HEIGHT };
  const width = Math.min(LOGO_MAX_WIDTH, Math.round((LOGO_HEIGHT * size.width) / size.height));
  return { width, height: Math.round((width * size.height) / size.width) };
}

/**
 * A logo the site names by URL, fetched once and embedded, as a local logo is.
 * The card renderer reads an image only by its exact media type, so an SVG
 * served as `image/svg+xml; charset=utf-8` would otherwise be dropped from
 * every card, and each page would fetch it again. A logo that cannot be
 * loaded leaves the cards with the coloured mark.
 */
export async function embedRemoteLogo(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!type || !["image/svg+xml", "image/png", "image/jpeg", "image/gif"].includes(type))
      throw new Error(`unsupported type ${type ?? "(none)"}`);
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Sourcey: drawing social images without the logo ${url}: ${message}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Font loading (cached across all pages)
// ---------------------------------------------------------------------------

let fontsCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

async function loadFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (fontsCache) return fontsCache;

  // Works from both src/ (dev) and dist/ (published)
  const [regular, bold] = await Promise.all([readFile(fontFiles[0]), readFile(fontFiles[1])]);

  fontsCache = {
    regular: regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength),
    bold: bold.buffer.slice(bold.byteOffset, bold.byteOffset + bold.byteLength),
  };
  return fontsCache;
}

// ---------------------------------------------------------------------------
// OG card template
// ---------------------------------------------------------------------------

function rgbCss(triplet: string): string {
  return `rgb(${triplet.replace(/ /g, ", ")})`;
}

function rgbaCss(triplet: string, alpha: number): string {
  return `rgba(${triplet.replace(/ /g, ", ")}, ${alpha})`;
}

/** A title or summary too long for the card ends at the last whole word that fits. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const fits = text.slice(0, max - 1);
  const end = /\s/.test(text[max - 1]) ? fits.length : fits.search(/\s\S*$/);
  return `${(end > 0 ? fits.slice(0, end) : fits).replace(/[\s,;:.\u2013\u2014-]+$/, "")}\u2026`;
}

type OgCardInput = Omit<OgImageOptions, "theme"> & { primary: string };
function ogCard({ title, description, siteName, primary: color, logo, logoMark }: OgCardInput) {
  const primary = rgbCss(color);
  const primaryGlow = rgbaCss(color, 0.18);

  const displayTitle = clip(title, 90);
  const displayDesc = description ? clip(description, 160) : undefined;

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "#0f172a",
        padding: "72px",
        fontFamily: "Inter",
        backgroundImage: `radial-gradient(ellipse 70% 50% at 20% 70%, ${primaryGlow}, transparent 70%)`,
      },
      children: [
        // Brand block: logo (or coloured mark) + site name, top-left
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: "14px" },
            children: [
              logo
                ? {
                    type: "img",
                    props: {
                      src: logo,
                      ...logoBox(logo),
                      style: logoMark ? { borderRadius: "8px" } : {},
                    },
                  }
                : {
                    type: "div",
                    props: {
                      style: {
                        width: "14px",
                        height: "14px",
                        backgroundColor: primary,
                        borderRadius: "4px",
                      },
                    },
                  },
              // A logo is the full wordmark, so the name is not repeated beside it.
              ...(siteName && (!logo || logoMark)
                ? [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: 28,
                          fontWeight: 700,
                          color: "#ffffff",
                          letterSpacing: "-0.02em",
                        },
                        children: siteName,
                      },
                    },
                  ]
                : []),
            ],
          },
        },
        // Middle: vertical accent bar + title + description
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flex: 1,
              alignItems: "center",
              marginTop: "48px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    width: "4px",
                    alignSelf: "stretch",
                    backgroundColor: primary,
                    borderRadius: "2px",
                    marginRight: "32px",
                  },
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column", flex: 1 },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: 64,
                          fontWeight: 700,
                          color: "#ffffff",
                          lineHeight: 1.1,
                          letterSpacing: "-0.02em",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        },
                        children: displayTitle,
                      },
                    },
                    ...(displayDesc
                      ? [
                          {
                            type: "div",
                            props: {
                              style: {
                                fontSize: 26,
                                fontWeight: 400,
                                color: "#cbd5e1",
                                marginTop: "24px",
                                lineHeight: 1.4,
                                letterSpacing: "-0.005em",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              },
                              children: displayDesc,
                            },
                          },
                        ]
                      : []),
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateOgImage(options: OgImageOptions): Promise<Buffer> {
  const card: OgCardInput = {
    title: options.title,
    description: options.description,
    siteName: options.siteName,
    primary: options.theme.colors.primary,
    logo: options.logo,
    logoMark: options.logo ? options.logoMark : undefined,
  };
  const files = await cachedArtifacts(
    "og-image",
    JSON.stringify(card),
    ["satori", "@resvg/resvg-js"],
    async () => {
      const image = await heavyBuildJob(async () => {
        const fonts = await loadFonts();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svg = await satori(ogCard(card) as any, {
          width: 1200,
          height: 630,
          embedFont: true,
          fonts: [
            { name: "Inter", data: fonts.regular, weight: 400, style: "normal" as const },
            { name: "Inter", data: fonts.bold, weight: 700, style: "normal" as const },
          ],
        });

        const resvg = new Resvg(svg, {
          fitTo: { mode: "width" as const, value: 1200 },
          // Satori embeds text outlines. Only SVG logos can need a font lookup;
          // keep that database deterministic instead of loading every host font.
          font: {
            loadSystemFonts: false,
            fontFiles,
            defaultFontFamily: "Inter",
            sansSerifFamily: "Inter",
          },
        });
        const png = resvg.render();
        return png.asPng();
      });
      return new Map([["image.png", image]]);
    },
  );
  return files.get("image.png")!;
}
