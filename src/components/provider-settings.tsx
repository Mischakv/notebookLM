"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CHAT_CONFIG_KEY,
  EMBEDDING_CONFIG_KEY,
  chatProviderConfigSchema,
  clearConfig,
  embeddingProviderConfigSchema,
  readChatConfig,
  readEmbeddingConfig,
  writeConfig,
} from "@/lib/provider-config";

type Kind = "chat" | "embedding";

type Fields = {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: string;
};

const empty: Fields = { baseUrl: "", apiKey: "", model: "", dimensions: "" };

export function ProviderSettings({
  strategy,
  embeddingModel,
  embeddingDimensions,
  hasServerFallback,
  fallbackLimit,
}: {
  strategy: "local" | "external";
  embeddingModel: string;
  embeddingDimensions: number;
  hasServerFallback: boolean;
  fallbackLimit: number;
}) {
  return (
    <div className="space-y-6">
      <ConfigBlock
        kind="chat"
        title="Chat-Anbieter"
        description={
          hasServerFallback
            ? `Lass das leer, um den gemeinsamen Schlüssel zu nutzen — begrenzt auf ${fallbackLimit} Nachrichten pro Tag.`
            : "Für diese Installation ist kein gemeinsamer Schlüssel hinterlegt, du brauchst also deinen eigenen."
        }
      />

      {strategy === "external" ? (
        <ConfigBlock
          kind="embedding"
          title="Embedding-Anbieter"
          description={`Diese Installation speichert Vektoren mit ${embeddingDimensions} Dimensionen. Ein Modell mit einer anderen Breite lässt sich nicht speichern — die Dimensionen müssen übereinstimmen.`}
        />
      ) : (
        <section className="border-border bg-card space-y-2 rounded-2xl border p-5">
          <h2 className="font-medium">Embeddings</h2>
          <p className="text-muted-foreground max-w-prose text-sm">
            Diese Installation nutzt die lokale Strategie: {embeddingModel} in der
            Supabase-Edge-Runtime, {embeddingDimensions} Dimensionen, ohne Schlüssel
            und ohne Kosten. Hier gibt es nichts einzustellen. Die Dimension ist durch
            die Datenbankspalte festgelegt — die Strategie zu wechseln bedeutet, jede
            Quelle neu einzulesen.
          </p>
        </section>
      )}

      <p className="text-muted-foreground max-w-prose text-sm">
        Deine Schlüssel liegen im lokalen Speicher dieses Browsers und werden mit jeder
        Anfrage mitgeschickt, nie auf dem Server abgelegt. Das ist ein bewusster
        Kompromiss für diese Demo: Alles, was auf dieser Seite Skripte ausführen kann,
        kann sie lesen. Eine Produktivversion würde sie serverseitig und pro Person
        verschlüsselt aufbewahren.
      </p>
    </div>
  );
}

function ConfigBlock({
  kind,
  title,
  description,
}: {
  kind: Kind;
  title: string;
  description: string;
}) {
  const [fields, setFields] = useState<Fields>(empty);
  const [loaded, setLoaded] = useState(false);
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const stored =
      kind === "chat"
        ? readChatConfig()
        : readEmbeddingConfig();
    if (stored) {
      // The key is deliberately not put back into the input: it would sit in the
      // DOM for the rest of the session to no purpose. Leave the field empty and
      // reuse what is stored unless the user types a replacement.
      setStoredKey(stored.apiKey);
      setFields({
        baseUrl: stored.baseUrl,
        apiKey: "",
        model: stored.model,
        dimensions: "dimensions" in stored ? String(stored.dimensions) : "",
      });
    }
    setLoaded(true);
  }, [kind]);

  function parse() {
    const schema =
      kind === "chat" ? chatProviderConfigSchema : embeddingProviderConfigSchema;
    const apiKey = fields.apiKey || storedKey || "";
    return schema.safeParse(
      kind === "chat"
        ? { baseUrl: fields.baseUrl, apiKey, model: fields.model }
        : { ...fields, apiKey },
    );
  }

  function onSave() {
    const parsed = parse();
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    writeConfig(kind === "chat" ? CHAT_CONFIG_KEY : EMBEDDING_CONFIG_KEY, parsed.data);
    setStoredKey(parsed.data.apiKey);
    setFields({ ...fields, apiKey: "" });
    toast.success("In diesem Browser gespeichert");
  }

  function onClear() {
    clearConfig(kind === "chat" ? CHAT_CONFIG_KEY : EMBEDDING_CONFIG_KEY);
    setStoredKey(null);
    setFields(empty);
    toast.success("Aus diesem Browser entfernt");
  }

  async function onTest() {
    const parsed = parse();
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setTesting(true);
    try {
      const response = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, config: parsed.data }),
      });
      const result = (await response.json()) as
        | { ok: true; detail: string }
        | { ok: false; error: string };
      if (result.ok) toast.success(`Verbunden — ${result.detail}`);
      // The upstream message, verbatim.
      else toast.error(result.error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Der Test ist fehlgeschlagen");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="border-border bg-card space-y-4 rounded-2xl border p-5">
      <div className="space-y-1">
        <h2 className="font-medium">{title}</h2>
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      </div>

      <div className="grid gap-3">
        <Field
          label="Basis-URL"
          placeholder="https://openrouter.ai/api/v1"
          value={fields.baseUrl}
          onChange={(baseUrl) => setFields({ ...fields, baseUrl })}
        />
        <Field
          label="API-Schlüssel"
          type="password"
          placeholder={storedKey ? "Gespeichert — tippe, um ihn zu ersetzen" : "sk-…"}
          value={fields.apiKey}
          onChange={(apiKey) => setFields({ ...fields, apiKey })}
        />
        <Field
          label="Modell"
          placeholder={kind === "chat" ? "openai/gpt-4o-mini" : "text-embedding-3-small"}
          value={fields.model}
          onChange={(model) => setFields({ ...fields, model })}
        />
        {kind === "embedding" && (
          <Field
            label="Dimensionen"
            placeholder="1536"
            value={fields.dimensions}
            onChange={(dimensions) => setFields({ ...fields, dimensions })}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSave} disabled={!loaded}>
          Speichern
        </Button>
        <Button variant="outline" onClick={onTest} disabled={!loaded || testing}>
          {testing ? "Wird getestet…" : "Verbindung testen"}
        </Button>
        <Button variant="ghost" onClick={onClear} disabled={!loaded}>
          Entfernen
        </Button>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
      />
    </label>
  );
}
