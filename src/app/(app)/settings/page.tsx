import { ProviderSettings } from "@/components/provider-settings";
import { embeddingConfig } from "@/lib/llm/config";
import { FALLBACK_DAILY_LIMIT } from "@/lib/rate-limit";

export default function SettingsPage() {
  let embedding;
  try {
    embedding = embeddingConfig();
  } catch (error) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-6 py-10">
        <h1 className="font-heading text-2xl">Einstellungen</h1>
        <p className="text-destructive max-w-prose">
          {error instanceof Error
            ? error.message
            : "Die Embedding-Konfiguration ist ungültig"}
        </p>
        <p className="text-muted-foreground max-w-prose text-sm">
          Das ist ein Problem der Server-Umgebung und lässt sich hier nicht beheben.
        </p>
      </main>
    );
  }

  // Whether a fallback exists, never what it is.
  const hasServerFallback = Boolean(
    process.env.OPENROUTER_API_KEY && process.env.DEFAULT_CHAT_MODEL,
  );

  return (
    <main className="mx-auto max-w-2xl space-y-10 px-6 py-10">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl">Einstellungen</h1>
        <p className="text-muted-foreground max-w-prose">
          Für den Chat wird immer ein OpenAI-kompatibler Endpunkt verwendet. Alles, was
          dieses Protokoll spricht, funktioniert hier — OpenRouter, OpenAI, Groq,
          Together oder ein selbst betriebenes vLLM.
        </p>
      </div>

      <ProviderSettings
        strategy={embedding.strategy}
        embeddingModel={embedding.model}
        embeddingDimensions={embedding.dimensions}
        hasServerFallback={hasServerFallback}
        fallbackLimit={FALLBACK_DAILY_LIMIT}
      />
    </main>
  );
}
