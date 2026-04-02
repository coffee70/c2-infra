import { defineConfig, globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tailwindcss from "eslint-plugin-tailwindcss";

const tailwindConfigPath = fileURLToPath(
  new URL("./tailwind.config.cjs", import.meta.url)
);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      tailwindcss: {
        config: tailwindConfigPath,
      },
    },
  },
  ...tailwindcss.configs["flat/recommended"],
  {
    rules: {
      "tailwindcss/classnames-order": "warn",
      "tailwindcss/enforces-negative-arbitrary-values": "off",
      "tailwindcss/enforces-shorthand": "off",
      "tailwindcss/migration-from-tailwind-2": "off",
      "tailwindcss/no-arbitrary-value": "off",
      "tailwindcss/no-contradicting-classname": "off",
      "tailwindcss/no-custom-classname": "off",
      "tailwindcss/no-unnecessary-arbitrary-value": "off",
    },
  },
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
