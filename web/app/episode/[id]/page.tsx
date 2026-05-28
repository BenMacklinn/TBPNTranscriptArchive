import Link from "next/link";
import { notFound } from "next/navigation";
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
    <main className="container">
      <Link className="back-link" href="/">
        ← Back to search
      </Link>

      <section className="hero">
        <h1>{episode.title}</h1>
        <p>
          {formatDisplayDate(episode.published_at)} ·{" "}
          {Math.round(episode.duration_seconds / 3600)}h archive
        </p>
      </section>

      <section className="search-panel episode-list">
        {(chunks ?? []).map((chunk) => (
          <div className="chunk-row" key={`${chunk.start_seconds}-${chunk.end_seconds}`}>
            <div className="chunk-time">
              {formatDisplayTimestamp(chunk.start_time)} –{" "}
              {formatDisplayTimestamp(chunk.end_time)}
            </div>
            <p className="result-summary">{chunk.text}</p>
            <div className="actions">
              <a
                className="primary-link"
                href={buildClipUrl(episode.youtube_video_id, chunk.start_seconds)}
                target="_blank"
                rel="noreferrer"
              >
                Open clip
              </a>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
