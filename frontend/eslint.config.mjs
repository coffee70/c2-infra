import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated vendor bundle copied from node_modules at build/dev time.
    "public/cesium/**",
    // Build helper script is a small Node CJS utility, not browser app code.
    "scripts/copy-cesium.js",
  ]),
]);

export default eslintConfig;
