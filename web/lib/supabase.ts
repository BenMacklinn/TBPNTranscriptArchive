import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase environment variables are not configured");
  }

  return createClient(url, key);
}

export type HybridSearchRow = {
  chunk_id: string;
  episode_id: string;
  start_seconds: number;
  end_seconds: number;
  start_time: string;
  end_time: string;
  chunk_text: string;
  speaker: string | null;
  episode_title: string;
  published_at: string;
  youtube_video_id: string;
  source_url: string;
  score: number;
};

export type SearchMatch = {
  episode_id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  summary: string;
  clip_url: string;
  youtube_video_id: string;
  start_seconds: number;
  transcript_snippet: string;
  score: number;
  rank: number;
  confidence: "strong" | "medium" | "weak" | "no";
  match_reason: string;
  shared_terms: string[];
  shared_entities: string[];
  match_type: "keyword" | "semantic" | "hybrid";
  summary_source?: "llm" | "heuristic";
  guest_name?: string;
  guest_segment_start?: string;
  guest_segment_url?: string;
};

export type GuestNameOption = {
  id: string;
  person: string;
  company: string | null;
  job_position: string | null;
};

export type EpisodeSummary = {
  id: string;
  title: string;
  published_at: string;
  youtube_video_id: string;
  duration_seconds: number;
};

export type MissingEpisodeSummary = {
  id: string;
  title: string;
  published_at: string;
  source_url: string;
};

export async function getMissingCaptionEpisodes(): Promise<MissingEpisodeSummary[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("episodes")
    .select("id, title, published_at, source_url")
    .eq("ingest_status", "no_captions")
    .order("published_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export type TranscriptChunk = {
  id?: string;
  start_seconds: number;
  end_seconds: number;
  start_time: string;
  end_time: string;
  text: string;
  words_url?: string;
};

export type EpisodeTranscript = {
  episode: EpisodeSummary & { source_url: string };
  chunks: TranscriptChunk[];
};

export function buildClipUrl(youtubeVideoId: string, startSeconds: number) {
  return `https://www.youtube.com/watch?v=${youtubeVideoId}&t=${startSeconds}s`;
}

export function buildClipEmbedUrl(youtubeVideoId: string, startSeconds: number) {
  const params = new URLSearchParams({
    start: String(Math.max(startSeconds, 0)),
    autoplay: "1",
    rel: "0",
  });
  return `https://www.youtube.com/embed/${youtubeVideoId}?${params.toString()}`;
}

const NEWSMAX_CLIPPER_BASE_URL =
  process.env.NEXT_PUBLIC_NEWSMAX_CLIPPER_BASE_URL ??
  "https://newsmax-delta.vercel.app";

function parseIsoDateParts(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  return { year, month, day };
}

export function formatNewsmaxEpisodeDate(isoDate: string) {
  const { year, month, day } = parseIsoDateParts(isoDate);
  // Archive dates follow YouTube upload day; Newsmax clipper uses the live show day.
  const showDate = new Date(Date.UTC(year, month - 1, day - 1));
  return `${showDate.getUTCMonth() + 1}-${showDate.getUTCDate()}-${showDate.getUTCFullYear()}`;
}

export function buildNewsmaxClipUrl(isoDate: string) {
  const slug = formatNewsmaxEpisodeDate(isoDate);
  return `${NEWSMAX_CLIPPER_BASE_URL.replace(/\/$/, "")}/episodes/${slug}/live-clipper`;
}

export function formatDisplayDate(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00`);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatSidebarDate(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00`);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDisplayTimestamp(timestamp: string) {
  const parts = timestamp.split(":");
  if (parts.length !== 3) {
    return timestamp;
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
