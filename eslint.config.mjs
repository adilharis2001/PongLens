import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      ".worktrees/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  // Money moves through one seam. Only src/lib/payments may import the
  // stripe package — everything else asks the gateway, which is what
  // keeps the QA test-billing bypass (092) airtight as new payment
  // surfaces get built. stripeImports.test.ts enforces the same rule.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/payments/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "stripe",
              message:
                "Payment code goes through src/lib/payments (gateway.ts) " +
                "so billing_mode routing can't be bypassed.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
