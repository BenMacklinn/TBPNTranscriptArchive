"use client";

import Link from "next/link";
import type { EpisodeTranscript } from "@/lib/supabase";
import {
  buildClipUrl,
  formatDisplayDate,
  formatDisplayTimestamp,
} from "@/lib/supabase";
import { FormattedTranscript } from "./formatted-transcript";

type TranscriptPanelProps = {
  transcript: EpisodeTranscript;
  onClose: () => void;
};

export function TranscriptPanel({ transcript, onClose }: TranscriptPanelProps) {
  return (
    <section className="transcript-panel">
      <div className="transcript-header">
        <div>
          <p className="eyebrow">{formatDisplayDate(transcript.episode.published_at)}</p>
          <h2 className="panel-heading">{transcript.episode.title}</h2>
          <p className="panel-meta">
            {transcript.chunks.length} segments · {Math.round(transcript.episode.duration_seconds / 3600)}h
          </p>
        </div>
        <div className="result-actions">
          <a
            className="btn btn-primary"
            href={transcript.episode.source_url}
            target="_blank"
            rel="noreferrer"
          >
            YouTube
          </a>
          <Link className="btn btn-secondary" href={`/episode/${transcript.episode.id}`}>
            Full page
          </Link>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="episode-list">
        {transcript.chunks.map((chunk) => (
          <div className="chunk-row" key={`${chunk.start_seconds}-${chunk.end_seconds}`}>
            <div className="chunk-time">
              {formatDisplayTimestamp(chunk.start_time)} – {formatDisplayTimestamp(chunk.end_time)}
            </div>
            <FormattedTranscript text={chunk.text} className="chunk-text" />
            <a
              className="btn btn-secondary btn-sm"
              href={buildClipUrl(transcript.episode.youtube_video_id, chunk.start_seconds)}
              target="_blank"
              rel="noreferrer"
            >
              Open clip
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
