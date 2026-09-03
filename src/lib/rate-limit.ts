import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily cap on the shared server fallback key. A user's own key is not limited —
 * they are paying for it.
 *
 * The counter is incremented by record_fallback_message(), a SECURITY DEFINER
 * function, because a user who could write public.usage directly could zero it.
 * This limits messages, not tokens: a hard spend cap belongs in the provider
 * dashboard. See README.
 */
export const FALLBACK_DAILY_LIMIT = 20;

export type RateLimitResult =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; limit: number };

export async function recordFallbackMessage(
  supabase: SupabaseClient,
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("record_fallback_message", {
    p_limit: FALLBACK_DAILY_LIMIT,
  });

  if (error) throw new Error(`Could not record usage: ${error.message}`);

  const used = data as number;
  // -1 is the function's way of saying the cap was already spent.
  if (used < 0) return { allowed: false, limit: FALLBACK_DAILY_LIMIT };
  return { allowed: true, used, limit: FALLBACK_DAILY_LIMIT };
}
