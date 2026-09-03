import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * AGENTS.md: "No provider SDK import outside `src/lib/llm/`." That rule is
 * load-bearing — it is what keeps provider knowledge, and therefore API keys, in
 * one auditable directory. A convention an agent *should* follow is a wish; a
 * lint error it *cannot* pass is a boundary. `no-explicit-any` is already
 * supplied by next/typescript, so it is deliberately not repeated here.
 */
const PROVIDER_SDKS = ["@ai-sdk/*", "ai", "openai", "@anthropic-ai/*"];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/llm/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: PROVIDER_SDKS,
              message:
                "No provider SDK outside src/lib/llm/ (AGENTS.md). Route handlers call chat() and embed().",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "supabase/functions/**",
    ],
  },
];

export default eslintConfig;
