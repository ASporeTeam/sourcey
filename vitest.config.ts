import { configDefaults, defineConfig } from "vitest/config";

const godoc = ["test/core/godoc-*.test.ts", "test/integration/godoc-*.test.ts"];

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 20000,
    projects: [
      {
        test: {
          name: "sourcey",
          include: ["test/**/*.test.{ts,tsx,js}"],
          exclude: [...configDefaults.exclude, ...godoc],
        },
      },
      { test: { name: "godoc", include: godoc, globalSetup: ["test/godoc-global-setup.ts"] } },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx,js}"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
