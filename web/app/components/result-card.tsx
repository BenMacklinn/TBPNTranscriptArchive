"use client";

import Link from "next/link";
import type { SearchMatch } from "@/lib/supabase";
import { formatDisplayDate, formatDisplayTimestamp } from "@/lib/supabase";
import { tokenizeHighlightTerms } from "@/lib/rerank";

type ResultCardProps = {
  match: SearchMatch;
  query: string;
  expanded: boolean;
  onToggle: () => void;
};

function highlightSnippet(text: string, query: string) {
  const terms = tokenizeHighlightTerms(query);
  if (!terms.length) {
    return text;
  }

  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    const isMatch = terms.some((term) => part.toLowerCase() === term.toLowerCase());
    if (isMatch) {
      return (
        <mark className="term-highlight" key={`${part}-${index}`}>
          {part}
        </mark>
      );
    }
    return part;
  });
}

export function ResultCard({ match, query, expanded, onToggle }: ResultCardProps) {
  const isSemantic = match.match_type === "semantic" || match.match_type === "hybrid";

  return (
    <article className={`result-card${expanded ? " expanded" : ""}`}>
      <header className="result-meta">
        <div className="result-meta-left">
          <span className="result-date">{formatDisplayDate(match.date)}</span>
          <span className="result-sep" aria-hidden>
            /
          </span>
          <span className="result-time">{formatDisplayTimestamp(match.start_time)}</span>
        </div>
        <div className="result-meta-right">
          {match.guest_name ? <span className="result-tag">{match.guest_name}</span> : null}
          {isSemantic ? (
            <span className="result-tag result-tag-ghost">Semantic</span>
          ) : null}
        </div>
      </header>

      <p className="result-text">{match.match_reason || match.summary}</p>

      {expanded ? (
        <p className="result-transcript">
          {highlightSnippet(match.transcript_snippet, query)}
        </p>
      ) : null}

      <footer className="result-actions">
        <a className="btn btn-primary" href={match.clip_url} target="_blank" rel="noreferrer">
          Watch clip
        </a>
        <button className="result-link" type="button" onClick={onToggle}>
          {expanded ? "Hide transcript" : "View transcript"}
        </button>
        <Link className="result-link" href={`/episode/${match.episode_id}`}>
          Full episode
        </Link>
      </footer>
    </article>
  );
}
