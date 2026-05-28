"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  EpisodeSummary,
  EpisodeTranscript,
  SearchMatch,
} from "@/lib/supabase";
import {
  buildClipUrl,
  formatDisplayDate,
  formatDisplayTimestamp,
} from "@/lib/supabase";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [episodeFilter, setEpisodeFilter] = useState("");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [openTranscripts, setOpenTranscripts] = useState<EpisodeTranscript[]>([]);

  useEffect(() => {
    async function loadEpisodes() {
      try {
        const response = await fetch("/api/episodes");
        const data = (await response.json()) as {
          episodes?: EpisodeSummary[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load episodes");
        }

        setEpisodes(data.episodes ?? []);
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load episodes",
        );
      }
    }

    void loadEpisodes();
  }, []);

  const filteredEpisodes = useMemo(() => {
    const needle = episodeFilter.trim().toLowerCase();
    if (!needle) {
      return episodes;
    }

    return episodes.filter(
      (episode) =>
        episode.title.toLowerCase().includes(needle) ||
        episode.published_at.includes(needle),
    );
  }, [episodeFilter, episodes]);

  function toggleExpanded(key: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function closeTranscript(episodeId: string) {
    setOpenTranscripts((previous) =>
      previous.filter((entry) => entry.episode.id !== episodeId),
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          episodeId: selectedEpisodeId || undefined,
        }),
      });

      const data = (await response.json()) as {
        matches?: SearchMatch[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Search failed");
      }

      setMatches(data.matches ?? []);
      setExpanded(new Set());
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Search failed",
      );
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }

  async function onViewTranscript() {
    if (!selectedEpisodeId) {
      setError("Choose an episode first.");
      return;
    }

    setTranscriptLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(selectedEpisodeId)}/transcript`,
      );
      const data = (await response.json()) as EpisodeTranscript & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load transcript");
      }

      setOpenTranscripts((previous) => {
        const rest = previous.filter((entry) => entry.episode.id !== data.episode.id);
        return [...rest, data];
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load transcript",
      );
    } finally {
      setTranscriptLoading(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <h1>TBPN Transcript Archive</h1>
        <p>
          Search every TBPN livestream with hybrid semantic + keyword retrieval.
          Every answer comes with a timestamp and a clip link.
        </p>
      </section>

      <section className="search-panel">
        <form className="search-form" onSubmit={onSubmit}>
          <div className="search-row">
            <label>
              Search
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="when did we talk about nuclear energy bottlenecks last year?"
                required
              />
            </label>
            <label>
              From
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
            <button className="primary" type="submit" disabled={loading}>
              {loading ? "Searching..." : "Search"}
            </button>
          </div>

          <div className="episode-row">
            <label className="episode-filter-label">
              Episode
              <input
                type="text"
                value={episodeFilter}
                onChange={(event) => setEpisodeFilter(event.target.value)}
                placeholder="Filter by title or date..."
              />
            </label>
            <label>
              Select episode
              <select
                value={selectedEpisodeId}
                onChange={(event) => setSelectedEpisodeId(event.target.value)}
              >
                <option value="">All episodes</option>
                {filteredEpisodes.map((episode) => (
                  <option key={episode.id} value={episode.id}>
                    {episode.published_at} — {episode.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              type="button"
              onClick={() => void onViewTranscript()}
              disabled={!selectedEpisodeId || transcriptLoading}
            >
              {transcriptLoading ? "Loading..." : "View full transcript"}
            </button>
          </div>
        </form>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {!loading && matches.length === 0 && !error && openTranscripts.length === 0 ? (
        <p className="status">Try a question about AI, markets, guests, or policy.</p>
      ) : null}

      {openTranscripts.map((transcript) => (
        <section className="results transcript-panel" key={transcript.episode.id}>
          <div className="transcript-header">
            <div>
              <p className="result-meta">{formatDisplayDate(transcript.episode.published_at)}</p>
              <h2 className="result-title">{transcript.episode.title}</h2>
              <p className="status">
                Full transcript · {transcript.chunks.length} chunks ·{" "}
                {Math.round(transcript.episode.duration_seconds / 3600)}h
              </p>
            </div>
            <div className="actions">
              <a
                className="primary-link"
                href={transcript.episode.source_url}
                target="_blank"
                rel="noreferrer"
              >
                Open on YouTube
              </a>
              <Link href={`/episode/${transcript.episode.id}`}>Episode page</Link>
              <button type="button" onClick={() => closeTranscript(transcript.episode.id)}>
                Close transcript
              </button>
            </div>
          </div>

          <div className="episode-list">
            {transcript.chunks.map((chunk) => (
              <div
                className="chunk-row"
                key={`${chunk.start_seconds}-${chunk.end_seconds}`}
              >
                <div className="chunk-time">
                  {formatDisplayTimestamp(chunk.start_time)} –{" "}
                  {formatDisplayTimestamp(chunk.end_time)}
                </div>
                <p className="result-summary">{chunk.text}</p>
                <div className="actions">
                  <a
                    className="primary-link"
                    href={buildClipUrl(
                      transcript.episode.youtube_video_id,
                      chunk.start_seconds,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open clip
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {matches.length > 0 ? (
        <section className="results">
          <p className="status">
            Found {matches.length} likely matches
            {selectedEpisodeId ? " in selected episode" : ""}
          </p>
          {matches.map((match) => {
            const key = `${match.episode_id}-${match.start_time}`;
            const isExpanded = expanded.has(key);

            return (
              <article className="result-card" key={key}>
                <div className="result-meta">
                  {formatDisplayDate(match.date)} — {formatDisplayTimestamp(match.start_time)}
                </div>
                <h2 className="result-title">{match.title}</h2>
                <p className="result-summary">{match.summary}</p>
                {isExpanded ? (
                  <p className="snippet">{match.transcript_snippet}</p>
                ) : null}
                <div className="actions">
                  <a
                    className="primary-link"
                    href={match.clip_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open clip
                  </a>
                  <button type="button" onClick={() => toggleExpanded(key)}>
                    {isExpanded ? "Hide transcript" : "View transcript"}
                  </button>
                  <Link href={`/episode/${match.episode_id}`}>Episode page</Link>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}
    </main>
  );
}
