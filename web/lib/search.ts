import { enrichMatchReasonsWithLlm } from "@/lib/match-reasons";
import { getEpisodeShowDatesByVideoIds } from "@/lib/guest-catalog";
import { runGuestTopicSearch } from "@/lib/guest-search";
import {
  embedQuery,
  fetchHybridResults,
  mergeHybridResults,
} from "@/lib/hybrid-search";
import { parseQuerySignals, rerankSearchResultsDetailed, takeRelevantResults } from "@/lib/rerank";
import {
  buildClipUrl,
  buildNewsmaxClipUrl,
  getSupabaseAdmin,
  type SearchMatch,
} from "@/lib/supabase";

const ZERO_EMBEDDING = Array.from({ length: 1536 }, () => 0);

export async function runSearch(params: {
  query: string;
  guestName?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  episodeId?: string | null;
  matchCount?: number;
}) {
  if (params.guestName?.trim()) {
    return runGuestTopicSearch({
      guestName: params.guestName.trim(),
      topic: params.query,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      episodeId: params.episodeId,
    });
  }

  const supabase = getSupabaseAdmin();
  const signals = parseQuerySignals(params.query);
  const sharedFilters = {
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    episodeId: params.episodeId,
  };

  let queryEmbedding = ZERO_EMBEDDING;
  let entityEmbedding = ZERO_EMBEDDING;

  if (process.env.OPENAI_API_KEY?.trim()) {
    const embeddingInputs =
      signals.entityPhrases.length > 0
        ? [params.query, signals.entityPhrases.join(" ")]
        : [params.query];

    if (embeddingInputs.length === 1) {
      queryEmbedding = await embedQuery(params.query);
      entityEmbedding = queryEmbedding;
    } else {
      queryEmbedding = await embedQuery(params.query);
      entityEmbedding = await embedQuery(signals.entityPhrases.join(" "));
    }
  }

  if (queryEmbedding.length !== 1536) {
    throw new Error("Failed to generate query embedding");
  }

  const searches = [
    fetchHybridResults(supabase, {
      queryText: params.query,
      queryEmbedding,
      matchCount: params.matchCount ?? 25,
      fullTextWeight: 1.8,
      semanticWeight: 1,
      ...sharedFilters,
    }),
  ];

  if (signals.entityPhrases.length > 0) {
    const entityQuery = signals.entityPhrases.join(" ");
    searches.push(
      fetchHybridResults(supabase, {
        queryText: entityQuery,
        queryEmbedding: entityEmbedding,
        matchCount: 20,
        fullTextWeight: 3,
        semanticWeight: 1.2,
        ...sharedFilters,
      }),
    );
  }

  const merged = mergeHybridResults(await Promise.all(searches));
  const rows = takeRelevantResults(rerankSearchResultsDetailed(params.query, merged));
  const showDates = await getEpisodeShowDatesByVideoIds(
    rows.map((row) => row.youtube_video_id),
  );

  const matches: SearchMatch[] = rows.map((row, index) => {
    const showDate = showDates.get(row.youtube_video_id) ?? row.published_at;

    return {
      episode_id: row.episode_id,
      title: row.episode_title,
      date: showDate,
      start_time: row.start_time,
      end_time: row.end_time,
      summary: row.reason,
      clip_url: buildClipUrl(row.youtube_video_id, row.start_seconds),
      newsmax_clip_url: buildNewsmaxClipUrl(showDate, row.start_seconds),
      youtube_video_id: row.youtube_video_id,
      start_seconds: row.start_seconds,
      transcript_snippet: row.chunk_text,
      score: row.score,
      rank: index + 1,
      confidence: row.confidence,
      match_reason: row.reason,
      shared_terms: row.shared_terms,
      shared_entities: row.shared_entities,
      match_type: row.match_type,
    };
  });

  return {
    query: params.query,
    matches: await enrichMatchReasonsWithLlm(params.query, matches),
  };
}
