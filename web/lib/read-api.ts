import { runGuestTopicSearch, type GuestSegmentSummary } from "@/lib/guest-search";
import { runSearch } from "@/lib/search";
import {
  buildClipUrl,
  getSupabaseAdmin,
  type EpisodeTranscript,
  type SearchMatch,
} from "@/lib/supabase";

export type ReadTranscriptChunk = {
  id: string;
  start_seconds: number;
  end_seconds: number;
  start_time: string;
  end_time: string;
  text: string;
  speaker: string | null;
  clip_url: string;
  words: ReadTranscriptWord[];
};

export type ReadTranscriptWord = {
  word: string;
  start_seconds: number;
  end_seconds: number;
};

export type ReadTranscript = {
  episode: EpisodeTranscript["episode"];
  chunk_count: number;
  chunks: ReadTranscriptChunk[];
};

export type ReadSearchResult = {
  query: string;
  guestName?: string;
  episodeId?: string;
  dateFrom?: string;
  dateTo?: string;
  matches: SearchMatch[];
  windowsSearched?: number;
  searchedSegments?: GuestSegmentSummary[];
};

export async function loadEpisodeTranscript(episodeId: string): Promise<ReadTranscript> {
  const supabase = getSupabaseAdmin();

  const { data: episode, error: episodeError } = await supabase
    .from("episodes")
    .select("id, title, published_at, youtube_video_id, duration_seconds, source_url")
    .eq("id", episodeId)
    .maybeSingle();

  if (episodeError) {
    throw new Error(episodeError.message);
  }

  if (!episode) {
    throw new ReadApiNotFoundError(`Episode not found: ${episodeId}`);
  }

  const { data: chunks, error: chunksError } = await supabase
    .from("transcript_chunks")
    .select("id, start_seconds, end_seconds, start_time, end_time, text, speaker")
    .eq("episode_id", episodeId)
    .order("start_seconds", { ascending: true });

  if (chunksError) {
    throw new Error(chunksError.message);
  }

  const words = await loadEpisodeWords(episodeId);

  const wordsByChunk = new Map<string, ReadTranscriptWord[]>();
  for (const word of words ?? []) {
    if (!word.chunk_id) {
      continue;
    }
    const bucket = wordsByChunk.get(word.chunk_id) ?? [];
    bucket.push({
      word: word.word,
      start_seconds: Number(word.start_seconds),
      end_seconds: Number(word.end_seconds),
    });
    wordsByChunk.set(word.chunk_id, bucket);
  }

  const detailedChunks: ReadTranscriptChunk[] = (chunks ?? []).map((chunk) => ({
    id: chunk.id,
    start_seconds: chunk.start_seconds,
    end_seconds: chunk.end_seconds,
    start_time: chunk.start_time,
    end_time: chunk.end_time,
    text: chunk.text,
    speaker: chunk.speaker,
    clip_url: buildClipUrl(episode.youtube_video_id, chunk.start_seconds),
    words: wordsByChunk.get(chunk.id) ?? [],
  }));

  return {
    episode,
    chunk_count: detailedChunks.length,
    chunks: detailedChunks,
  };
}

type TranscriptWordRow = {
  chunk_id: string | null;
  word: string;
  start_seconds: number | string;
  end_seconds: number | string;
};

async function loadEpisodeWords(episodeId: string): Promise<TranscriptWordRow[]> {
  const supabase = getSupabaseAdmin();
  const pageSize = 1000;
  const words: TranscriptWordRow[] = [];

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("transcript_words")
      .select("chunk_id, word, start_seconds, end_seconds")
      .eq("episode_id", episodeId)
      .order("word_index", { ascending: true })
      .range(start, start + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as TranscriptWordRow[];
    words.push(...page);

    if (page.length < pageSize) {
      return words;
    }
  }
}

export class ReadApiNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadApiNotFoundError";
  }
}

export async function assertEpisodeExists(episodeId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("episodes")
    .select("id")
    .eq("id", episodeId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new ReadApiNotFoundError(`Episode not found: ${episodeId}`);
  }
}

export async function runArchiveSearch(
  query: string,
  filters?: {
    dateFrom?: string | null;
    dateTo?: string | null;
    episodeId?: string | null;
  },
  limit = 25,
): Promise<ReadSearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("Query is required");
  }

  const search = await runSearch({
    query: trimmedQuery,
    dateFrom: filters?.dateFrom,
    dateTo: filters?.dateTo,
    episodeId: filters?.episodeId,
    matchCount: limit,
  });

  return {
    query: search.query,
    episodeId: filters?.episodeId?.trim() || undefined,
    dateFrom: filters?.dateFrom?.trim() || undefined,
    dateTo: filters?.dateTo?.trim() || undefined,
    matches: search.matches,
  };
}

export async function runEpisodeSearch(
  episodeId: string,
  query: string,
  limit = 25,
): Promise<ReadSearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("Query is required");
  }

  await assertEpisodeExists(episodeId);

  const search = await runSearch({
    query: trimmedQuery,
    episodeId,
    matchCount: limit,
  });

  return {
    query: search.query,
    episodeId,
    matches: search.matches,
  };
}

export function parseSearchLimit(searchParams: URLSearchParams, fallback = 25) {
  const limitValue = Number(searchParams.get("limit") ?? searchParams.get("matchCount") ?? String(fallback));
  return Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : fallback;
}

export function parseSearchFilters(searchParams: URLSearchParams) {
  return {
    dateFrom: searchParams.get("from") ?? searchParams.get("dateFrom"),
    dateTo: searchParams.get("to") ?? searchParams.get("dateTo"),
    episodeId: searchParams.get("episode") ?? searchParams.get("episodeId"),
  };
}

export function parseSearchQueryFromPath(segment: string) {
  return decodeURIComponent(segment).replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

export function parseGuestFromPath(guest: string) {
  return decodeURIComponent(guest).replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

export async function runGuestSearch(
  guestName: string,
  topic: string,
  options?: {
    dateFrom?: string | null;
    dateTo?: string | null;
    episodeId?: string | null;
  },
): Promise<ReadSearchResult> {
  const trimmedTopic = topic.trim();
  if (!trimmedTopic) {
    throw new Error("Topic is required");
  }

  const guest = parseGuestFromPath(guestName);
  if (!guest) {
    throw new Error("Guest is required");
  }

  const search = await runGuestTopicSearch({
    guestName: guest,
    topic: trimmedTopic,
    dateFrom: options?.dateFrom,
    dateTo: options?.dateTo,
    episodeId: options?.episodeId,
  });

  return {
    query: search.query,
    guestName: search.guestName,
    episodeId: options?.episodeId?.trim() || undefined,
    dateFrom: options?.dateFrom?.trim() || undefined,
    dateTo: options?.dateTo?.trim() || undefined,
    matches: search.matches,
    windowsSearched: search.windowsSearched,
    searchedSegments: search.searchedSegments,
  };
}
