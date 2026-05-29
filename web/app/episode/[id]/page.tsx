import Link from "next/link";
import { notFound } from "next/navigation";
import { FormattedTranscript } from "@/app/components/formatted-transcript";
import {
  buildClipUrl,
  formatDisplayDate,
  formatDisplayTimestamp,
  getSupabaseAdmin,
} from "@/lib/supabase";

type EpisodePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EpisodePage({ params }: EpisodePageProps) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: episode, error: episodeError } = await supabase
    .from("episodes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (episodeError || !episode) {
    notFound();
  }

  const { data: chunks } = await supabase
    .from("transcript_chunks")
    .select("start_seconds, end_seconds, start_time, end_time, text")
    .eq("episode_id", id)
    .order("start_seconds", { ascending: true });

  return (
    <main className="page">
      <Link className="back-link" href="/">
        ← Back to search
      </Link>

      <section className="workspace-card episode-page-header">
        <p className="eyebrow">{formatDisplayDate(episode.published_at)}</p>
        <h1 className="page-title">{episode.title}</h1>
        <p className="page-lead">
          {Math.round(episode.duration_seconds / 3600)}h archive · {chunks?.length ?? 0} segments
        </p>
        <div className="search-actions episode-actions">
          <a className="btn btn-primary" href={episode.source_url} target="_blank" rel="noreferrer">
            Open on YouTube
          </a>
        </div>
      </section>

      <section className="transcript-panel episode-list">
        {(chunks ?? []).map((chunk) => (
          <div className="chunk-row" key={`${chunk.start_seconds}-${chunk.end_seconds}`}>
            <div className="chunk-time">
              {formatDisplayTimestamp(chunk.start_time)} – {formatDisplayTimestamp(chunk.end_time)}
            </div>
            <FormattedTranscript text={chunk.text} className="chunk-text" />
            <a
              className="btn btn-secondary btn-sm"
              href={buildClipUrl(episode.youtube_video_id, chunk.start_seconds)}
              target="_blank"
              rel="noreferrer"
            >
              Open clip
            </a>
          </div>
        ))}
      </section>
    </main>
  );
}
