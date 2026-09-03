import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, type ModelMessage } from "ai";

import { assertReachableBaseUrl } from "@/lib/llm/http";
import type { ResolvedChatConfig } from "@/lib/llm/config";

/**
 * The only place the app talks to a chat provider. Every provider is reached as
 * an OpenAI-compatible endpoint, which is what makes OpenRouter, OpenAI, Groq,
 * Together and a local vLLM interchangeable with a config change.
 *
 * The config is used and dropped. It is never logged and never returned.
 */
export function streamChat({
  config,
  system,
  messages,
  onError,
}: {
  config: ResolvedChatConfig;
  system: string;
  messages: ModelMessage[];
  /**
   * `textStream` ends *silently* when the provider fails — a bad key produces an
   * empty answer and no exception. This is the only way to learn that happened.
   */
  onError?: (error: unknown) => void;
}) {
  // A user-supplied baseUrl means the server makes a request wherever they say.
  // The embedding and test-connection paths guard this; the chat path runs on
  // every message, so it is the one that most needs guarding.
  assertReachableBaseUrl(config.baseUrl);

  const provider = createOpenAICompatible({
    name: "notebook",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });

  return streamText({
    model: provider.chatModel(config.model),
    system,
    messages,
    onError: onError ? ({ error }) => onError(error) : undefined,
  });
}
