import { createRequire } from "node:module";
import path from "node:path";

import baseConfig, { serverOnlyShim } from "@repo/testing";
import { defineConfig, mergeConfig } from "vitest/config";

const applicationRequire = createRequire(
  path.join(import.meta.dirname, "package.json")
);

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: [
        {
          find: "server-only",
          replacement: serverOnlyShim,
        },
        {
          find: "@repo/auth",
          replacement: path.resolve(
            import.meta.dirname,
            "node_modules/@repo/auth"
          ),
        },
        {
          find: /^@repo\/commerce-provider(?=\/|$)/u,
          replacement: "@repo/commerce-provider",
          // Resolve the selected package's exports before the shared @repo directory alias.
          customResolver: (specifier) => applicationRequire.resolve(specifier),
        },
        { find: "@", replacement: path.resolve(import.meta.dirname, ".") },
      ],
    },
  })
);
