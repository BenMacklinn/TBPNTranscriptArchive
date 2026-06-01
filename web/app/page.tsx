"use client";

import { useEffect, useState } from "react";
import { useHomeReset } from "@/app/components/home-reset-context";
import { ResultCard } from "@/app/components/result-card";
import { SearchSkeleton } from "@/app/components/search-skeleton";
import { SearchWorkspace } from "@/app/components/search-workspace";
import { TranscriptPanel } from "@/app/components/transcript-panel";
import type { GuestSegmentSummary } from "@/lib/guest-search";
import { buildSearchPath, buildTranscriptPath } from "@/lib/api-paths";
import type {
  EpisodeSummary,
  EpisodeTranscript,
  SearchMatch,
} from "@/lib/supabase";
import { formatDisplayDate } from "@/lib/supabase";

export default function HomePage() {
  const { registerReset } = useHomeReset();
  const [query, setQuery] = useState("");
  const [guestName, setGuestName] = useState("");
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
  const [hasSearched, setHasSearched] = useState(false);
  const [windowsSearched, setWindowsSearched] = useState<number | null>(null);
  const [searchedSegments, setSearchedSegments] = useState<GuestSegmentSummary[]>([]);
  const [workspaceKey, setWorkspaceKey] = useState(0);

  useEffect(() => {
    registerReset(() => {
      setQuery("");
      setGuestName("");
      setDateFrom("");
      setDateTo("");
      setEpisodeFilter("");
      setSelectedEpisodeId("");
      setError(null);
      setMatches([]);
      setExpanded(new Set());
      setOpenTranscripts([]);
      setHasSearched(false);
      setWindowsSearched(null);
      setSearchedSegments([]);
      setLoading(false);
      setTranscriptLoading(false);
      setWorkspaceKey((key) => key + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [registerReset]);

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

  async function runSearch(searchQuery: string, searchGuestName?: string) {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const response = await fetch(
        buildSearchPath({
          query: searchQuery,
          guestName: searchGuestName,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          episodeId: selectedEpisodeId || undefined,
        }),
      );

      const data = (await response.json()) as {
        matches?: SearchMatch[];
        guestName?: string;
        windowsSearched?: number;
        searchedSegments?: GuestSegmentSummary[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Search failed");
      }

      setQuery(searchQuery);
      if (searchGuestName) {
        setGuestName(data.guestName ?? searchGuestName);
        setWindowsSearched(data.windowsSearched ?? null);
        setSearchedSegments(data.searchedSegments ?? []);
      } else {
        setWindowsSearched(null);
        setSearchedSegments([]);
      }
      const nextMatches = data.matches ?? [];
      setMatches(nextMatches);
      setExpanded(new Set());

      if (nextMatches.length > 0 || (data.searchedSegments ?? []).length > 0) {
        requestAnimationFrame(() => {
          document
            .querySelector(".results-section, .guest-segments-panel")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Search failed",
      );
      setMatches([]);
      setWindowsSearched(null);
      setSearchedSegments([]);
    } finally {
      setLoading(false);
    }
  }

  async function onViewTranscript() {
    if (!selectedEpisodeId) {
      setError("Choose an episode in Filters first.");
      return;
    }

    setTranscriptLoading(true);
    setError(null);

    try {
      const response = await fetch(buildTranscriptPath(selectedEpisodeId));
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
    <main className="page">
      <SearchWorkspace
        key={workspaceKey}
        query={query}
        onQueryChange={setQuery}
        guestName={guestName}
        onGuestNameChange={setGuestName}
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        episodeFilter={episodeFilter}
        onEpisodeFilterChange={setEpisodeFilter}
        selectedEpisodeId={selectedEpisodeId}
        onSelectedEpisodeChange={setSelectedEpisodeId}
        episodes={episodes}
        loading={loading}
        transcriptLoading={transcriptLoading}
        onSearch={(searchQuery, searchGuestName) => void runSearch(searchQuery, searchGuestName)}
        onViewTranscript={() => void onViewTranscript()}
      />

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? <SearchSkeleton /> : null}

      {!loading && hasSearched && matches.length === 0 && !error ? (
        <div className="empty-state">
          <h2>No clips matched</h2>
          <p>
            Try fewer words, add a guest or company name, or widen your date range.
          </p>
        </div>
      ) : null}

      {!loading && !hasSearched && matches.length === 0 && !error && openTranscripts.length === 0 ? (
        <div className="empty-state empty-state-muted">
          <h2>Search the archive</h2>
          <p>
            Type specific terms — guest names, companies, and topics work best.
          </p>
        </div>
      ) : null}

      {openTranscripts.map((transcript) => (
        <TranscriptPanel
          key={transcript.episode.id}
          transcript={transcript}
          onClose={() =>
            setOpenTranscripts((previous) =>
              previous.filter((entry) => entry.episode.id !== transcript.episode.id),
            )
          }
        />
      ))}

      {!loading && searchedSegments.length > 0 ? (
        <section className="guest-segments-panel">
          <div className="results-header">
            <h2 className="section-title">Guest segments searched</h2>
            <p className="section-meta">
              {windowsSearched ?? searchedSegments.length} appearance
              {(windowsSearched ?? searchedSegments.length) === 1 ? "" : "s"} for {guestName}
            </p>
          </div>
          <ul className="guest-segments-list">
            {searchedSegments.map((segment) => (
              <li key={`${segment.episodeDate}-${segment.timestampUrl}`}>
                <a href={segment.timestampUrl} target="_blank" rel="noreferrer">
                  {formatDisplayDate(segment.episodeDate)} · from {segment.segmentStartTime}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!loading && matches.length > 0 ? (
        <section className="results-section">
          <div className="results-header">
            <h2 className="section-title">
              {matches.length} clip{matches.length === 1 ? "" : "s"}
            </h2>
            {selectedEpisodeId ? (
              <p className="section-meta">Scoped to selected episode</p>
            ) : windowsSearched ? (
              <p className="section-meta">
                Across {windowsSearched} guest segment{windowsSearched === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          <div className="results-grid">
            {matches.map((match) => {
              const key = `${match.episode_id}-${match.start_time}`;
              return (
                <ResultCard
                  key={key}
                  match={match}
                  query={query}
                  expanded={expanded.has(key)}
                  onToggle={() => toggleExpanded(key)}
                />
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
