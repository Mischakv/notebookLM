"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type Step = "email" | "code";

const RESEND_COOLDOWN_SECONDS = 30;

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode(address: string) {
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
    });
    setPending(false);

    if (sendError) {
      // The upstream message, verbatim.
      setError(sendError.message);
      toast.error(sendError.message);
      return false;
    }

    setCooldown(RESEND_COOLDOWN_SECONDS);
    return true;
  }

  async function onSendCode(event: React.FormEvent) {
    event.preventDefault();
    if (await requestCode(email)) {
      setStep("code");
      setCode("");
      toast.success(`Code an ${email} gesendet`);
    }
  }

  async function onResend() {
    if (cooldown > 0 || pending) return;
    if (await requestCode(email)) {
      toast.success(`Neuer Code an ${email} gesendet`);
      codeInput.current?.focus();
    }
  }

  async function onVerify(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    if (verifyError) {
      setPending(false);
      setError(verifyError.message);
      toast.error(verifyError.message);
      return;
    }

    // Let the server re-read the freshly set session cookie.
    router.refresh();
    router.push("/notebooks");
  }

  if (step === "email") {
    return (
      <form onSubmit={onSendCode} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium">
            E-Mail-Adresse
          </label>
          <Input
            id="email"
            type="email"
            name="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="name@firma.de"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "email-error" : undefined}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
          />
          {error && (
            <p id="email-error" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>

        <Button type="submit" size="lg" disabled={pending} className="h-11 w-full">
          {pending ? "Code wird gesendet…" : "Code senden"}
          {!pending && <ArrowRight aria-hidden />}
        </Button>

        <p className="text-muted-foreground text-sm">
          Kein Passwort nötig. Wir senden dir einen Anmeldecode per E-Mail.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={onVerify} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="code" className="block text-sm font-medium">
          Anmeldecode
        </label>
        <p className="text-muted-foreground text-sm">
          Wir haben einen Code an <span className="text-foreground">{email}</span> gesendet.
        </p>
        <Input
          id="code"
          ref={codeInput}
          // Never type="number": it strips leading zeros and shows spinners.
          type="text"
          name="code"
          required
          autoFocus
          inputMode="text"
          autoComplete="one-time-code"
          // No maxLength: the hosted project's code length is configurable and
          // is not the 6 of the local supabase/config.toml.
          placeholder="Code eingeben"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "code-error" : undefined}
          className="h-12 text-center text-lg tracking-[0.4em]"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/[^0-9]/g, ""));
            setError(null);
          }}
        />
        {error && (
          <p id="code-error" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={pending || code.length === 0}
        className="h-11 w-full"
      >
        {pending ? "Wird geprüft…" : "Anmelden"}
        {!pending && <ArrowRight aria-hidden />}
      </Button>

      {/* Always visible, never behind a disclosure: undelivered mail is this
          deployment's most common auth failure (see README). */}
      <div className="border-border bg-card/60 space-y-2 rounded-xl border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Mail className="size-4" aria-hidden />
          Keine E-Mail erhalten?
        </p>
        <p className="text-muted-foreground text-sm">
          Schau bitte auch in deinem Spam- oder Werbung-Ordner nach. Die Zustellung kann
          ein bis zwei Minuten dauern.
        </p>
        <button
          type="button"
          onClick={onResend}
          disabled={cooldown > 0 || pending}
          className="text-primary hover:underline disabled:text-muted-foreground text-sm disabled:no-underline"
        >
          {cooldown > 0 ? `Code erneut senden (${cooldown}s)` : "Code erneut senden"}
        </button>
      </div>

      <button
        type="button"
        className="text-muted-foreground hover:text-foreground w-full text-sm"
        onClick={() => {
          setStep("email");
          setCode("");
          setError(null);
        }}
      >
        Andere E-Mail-Adresse verwenden
      </button>
    </form>
  );
}
