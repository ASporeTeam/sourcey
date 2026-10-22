// Build Sourcey's own scripts and styles for every theme into dist, so a site's build only reads them.
process.env.NODE_ENV = "production";
const { prebuildEngineAssets } = await import("../dist/renderer/assets.js");
await prebuildEngineAssets();
