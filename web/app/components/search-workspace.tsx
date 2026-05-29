"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EpisodeSummary, GuestNameOption } from "@/lib/supabase";

type SearchWorkspaceProps = {
  query: string;
  onQueryChange: (value: string) => void;
  guestName: string;
  onGuestNameChange: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  episodeFilter: string;
  onEpisodeFilterChange: (value: string) => void;
  selectedEpisodeId: string;
  onSelectedEpisodeChange: (value: string) => void;
  episodes: EpisodeSummary[];
  loading: boolean;
  transcriptLoading: boolean;
  onSearch: (query: string, guestName?: string) => void;
  onViewTranscript: () => void;
};

export function SearchWorkspace({
  query,
  onQueryChange,
  guestName,
  onGuestNameChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  episodeFilter,
  onEpisodeFilterChange,
  selectedEpisodeId,
  onSelectedEpisodeChange,
  episodes,
  loading,
  transcriptLoading,
  onSearch,
  onViewTranscript,
}: SearchWorkspaceProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [guestSuggestions, setGuestSuggestions] = useState<GuestNameOption[]>([]);
  const [guestSuggestionsOpen, setGuestSuggestionsOpen] = useState(false);
  const [guestLookupLoading, setGuestLookupLoading] = useState(false);
  const [guestHighlightIndex, setGuestHighlightIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const guestInputRef = useRef<HTMLInputElement>(null);
  const guestComboboxRef = useRef<HTMLDivElement>(null);

  async function fetchGuestSuggestions(needle: string, openMenu = true) {
    setGuestLookupLoading(true);
    try {
      const response = await fetch(`/api/guests?q=${encodeURIComponent(needle)}`);
      const data = (await response.json()) as {
        guests?: GuestNameOption[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Guest lookup failed");
      }

      const guests = data.guests ?? [];
      setGuestSuggestions(guests);
      setGuestSuggestionsOpen(openMenu && guests.length > 0);
      setGuestHighlightIndex(openMenu && guests.length > 0 ? 0 : -1);
    } catch {
      setGuestSuggestions([]);
      setGuestSuggestionsOpen(false);
      setGuestHighlightIndex(-1);
    } finally {
      setGuestLookupLoading(false);
    }
  }

  function selectGuest(guest: GuestNameOption) {
    onGuestNameChange(guest.person);
    setGuestSuggestions([]);
    setGuestSuggestionsOpen(false);
    setGuestHighlightIndex(-1);
    searchInputRef.current?.focus();
  }

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const needle = guestName.trim();
    if (!needle) {
      setGuestSuggestions([]);
      setGuestSuggestionsOpen(false);
      setGuestHighlightIndex(-1);
      return;
    }

    const timeout = window.setTimeout(() => {
      const shouldOpenMenu = document.activeElement === guestInputRef.current;
      void fetchGuestSuggestions(needle, shouldOpenMenu);
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [guestName]);

  useEffect(() => {
    if (!guestSuggestionsOpen) {
      setGuestHighlightIndex(-1);
    }
  }, [guestSuggestionsOpen]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!guestComboboxRef.current?.contains(event.target as Node)) {
        setGuestSuggestionsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
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

  const activeFilters =
    Number(Boolean(dateFrom)) + Number(Boolean(dateTo)) + Number(Boolean(selectedEpisodeId));

  return (
    <section className="workspace-card">
      <form
        className="search-stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(query, guestName.trim() || undefined);
        }}
      >
        <div className="search-fields-grid">
          <div className="guest-combobox" ref={guestComboboxRef}>
            <label className="field">
              <span className="field-label">Guest</span>
              <div className="guest-input-wrap">
                <input
                  ref={guestInputRef}
                  type="text"
                  value={guestName}
                  onChange={(event) => {
                    onGuestNameChange(event.target.value);
                    setGuestSuggestionsOpen(true);
                  }}
                  onFocus={() => {
                    void fetchGuestSuggestions(guestName.trim(), true);
                  }}
                  onKeyDown={(event) => {
                    if (!guestSuggestionsOpen || guestSuggestions.length === 0) {
                      return;
                    }

                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setGuestHighlightIndex((index) =>
                        index >= guestSuggestions.length - 1 ? 0 : index + 1,
                      );
                      return;
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setGuestHighlightIndex((index) =>
                        index <= 0 ? guestSuggestions.length - 1 : index - 1,
                      );
                      return;
                    }

                    if (event.key === "Enter" && guestHighlightIndex >= 0) {
                      event.preventDefault();
                      const guest = guestSuggestions[guestHighlightIndex];
                      if (guest) {
                        selectGuest(guest);
                      }
                      return;
                    }

                    if (event.key === "Escape") {
                      setGuestSuggestionsOpen(false);
                    }
                  }}
                  placeholder="Start typing a guest name…"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  spellCheck={false}
                  role="combobox"
                  aria-expanded={guestSuggestionsOpen}
                  aria-controls="guest-suggestions"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    guestHighlightIndex >= 0
                      ? `guest-option-${guestSuggestions[guestHighlightIndex]?.id}`
                      : undefined
                  }
                />
                {guestSuggestionsOpen && guestSuggestions.length > 0 ? (
                  <ul className="guest-suggestions" id="guest-suggestions" role="listbox">
                    {guestSuggestions.map((guest, index) => (
                      <li key={guest.id} role="presentation">
                        <button
                          type="button"
                          id={`guest-option-${guest.id}`}
                          className={`guest-suggestion ${index === guestHighlightIndex ? "active" : ""}`}
                          role="option"
                          aria-selected={index === guestHighlightIndex}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setGuestHighlightIndex(index)}
                          onClick={() => selectGuest(guest)}
                        >
                          <span className="guest-suggestion-name">{guest.person}</span>
                          {guest.company || guest.job_position ? (
                            <span className="guest-suggestion-meta">
                              {[guest.job_position, guest.company].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <span className="field-hint">
                Optional — pick from the list or keep typing. Scopes search to on-air segments.
                {guestLookupLoading ? " Loading guests…" : ""}
              </span>
            </label>
          </div>

          <label className="field">
            <span className="field-label">Topic</span>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="mechanistic interpretability"
              required
            />
            <span className="field-hint">
              {guestName.trim()
                ? "Topic terms searched only during this guest's segments."
                : "Use 3–6 specific terms: guest, company, topic."}
            </span>
          </label>
        </div>

        <div className="search-actions">
          <button
            className="btn btn-primary btn-lg"
            type="submit"
            disabled={loading || !query.trim()}
          >
            {loading ? "Searching…" : guestName.trim() ? "Search guest + topic" : "Search"}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
        </div>
      </form>

      {filtersOpen ? (
        <div className="filters-panel">
          <div className="filters-grid">
            <label className="field">
              <span className="field-label">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => onDateFromChange(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => onDateToChange(event.target.value)}
              />
            </label>
            <label className="field field-span-2">
              <span className="field-label">Episode</span>
              <input
                type="text"
                value={episodeFilter}
                onChange={(event) => onEpisodeFilterChange(event.target.value)}
                placeholder="Filter episodes by title or date…"
              />
            </label>
            <label className="field field-span-2">
              <span className="field-label">Scope to episode</span>
              <select
                value={selectedEpisodeId}
                onChange={(event) => onSelectedEpisodeChange(event.target.value)}
              >
                <option value="">All episodes</option>
                {filteredEpisodes.map((episode) => (
                  <option key={episode.id} value={episode.id}>
                    {episode.published_at} — {episode.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="filters-footer">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={!selectedEpisodeId || transcriptLoading}
              onClick={onViewTranscript}
            >
              {transcriptLoading ? "Loading transcript…" : "View full transcript"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                onDateFromChange("");
                onDateToChange("");
                onEpisodeFilterChange("");
                onSelectedEpisodeChange("");
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
