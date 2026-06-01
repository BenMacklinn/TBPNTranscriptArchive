import OpenAI from "openai";
import { isPineconeConfigured, queryPineconeChunks } from "@/lib/pinecone";
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

function fuseWeightedResults(
  resultSets: { rows: HybridSearchRow[]; weight: number }[],
  matchCount: number,
  rrfK: number,
) {
  const byId = new Map<string, HybridSearchRow>();

  for (const { rows, weight } of resultSets) {
    rows.forEach((row, index) => {
      const rank = index + 1;
      const existing = byId.get(row.chunk_id);
      const score = (existing?.score ?? 0) + weight * (1 / (rrfK + rank));
      byId.set(row.chunk_id, {
        ...(existing ?? row),
        score,
      });
    });
  }

  return [...byId.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.min(matchCount, 30));
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

function buildKeywordSearchRpcArgs(options: {
  queryText: string;
  matchCount: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  episodeId?: string | null;
  minStartSeconds?: number | null;
  maxStartSeconds?: number | null;
}) {
  return {
    query_text: options.queryText,
    match_count: options.matchCount,
    date_from: options.dateFrom || null,
    date_to: options.dateTo || null,
    filter_episode_id: options.episodeId || null,
    min_start_seconds: options.minStartSeconds ?? null,
    max_start_seconds: options.maxStartSeconds ?? null,
  };
}

async function fetchKeywordResults(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  options: {
    queryText: string;
    matchCount: number;
    dateFrom?: string | null;
    dateTo?: string | null;
    episodeId?: string | null;
    minStartSeconds?: number | null;
    maxStartSeconds?: number | null;
  },
) {
  const { data, error } = await supabase.rpc("keyword_search", buildKeywordSearchRpcArgs(options));
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as HybridSearchRow[];
}

type HydratedChunkRow = {
  id: string;
  episode_id: string;
  start_seconds: number;
  end_seconds: number;
  start_time: string;
  end_time: string;
  text: string;
  speaker: string | null;
  episodes:
    | {
        title: string;
        published_at: string;
        youtube_video_id: string;
        source_url: string;
      }
    | {
        title: string;
        published_at: string;
        youtube_video_id: string;
        source_url: string;
      }[]
    | null;
};

async function hydrateChunkRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  chunkIds: string[],
  scoreById: Map<string, number>,
) {
  if (chunkIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("transcript_chunks")
    .select(
      `
      id,
      episode_id,
      start_seconds,
      end_seconds,
      start_time,
      end_time,
      text,
      speaker,
      episodes!inner (
        title,
        published_at,
        youtube_video_id,
        source_url
      )
    `,
    )
    .in("id", chunkIds);

  if (error) {
    throw new Error(error.message);
  }

  const byId = new Map<string, HybridSearchRow>();
  for (const row of (data ?? []) as HydratedChunkRow[]) {
    const episode = Array.isArray(row.episodes) ? row.episodes[0] : row.episodes;
    if (!episode) {
      continue;
    }
    byId.set(row.id, {
      chunk_id: row.id,
      episode_id: row.episode_id,
      start_seconds: row.start_seconds,
      end_seconds: row.end_seconds,
      start_time: row.start_time,
      end_time: row.end_time,
      chunk_text: row.text,
      speaker: row.speaker,
      episode_title: episode.title,
      published_at: episode.published_at,
      youtube_video_id: episode.youtube_video_id,
      source_url: episode.source_url,
      score: scoreById.get(row.id) ?? 0,
    });
  }

  return chunkIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

function isZeroEmbedding(embedding: number[]) {
  return embedding.every((value) => value === 0);
}

async function fetchPineconeSemanticResults(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  options: {
    queryEmbedding: number[];
    matchCount: number;
    dateFrom?: string | null;
    dateTo?: string | null;
    episodeId?: string | null;
    minStartSeconds?: number | null;
    maxStartSeconds?: number | null;
  },
) {
  if (!isPineconeConfigured() || isZeroEmbedding(options.queryEmbedding)) {
    return [];
  }

  const topK = Math.min(Math.max(options.matchCount * 2, 30), 100);
  const matches = await queryPineconeChunks({
    vector: options.queryEmbedding,
    topK,
    filter: {
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      episodeId: options.episodeId,
      minStartSeconds: options.minStartSeconds,
      maxStartSeconds: options.maxStartSeconds,
    },
  });
  const chunkIds = matches.map((match) => match.chunkId);
  const scoreById = new Map(matches.map((match) => [match.chunkId, match.score] as const));

  return hydrateChunkRows(supabase, chunkIds, scoreById);
}

async function fetchSupabaseHybridResults(
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
  if (!isPineconeConfigured()) {
    return fetchKeywordResults(supabase, options);
  }

  const [keywordRows, semanticRows] = await Promise.all([
    fetchKeywordResults(supabase, options),
    fetchPineconeSemanticResults(supabase, options),
  ]);

  return fuseWeightedResults(
    [
      { rows: keywordRows, weight: options.fullTextWeight },
      { rows: semanticRows, weight: options.semanticWeight },
    ],
    options.matchCount,
    50,
  );
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
