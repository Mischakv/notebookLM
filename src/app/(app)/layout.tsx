import Link from "next/link";
import { redirect } from "next/navigation";

import { NavLink } from "@/components/nav-link";
import { UserMenu } from "@/components/user-menu";
import { createClient } from "@/lib/supabase/server";

/**
 * The protected route group. Every page under (app) is behind this check;
 * RLS is the real boundary, this is the redirect that makes it pleasant.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-border bg-card sticky top-0 z-30 flex shrink-0 items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex items-center gap-8">
          <Link href="/notebooks" className="font-heading text-gradient-gold text-lg">
            Notebook
          </Link>
          <nav className="flex items-center gap-6">
            <NavLink href="/notebooks">Notizbücher</NavLink>
            <NavLink href="/settings">Einstellungen</NavLink>
          </nav>
        </div>
        <UserMenu email={user.email ?? ""} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
