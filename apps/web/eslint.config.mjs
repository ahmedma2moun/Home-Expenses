import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import boundariesPlugin from "eslint-plugin-boundaries";
import prettierConfig from "eslint-config-prettier";

const boundariesElements = [
  { type: "transport", pattern: "app/**" },
  { type: "service", pattern: "lib/services/**" },
  { type: "db", pattern: "lib/db/**" },
  { type: "ai", pattern: "lib/ai/**" },
  { type: "api-lib", pattern: "lib/api/**" },
  { type: "auth", pattern: "lib/auth/**" },
];

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "prisma/migrations/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: { boundaries: boundariesPlugin },
    settings: {
      "boundaries/elements": boundariesElements,
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            {
              from: { element: { type: "transport" } },
              disallow: { to: { element: { type: "db" } } },
              message:
                "Route handlers must not import @prisma/client directly — call a service in lib/services instead.",
            },
            {
              from: { element: { type: "service" } },
              disallow: { to: { element: { type: "transport" } } },
              message: "Services must not import next/server or route-handler code.",
            },
            {
              from: { element: { type: "transport" } },
              disallow: { to: { element: { type: "ai" } } },
              message:
                "Route handlers must not call lib/ai directly — go through a service in lib/services.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["app/**/*.ts", "lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@prisma/client", message: "Import Prisma only inside lib/db/**." },
            {
              name: "next/server",
              message: "Import next/server only inside app/** route handlers or lib/api/**.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/db/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "next/server", message: "lib/db must not depend on next/server." }] },
      ],
    },
  },
  {
    files: ["app/**/*.ts", "lib/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "@prisma/client", message: "Import Prisma only inside lib/db/**." }] },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "prisma/seed.ts", "prisma/scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["**/*.config.{ts,mts,mjs,js}"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettierConfig,
]);

export default eslintConfig;
