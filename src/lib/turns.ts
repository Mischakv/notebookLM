import type { Citation, Message, RetrievedChunk } from "@/lib/types";

/**
 * Turn state for the chat panel: how a streamed answer and a stored one become
 * the same thing, and how [n] resolves to a passage.
 *
 * Extracted from the component because this is the join between what the model
 * said and what the reader sees when they click a citation. It broke twice in
 * ways a type checker cannot catch, so it is pure and tested.
 */

export type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  /** Chunks retrieved for this turn, so [n] stays clickable while streaming. */
  chunks?: RetrievedChunk[];
};

/** True for a turn created optimistically by the client, not yet stored. */
export function isOptimistic(turn: Turn): boolean {
  return turn.id.startsWith("pending-") || turn.id.startsWith("q-pending-");
}

export function toTurn(message: Message): Turn {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    citations: message.citations,
  };
}

/**
 * Merges the server's messages with whatever the client is still streaming.
 *
 * A streamed turn keeps a temporary `pending-<time>` id for its whole life — it
 * is never swapped for the real `messages.id`. So when the page re-runs (any
 * router.refresh(), including the one the source rail fires after an ingest),
 * the server's rows arrive while the optimistic copies are still in state.
 *
 * Without reconciliation the conversation duplicates, and the duplicate is the
 * harmful half: the stored copy has `citations` but no `chunks`, so two turns
 * exist for one exchange and a [n] can be answered by the wrong turn's array.
 * That is the "second answer opens the first answer's passage" bug.
 *
 * Server rows win — they are durable and self-describing. Only turns the server
 * has not stored yet are kept, appended after them.
 */
export function reconcileTurns(previous: Turn[], messages: Message[]): Turn[] {
  const persisted = messages.map(toTurn);
  if (persisted.length === 0) return previous;

  // Counted, not set-membership. Keying on `role:content` alone collapsed a
  // repeated exchange: asking the same question twice stores four rows but only
  // two distinct keys, so the second exchange was treated as already-rendered
  // and dropped from the transcript. Counting how many of each key the server
  // holds, and consuming one per optimistic turn, keeps duplicates distinct.
  const remaining = new Map<string, number>();
  for (const turn of persisted) {
    const key = `${turn.role}:${turn.content}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const stillInFlight = previous.filter((turn) => {
    if (!isOptimistic(turn)) return false;
    const key = `${turn.role}:${turn.content}`;
    const count = remaining.get(key) ?? 0;
    // This optimistic turn is accounted for by a server row — drop it and spend
    // that row, so a second identical turn is not also considered stored.
    if (count > 0) {
      remaining.set(key, count - 1);
      return false;
    }
    return true;
  });

  return [...persisted, ...stillInFlight];
}

/**
 * The chunk that [n] opens, for one turn.
 *
 * A stored citation carries its own `n`, so the lookup is right by construction.
 * The live `chunks` array is resolved by *position*, which only holds while the
 * array belongs to the turn being rendered — fragile as soon as turns are
 * rebuilt from the server, because `toTurn` does not carry `chunks` across.
 *
 * So the two are not ranked, they are exclusive: a turn that has been stored is
 * answered from its citations alone, and a turn that has not is answered from
 * position. Ranking them is what let an unresolvable [n] on a stored turn reach
 * the positional array and open a passage from a different exchange.
 */
export function chunkFor(turn: Turn, n: number): RetrievedChunk | null {
  // Once a turn has been stored, its citations are the *whole* answer to "what
  // does [n] open" — including the answer "nothing". `resolveCitations` returns
  // an empty array, not null, when it resolved none, and an out-of-range [n] is
  // dropped there deliberately. Falling through to the positional `chunks` array
  // in either case re-opens the very hole the keyed record exists to close: it
  // would hand back whatever chunk happens to sit at that index, which for a
  // reconciled turn can belong to a different exchange entirely.
  //
  // So the positional fallback is only for a turn the server has not stored yet.
  if (turn.citations !== null && turn.citations !== undefined) {
    const persisted = turn.citations.find((citation) => citation.n === n);
    return persisted ? toRetrieved(persisted) : null;
  }

  return turn.chunks?.[n - 1] ?? null;
}

function toRetrieved(persisted: Citation): RetrievedChunk {
  return {
    id: persisted.chunk_id,
    content: persisted.content,
    source_id: persisted.source_id,
    source_title: persisted.source_title,
    idx: persisted.idx,
    similarity: 0,
  };
}
