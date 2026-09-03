import { redirect } from "next/navigation";

import { BrandPanel } from "@/components/brand-panel";
import { LoginForm } from "@/components/login-form";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/notebooks");

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* Clamped rather than a bare 18vh: unbounded, a very tall display grows
          the top band back into the dead space this offset exists to remove. */}
      <div className="flex flex-col justify-start px-6 pt-[min(18vh,11rem)] pb-16 sm:px-12">
        <div className="mx-auto w-full max-w-sm space-y-8">
          <p className="font-heading text-gradient-gold text-2xl">Notebook</p>

          <div className="space-y-2">
            <h1 className="font-heading text-3xl">Willkommen zurück</h1>
            <p className="text-muted-foreground">
              Melde dich mit deiner E-Mail-Adresse an, um deine Notizbücher zu öffnen.
            </p>
          </div>

          <LoginForm />
        </div>
      </div>

      <BrandPanel />
    </main>
  );
}
