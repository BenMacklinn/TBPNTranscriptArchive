import OpenAI from "openai";
import { getSupabaseAdmin, type HybridSearchRow } from "@/lib/supabase";

export const EMBEDDING_MODEL = "text-embedding-3-small";

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({ apiKey });
}

export function mergeHybridResults(resultSets: HybridSearchRow[][]) {
  const byId = new Map<string, HybridSearchRow>();

  for (const rows of resultSets) {
    for (const row of rows) {
      const existing = byId.get(row.chunk_id);
      if (!existing || row.score > existing.score) {
        byId.set(row.chunk_id, row);
      }
    }
  }

  return [...byId.values()];
}

function filterRowsToTimeWindow(
  rows: HybridSearchRow[],
  minStartSeconds?: number | null,
  maxStartSeconds?: number | null,
) {
  if (minStartSeconds == null && maxStartSeconds == null) {
    return rows;
  }

  return rows.filter((row) => {
    if (minStartSeconds != null && row.start_seconds < minStartSeconds) {
      return false;
    }
    if (maxStartSeconds != null && row.start_seconds >= maxStartSeconds) {
      return false;
    }
    return true;
  });
}

function isMissingTimeWindowRpc(error: { code?: string; message?: string }) {
  return (
    error.code === "PGRST202" ||
    (error.message?.includes("min_start_seconds") ?? false) ||
    (error.message?.includes("max_start_seconds") ?? false) ||
    (error.message?.includes("schema cache") ?? false)
  );
}

function buildHybridSearchRpcArgs(
  options: {
    queryText: string;
    queryEmbedding: number[];
    matchCount: number;
    fullTextWeight: number;
    semanticWeight: number;
    dateFrom?: string | null;
    dateTo?: string | null;
    episodeId?: string | null;
    minStartSeconds?: number | null;
    maxStartSeconds?: number | null;
  },
  matchCount = options.matchCount,
  includeTimeWindow = true,
) {
  const args: Record<string, unknown> = {
    query_text: options.queryText,
    query_embedding: options.queryEmbedding,
    match_count: matchCount,
    full_text_weight: options.fullTextWeight,
    semantic_weight: options.semanticWeight,
    date_from: options.dateFrom || null,
    date_to: options.dateTo || null,
    filter_episode_id: options.episodeId || null,
  };

  if (includeTimeWindow && options.minStartSeconds != null) {
    args.min_start_seconds = options.minStartSeconds;
  }
  if (includeTimeWindow && options.maxStartSeconds != null) {
    args.max_start_seconds = options.maxStartSeconds;
  }

  return args;
}

export async function fetchHybridResults(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  options: {
    queryText: string;
    queryEmbedding: number[];
    matchCount: number;
    fullTextWeight: number;
    semanticWeight: number;
    dateFrom?: string | null;
    dateTo?: string | null;
    episodeId?: string | null;
    minStartSeconds?: number | null;
    maxStartSeconds?: number | null;
  },
) {
  const rpcArgs = buildHybridSearchRpcArgs(options);

  const { data, error } = await supabase.rpc("hybrid_search", rpcArgs);

  if (!error) {
    return (data ?? []) as HybridSearchRow[];
  }

  const hasTimeWindow =
    options.minStartSeconds != null || options.maxStartSeconds != null;

  if (!hasTimeWindow || !isMissingTimeWindowRpc(error)) {
    throw new Error(error.message);
  }

  const fallbackMatchCount = Math.min(Math.max(options.matchCount * 4, 30), 60);
  const fallback = await supabase.rpc(
    "hybrid_search",
    buildHybridSearchRpcArgs(options, fallbackMatchCount, false),
  );

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return filterRowsToTimeWindow(
    (fallback.data ?? []) as HybridSearchRow[],
    options.minStartSeconds,
    options.maxStartSeconds,
  ).slice(0, options.matchCount);
}

export async function embedQuery(text: string) {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return Array.from({ length: 1536 }, () => 0);
  }

  const openai = getOpenAI();
  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: 1536,
  });

  return embeddingResponse.data[0]?.embedding ?? [];
}
