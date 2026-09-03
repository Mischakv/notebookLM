import { Check } from "lucide-react";

const PROMISES = [
  "Antworten ausschließlich aus deinen eigenen Dokumenten",
  "Jede Aussage mit einem Beleg aus der Quelle",
  "DSGVO-konform",
];

/**
 * The branded half of the sign-in screen. Static markup rather than a
 * screenshot, so it stays sharp and themed. Not rendered below `lg`.
 */
export function BrandPanel() {
  return (
    <aside className="border-border bg-surface-raised relative hidden overflow-hidden border-l lg:flex lg:flex-col lg:justify-center lg:px-14">
      {/* The brand's radial glow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 size-[28rem] rounded-full"
        style={{ background: "radial-gradient(circle, #faef7014 0%, transparent 70%)" }}
      />

      <div className="relative max-w-md space-y-8">
        <p className="font-heading text-3xl leading-snug text-balance">
          Frag deine Quellen.
          <br />
          <span className="text-gradient-gold">Nicht das Internet.</span>
        </p>

        <div className="border-border bg-card shadow-elevated space-y-4 rounded-2xl border p-5">
          <p className="bg-muted ml-auto w-fit rounded-2xl px-4 py-2 text-sm">
            Wie hoch war der Umsatz in Q3?
          </p>
          <p className="text-sm leading-relaxed">
            Der Umsatz lag bei 4,2 Mio. €{" "}
            <span className="bg-primary/25 text-[#fdf5a8] rounded-md px-1.5 py-0.5 text-xs">
              1
            </span>{" "}
            und damit 12 % über dem Vorjahr{" "}
            <span className="bg-primary/25 text-[#fdf5a8] rounded-md px-1.5 py-0.5 text-xs">
              2
            </span>
            .
          </p>
          <p className="text-muted-foreground border-border border-t pt-3 text-xs">
            1 · bericht_q3.pdf, Passage 4
          </p>
        </div>

        <ul className="space-y-3">
          {PROMISES.map((promise) => (
            <li key={promise} className="flex items-start gap-3 text-sm">
              <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="text-muted-foreground">{promise}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
