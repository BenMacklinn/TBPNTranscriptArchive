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
  transcript_snippet: string;
  score: number;
};

export type EpisodeSummary = {
  id: string;
  title: string;
  published_at: string;
  youtube_video_id: string;
  duration_seconds: number;
};

export type TranscriptChunk = {
  start_seconds: number;
  end_seconds: number;
  start_time: string;
  end_time: string;
  text: string;
};

export type EpisodeTranscript = {
  episode: EpisodeSummary & { source_url: string };
  chunks: TranscriptChunk[];
};

export function buildClipUrl(youtubeVideoId: string, startSeconds: number) {
  return `https://www.youtube.com/watch?v=${youtubeVideoId}&t=${startSeconds}s`;
}

export function formatDisplayDate(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00`);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
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
