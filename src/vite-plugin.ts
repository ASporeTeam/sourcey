import type { Plugin, ViteDevServer } from "vite";
import { resolve, extname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeBaseUrl } from "./site-url.js";
import { contentTypeForPath, outputPathFromRequestPath } from "./renderer/static-files.js";

export interface SourceyPluginOptions {
  /** Additional file paths to watch (specs, markdown) */
  watchPaths: string[];
  dispose?: () => void;
  /** Current public base URL, used for dev routes under subpaths. */
  baseUrl?: () => string;
  /** SSR render function: given a URL path, return HTML or null */
  render: (url: string) => Promise<{ html: string; status: number } | null>;
  /** Optional: serve generated/copied files that do not go through Vite's static handler. */
  extraFile?: (outputPath: string) => Promise<string | Buffer | undefined>;
  extraFileType?: (outputPath: string) => Promise<string | undefined>;
  responseHeaders?: (pathname: string) => Promise<Record<string, string> | undefined>;
  redirect?: (url: string) => { location: string; status: number } | undefined;
}

/**
 * Vite plugin for Sourcey.
 * - Injects SSR middleware that renders pages on the fly
 * - Watches spec and markdown files; triggers full reload on change
 */
export function sourceyPlugin(options: SourceyPluginOptions): Plugin {
  const { watchPaths, baseUrl, render, extraFile, extraFileType, responseHeaders } =
    options;

  return {
    name: "sourcey",
    closeBundle() { options.dispose?.(); },

    configureServer(server: ViteDevServer) {
      // Add spec/markdown files to Vite's watcher
      for (const p of watchPaths) {
        server.watcher.add(resolve(p));
      }

      // Return a post middleware (runs after Vite internals)
      // We use pre-middleware instead by calling server.middlewares.use directly
      // This runs BEFORE Vite's static file handler
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url ?? "/";
          const pathname = url.split("?", 1)[0] ?? "/";
          const currentBaseUrl = normalizeBaseUrl(baseUrl?.());
          const redirect = options.redirect?.(url);
          if (redirect) {
            res.writeHead(redirect.status, { Location: redirect.location });
            res.end(); return;
          }

          // Let Vite handle its own requests
          if (
            url.startsWith("/@") ||
            url.startsWith("/__vite") ||
            url.startsWith("/node_modules/") ||
            url === "/favicon.ico"
          ) {
            return next();
          }

          if (extraFile) {
            try {
              const outputPath = outputPathFromRequestPath(pathname, currentBaseUrl);
              const data = outputPath ? await extraFile(outputPath) : undefined;
              if (data !== undefined) {
                res.writeHead(200, {
                  "Content-Type":
                    (await extraFileType?.(outputPath)) ?? contentTypeForPath(outputPath),
                  "Cache-Control": "no-cache",
                  ...(await responseHeaders?.(pathname)),
                });
                res.end(data);
                return;
              }
            } catch {
              return next();
            }
          }

          // Only handle HTML page requests (no extension, or .html)
          const ext = extname(pathname);
          if (ext && ext !== ".html") {
            return next();
          }

          try {
            const result = await render(url);
            if (!result) {
              return next();
            }

            // Let Vite transform the HTML (injects HMR client script)
            const html = await server.transformIndexHtml(url, result.html);

            res.writeHead(result.status, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
              ...(await responseHeaders?.(pathname)),
            });
            res.end(html);
          } catch (e) {
            server.ssrFixStacktrace(e as Error);
            const err = e as Error;
            console.error(`  SSR error for ${url}:`, err.message);

            // Send error to Vite's native overlay via websocket
            server.ws.send({
              type: "error",
              err: { message: err.message, stack: err.stack ?? "" },
            });

            // Return a minimal page with just the HMR client so
            // the error overlay renders and livereload can recover.
            res.writeHead(500, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
            });
            res.end(
              `<!DOCTYPE html><html><head><script type="module" src="/@vite/client"></script></head><body></body></html>`,
            );
          }
        },
      );
    },
  };
}
