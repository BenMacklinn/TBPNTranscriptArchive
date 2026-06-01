import { searchGuestNames, type GuestSegmentSummary } from "@/lib/guest-search";
import { runSearch } from "@/lib/search";
import {
  buildClipUrl,
  getSupabaseAdmin,
  type EpisodeSummary,
  type EpisodeTranscript,
  type GuestNameOption,
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

export type ReadApiResult = {
  episodes?: EpisodeSummary[];
  guests?: GuestNameOption[];
  search?: ReadSearchResult;
  transcript?: ReadTranscript;
};

export type ReadApiParams = {
  includeEpisodes?: boolean;
  guestsQuery?: string | null;
  searchQuery?: string | null;
  guestName?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  episodeId?: string | null;
  includeTranscript?: boolean;
  limit?: number;
};

export async function listEpisodes(): Promise<EpisodeSummary[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("episodes")
    .select("id, title, published_at, youtube_video_id, duration_seconds")
    .eq("ingest_status", "done")
    .order("published_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

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

  const detailedChunks: ReadTranscriptChunk[] = (chunks ?? []).map((chunk) => ({
    id: chunk.id,
    start_seconds: chunk.start_seconds,
    end_seconds: chunk.end_seconds,
    start_time: chunk.start_time,
    end_time: chunk.end_time,
    text: chunk.text,
    speaker: chunk.speaker,
    clip_url: buildClipUrl(episode.youtube_video_id, chunk.start_seconds),
  }));

  return {
    episode,
    chunk_count: detailedChunks.length,
    chunks: detailedChunks,
  };
}

export class ReadApiNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadApiNotFoundError";
  }
}

export async function runReadApi(params: ReadApiParams): Promise<ReadApiResult> {
  const tasks: Promise<void>[] = [];
  const result: ReadApiResult = {};

  if (params.includeEpisodes) {
    tasks.push(
      listEpisodes().then((episodes) => {
        result.episodes = episodes;
      }),
    );
  }

  if (params.guestsQuery != null) {
    tasks.push(
      searchGuestNames(params.guestsQuery, 12).then((guests) => {
        result.guests = guests;
      }),
    );
  }

  if (params.searchQuery?.trim()) {
    tasks.push(
      runSearch({
        query: params.searchQuery.trim(),
        guestName: params.guestName,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        episodeId: params.episodeId,
        matchCount: params.limit,
      }).then((search) => {
        result.search = {
          query: search.query,
          guestName: params.guestName?.trim() || undefined,
          episodeId: params.episodeId?.trim() || undefined,
          dateFrom: params.dateFrom?.trim() || undefined,
          dateTo: params.dateTo?.trim() || undefined,
          matches: search.matches,
          windowsSearched: "windowsSearched" in search ? search.windowsSearched : undefined,
          searchedSegments: "searchedSegments" in search ? search.searchedSegments : undefined,
        };
      }),
    );
  }

  if (params.includeTranscript && params.episodeId?.trim()) {
    tasks.push(
      loadEpisodeTranscript(params.episodeId.trim()).then((transcript) => {
        result.transcript = transcript;
      }),
    );
  }

  if (tasks.length === 0) {
    result.episodes = await listEpisodes();
    return result;
  }

  await Promise.all(tasks);
  return result;
}

export function parseReadApiParams(searchParams: URLSearchParams): ReadApiParams {
  const searchQuery = searchParams.get("q") ?? searchParams.get("query");
  const guestName = searchParams.get("guestName") ?? searchParams.get("guest");
  const dateFrom = searchParams.get("dateFrom") ?? searchParams.get("from");
  const dateTo = searchParams.get("dateTo") ?? searchParams.get("to");
  const episodeId = searchParams.get("episodeId") ?? searchParams.get("episode");
  const limitValue = Number(searchParams.get("limit") ?? searchParams.get("matchCount") ?? "25");
  const includeTranscript = parseTruthyParam(searchParams.get("transcript"));
  const includeEpisodes = parseTruthyParam(searchParams.get("episodes"));
  const hasGuests = searchParams.has("guests");
  const guestsQuery = hasGuests
    ? (searchParams.get("guests") ?? searchParams.get("guestQ") ?? "")
    : null;

  const hasSearch = Boolean(searchQuery?.trim());
  const hasTranscript = includeTranscript && Boolean(episodeId?.trim());
  const shouldIncludeEpisodes =
    includeEpisodes || (!hasSearch && !hasGuests && !hasTranscript && !includeEpisodes);

  return {
    includeEpisodes: shouldIncludeEpisodes,
    guestsQuery: hasGuests ? guestsQuery : null,
    searchQuery,
    guestName,
    dateFrom,
    dateTo,
    episodeId,
    includeTranscript,
    limit: Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : 25,
  };
}

function parseTruthyParam(value: string | null) {
  if (!value) {
    return false;
  }
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}
