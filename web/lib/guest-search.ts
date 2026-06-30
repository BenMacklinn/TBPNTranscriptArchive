import { enrichMatchReasonsWithLlm } from "@/lib/match-reasons";
import {
  getGuestAppearances,
  resolveGuest,
  searchGuestNames as searchCatalogGuestNames,
  type CatalogGuest,
} from "@/lib/guest-catalog";
import { rerankSearchResultsDetailed, takeRelevantResults, formatMatchReason } from "@/lib/rerank";
import {
  embedQuery,
  fetchHybridResults,
  mergeHybridResults,
} from "@/lib/hybrid-search";
import {
  buildClipUrl,
  buildNewsmaxClipUrl,
  formatDisplayTimestamp,
  getSupabaseAdmin,
  type SearchMatch,
} from "@/lib/supabase";

export type GuestNameSummary = CatalogGuest;

export type GuestAppearanceWindow = {
  guestName: string;
  episodeId: string;
  episodeTitle: string;
  episodeDate: string;
  videoId: string;
  segmentStartSeconds: number;
  segmentEndSeconds: number;
  segmentStartTime: string;
  timestampUrl: string;
};

export type GuestSegmentSummary = {
  episodeTitle: string;
  episodeDate: string;
  segmentStartTime: string;
  timestampUrl: string;
};

const MAX_GUEST_WINDOWS = 12;
const PRE_ROLL_SECONDS = 30;

function secondsToTimestamp(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export async function searchGuestNames(query: string, limit = 10): Promise<GuestNameSummary[]> {
  return searchCatalogGuestNames(query, limit);
}

async function loadGuestWindows(guest: CatalogGuest): Promise<GuestAppearanceWindow[]> {
  const supabase = getSupabaseAdmin();
  const appearances = await getGuestAppearances(guest.person, MAX_GUEST_WINDOWS);

  if (appearances.length === 0) {
    throw new Error(`No appearances found for guest "${guest.person}".`);
  }

  const videoIds = [...new Set(appearances.map((row) => row.videoId))];
  const episodesResponse = await supabase
    .from("episodes")
    .select("id, title, published_at, youtube_video_id, duration_seconds")
    .in("youtube_video_id", videoIds);

  if (episodesResponse.error) {
    throw new Error(episodesResponse.error.message);
  }

  const episodesByVideo = new Map(
    (episodesResponse.data ?? []).map((episode) => [episode.youtube_video_id as string, episode]),
  );

  const windows: GuestAppearanceWindow[] = [];

  for (const appearance of appearances) {
    const episode = episodesByVideo.get(appearance.videoId);
    if (!episode) {
      continue;
    }

    const startSeconds = Math.max(0, appearance.startSeconds - PRE_ROLL_SECONDS);
    const endSeconds =
      appearance.endSeconds != null
        ? appearance.endSeconds
        : Number(episode.duration_seconds);

    windows.push({
      guestName: guest.person,
      episodeId: episode.id as string,
      episodeTitle: episode.title as string,
      episodeDate: appearance.episodeDate,
      videoId: appearance.videoId,
      segmentStartSeconds: startSeconds,
      segmentEndSeconds: endSeconds,
      segmentStartTime: secondsToTimestamp(appearance.startSeconds),
      timestampUrl: appearance.timestampUrl,
    });
  }

  if (windows.length === 0) {
    throw new Error(
      `Guest "${guest.person}" has appearances, but none match ingested episodes yet.`,
    );
  }

  return windows;
}

function windowKey(window: GuestAppearanceWindow) {
  return `${window.episodeId}:${window.segmentStartSeconds}`;
}

function toSegmentSummaries(windows: GuestAppearanceWindow[]): GuestSegmentSummary[] {
  return windows.map((window) => ({
    episodeTitle: window.episodeTitle,
    episodeDate: window.episodeDate,
    segmentStartTime: window.segmentStartTime,
    timestampUrl: window.timestampUrl,
  }));
}

export async function runGuestTopicSearch(params: {
  guestName: string;
  topic: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  episodeId?: string | null;
}) {
  const topic = params.topic.trim();
  if (!topic) {
    throw new Error("Topic is required for guest search.");
  }

  const guest = await resolveGuest(params.guestName.trim());
  let windows = await loadGuestWindows(guest);

  if (params.episodeId) {
    windows = windows.filter((window) => window.episodeId === params.episodeId);
  }

  if (params.dateFrom) {
    windows = windows.filter((window) => window.episodeDate >= params.dateFrom!);
  }

  if (params.dateTo) {
    windows = windows.filter((window) => window.episodeDate <= params.dateTo!);
  }

  if (windows.length === 0) {
    throw new Error(`No "${guest.person}" appearances match the selected filters.`);
  }

  const supabase = getSupabaseAdmin();
  const queryEmbedding = await embedQuery(topic);

  if (queryEmbedding.length !== 1536) {
    throw new Error("Failed to generate query embedding");
  }

  const windowByKey = new Map(windows.map((window) => [windowKey(window), window]));
  const resultSets = await Promise.all(
    windows.map((window) =>
      fetchHybridResults(supabase, {
        queryText: topic,
        queryEmbedding,
        matchCount: 8,
        fullTextWeight: 2,
        semanticWeight: 1.1,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        episodeId: window.episodeId,
        minStartSeconds: window.segmentStartSeconds,
        maxStartSeconds: window.segmentEndSeconds,
      }),
    ),
  );

  const merged = mergeHybridResults(resultSets);
  const rows = takeRelevantResults(rerankSearchResultsDetailed(topic, merged));

  const matches: SearchMatch[] = rows.map((row, index) => {
    const matchingWindow =
      [...windowByKey.values()].find(
        (window) =>
          window.episodeId === row.episode_id &&
          row.start_seconds >= window.segmentStartSeconds &&
          row.start_seconds < window.segmentEndSeconds,
      ) ?? windows[0];

    return {
      episode_id: row.episode_id,
      title: row.episode_title,
      date: matchingWindow.episodeDate,
      start_time: row.start_time,
      end_time: row.end_time,
      summary: formatMatchReason(row, {
        guestName: matchingWindow.guestName,
        query: topic,
      }),
      clip_url: buildClipUrl(row.youtube_video_id, row.start_seconds),
      newsmax_clip_url: buildNewsmaxClipUrl(matchingWindow.episodeDate),
      youtube_video_id: row.youtube_video_id,
      start_seconds: row.start_seconds,
      transcript_snippet: row.chunk_text,
      score: row.score,
      rank: index + 1,
      confidence: row.confidence,
      match_reason: formatMatchReason(row, {
        guestName: matchingWindow.guestName,
        query: topic,
      }),
      shared_terms: row.shared_terms,
      shared_entities: row.shared_entities,
      match_type: row.match_type,
      guest_name: matchingWindow.guestName,
      guest_segment_start: formatDisplayTimestamp(matchingWindow.segmentStartTime),
      guest_segment_url: matchingWindow.timestampUrl,
    };
  });

  return {
    query: topic,
    guestName: guest.person,
    windowsSearched: windows.length,
    searchedSegments: toSegmentSummaries(windows),
    matches: await enrichMatchReasonsWithLlm(topic, matches),
  };
}
