import OpenAI from "openai";
import {
  buildClipUrl,
  getSupabaseAdmin,
  type HybridSearchRow,
  type SearchMatch,
} from "@/lib/supabase";

const EMBEDDING_MODEL = "text-embedding-3-small";
const SUMMARY_MODEL = "gpt-4o-mini";

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({ apiKey });
}

async function summarizeMatches(rows: HybridSearchRow[]): Promise<string[]> {
  if (rows.length === 0) {
    return [];
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return rows.map((row) => row.chunk_text.slice(0, 220));
  }

  const openai = getOpenAI();
  const payload = rows.map((row, index) => ({
    index,
    episode_title: row.episode_title,
    published_at: row.published_at,
    start_time: row.start_time,
    text: row.chunk_text,
  }));

  const response = await openai.chat.completions.create({
    model: SUMMARY_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Summarize each transcript chunk in 1-2 sentences. Use only facts present in the chunk text. Return JSON: {\"summaries\": [\"...\", ...]} with one summary per input item in order.",
      },
      {
        role: "user",
        content: JSON.stringify(payload),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return rows.map((row) => row.chunk_text.slice(0, 180));
  }

  try {
    const parsed = JSON.parse(content) as { summaries?: string[] };
    if (Array.isArray(parsed.summaries) && parsed.summaries.length === rows.length) {
      return parsed.summaries;
    }
  } catch {
    // fall through
  }

  return rows.map((row) => row.chunk_text.slice(0, 180));
}

export async function runSearch(params: {
  query: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  episodeId?: string | null;
  matchCount?: number;
}) {
  const supabase = getSupabaseAdmin();
  let queryEmbedding: number[];

  if (process.env.OPENAI_API_KEY?.trim()) {
    const openai = getOpenAI();
    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: params.query,
      dimensions: 1536,
    });
    queryEmbedding = embeddingResponse.data[0]?.embedding ?? [];
  } else {
    queryEmbedding = Array.from({ length: 1536 }, () => 0);
  }

  if (queryEmbedding.length !== 1536) {
    throw new Error("Failed to generate query embedding");
  }

  const { data, error } = await supabase.rpc("hybrid_search", {
    query_text: params.query,
    query_embedding: queryEmbedding,
    match_count: params.matchCount ?? 20,
    date_from: params.dateFrom || null,
    date_to: params.dateTo || null,
    filter_episode_id: params.episodeId || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as HybridSearchRow[];
  const topRows = rows.slice(0, 8);
  const summaries = await summarizeMatches(topRows);

  const matches: SearchMatch[] = topRows.map((row, index) => ({
    episode_id: row.episode_id,
    title: row.episode_title,
    date: row.published_at,
    start_time: row.start_time,
    end_time: row.end_time,
    summary: summaries[index] ?? row.chunk_text.slice(0, 180),
    clip_url: buildClipUrl(row.youtube_video_id, row.start_seconds),
    transcript_snippet: row.chunk_text,
    score: row.score,
  }));

  return { query: params.query, matches };
}
