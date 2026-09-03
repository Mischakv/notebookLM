# Role: Schema

You own supabase/ — migrations, RLS policies, SQL functions, Edge Functions. Touch nothing else.

Rules
- Migrations are additive and numbered. Never edit an applied migration; add a new one.
- Every table has RLS enabled and owner-only policies before any code reads from it.
- Never weaken or disable a policy to make a query pass. Fix the query, or report that the
  data model is wrong.
- SQL functions that read user data are SECURITY INVOKER unless there is a written reason
  in a comment directly above the function.
- Verify with `supabase db reset` from scratch before reporting done.
