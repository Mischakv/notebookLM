import { z } from "zod";

/**
 * Public Supabase config. Validated once at module load so a missing value is a
 * clear startup error rather than an undefined-shaped failure deep in a client.
 *
 * Both must be `NEXT_PUBLIC_*`: they are read in the browser, and Next only
 * inlines variables with that prefix. That is fine — neither is a secret. RLS is
 * the security boundary, not the key. The app never uses a service-role or
 * `sb_secret_*` key anywhere, deliberately — such a key bypasses RLS entirely, so a single
 * careless query with it would hand one user another user's rows.
 *
 * Supabase issues the client key under two names depending on the project's age:
 * the older `anon` JWT and the newer `sb_publishable_*`. Either works, and either
 * variable name is accepted, so a project on the new key system does not need the
 * value filed under a name that no longer matches its dashboard.
 *
 * The `process.env.X` reads below are deliberately literal: Next inlines them at
 * build time by matching the source text, so a computed lookup returns undefined.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (!parsed.success) {
  // A raw ZodError here surfaces as a stack trace in the middle of a build, which
  // tells someone cloning the repo nothing. Say what is missing and where to get it.
  const problems = Object.entries(z.flattenError(parsed.error).fieldErrors)
    .map(([field, errors]) => {
      const name =
        field === "NEXT_PUBLIC_SUPABASE_ANON_KEY"
          ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)"
          : field;
      return `  ${name}: ${errors?.join(", ")}`;
    })
    .join("\n");

  throw new Error(
    `Supabase environment is not configured.\n${problems}\n\n` +
      "Copy .env.example to .env.local and fill these in. `pnpm supabase start` prints both values " +
      "for a local stack; a hosted project has them under Project Settings > API.",
  );
}

export const publicEnv = parsed.data;
