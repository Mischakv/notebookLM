import { NextResponse } from "next/server";
import { z } from "zod";

import { testConnection } from "@/lib/llm/test-connection";
import {
  chatProviderConfigSchema,
  embeddingProviderConfigSchema,
} from "@/lib/provider-config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The config arrives in the body rather than the x-provider-config header: here
 * it is the subject of the request, not the credentials for it. Either way it is
 * used and dropped — never logged, never echoed back.
 */
const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), config: chatProviderConfigSchema }),
  z.object({ kind: z.literal("embedding"), config: embeddingProviderConfigSchema }),
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fields = Object.keys(z.flattenError(parsed.error).fieldErrors).join(", ");
    return NextResponse.json(
      { ok: false, error: `Invalid configuration. Check: ${fields || "all fields"}` },
      { status: 400 },
    );
  }

  return NextResponse.json(await testConnection(parsed.data));
}
