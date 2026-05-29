"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipEmbed } from "@/app/components/clip-embed";
import type { SearchMatch } from "@/lib/supabase";
import { formatDisplayDate, formatDisplayTimestamp } from "@/lib/supabase";
import { formatTranscriptLines } from "@/lib/format-transcript";
import { extractMatchSentence, tokenizeHighlightTerms } from "@/lib/rerank";

type ResultCardProps = {
  match: SearchMatch;
  query: string;
  expanded: boolean;
  onToggle: () => void;
};

function highlightSnippet(text: string, query: string, extraTerms: string[] = []) {
  const terms = [
    ...tokenizeHighlightTerms(query),
    ...extraTerms.flatMap((term) =>
      term
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((part) => part.length > 1),
    ),
  ];
  const uniqueTerms = [...new Set(terms)];
  if (!uniqueTerms.length) {
    return text;
  }

  const pattern = new RegExp(
    `(${uniqueTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    const isMatch = uniqueTerms.some((term) => part.toLowerCase() === term.toLowerCase());
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

function HighlightedTranscript({
  text,
  query,
  extraTerms,
  className,
}: {
  text: string;
  query: string;
  extraTerms: string[];
  className: string;
}) {
  const lines = formatTranscriptLines(text);

  if (lines.length <= 1) {
    return (
      <p className={className}>{highlightSnippet(lines[0] ?? text, query, extraTerms)}</p>
    );
  }

  return (
    <div className={`${className} transcript-lines`}>
      {lines.map((line, index) => (
        <p className="transcript-line" key={`${index}-${line.slice(0, 24)}`}>
          {highlightSnippet(line, query, extraTerms)}
        </p>
      ))}
    </div>
  );
}

function getWordMatchTerms(match: SearchMatch) {
  return [...match.shared_terms, ...match.shared_entities].filter(Boolean);
}

function parseClipFromUrl(clipUrl: string) {
  try {
    const url = new URL(clipUrl);
    const videoId = url.searchParams.get("v");
    const timeParam = url.searchParams.get("t") ?? "";
    const startSeconds = Number.parseInt(timeParam.replace(/\D/g, ""), 10);
    if (!videoId || Number.isNaN(startSeconds)) {
      return null;
    }
    return { youtubeVideoId: videoId, startSeconds };
  } catch {
    return null;
  }
}

export function ResultCard({ match, query, expanded, onToggle }: ResultCardProps) {
  const [clipOpen, setClipOpen] = useState(false);
  const isSemantic = match.match_type === "semantic" || match.match_type === "hybrid";
  const wordMatchTerms = getWordMatchTerms(match);
  const clipMeta =
    match.youtube_video_id != null && match.start_seconds != null
      ? { youtubeVideoId: match.youtube_video_id, startSeconds: match.start_seconds }
      : parseClipFromUrl(match.clip_url);
  const matchSentence =
    wordMatchTerms.length > 0
      ? extractMatchSentence(match.transcript_snippet, wordMatchTerms)
      : null;
  const previewText = matchSentence ?? match.match_reason ?? match.summary;

  const showSplitMedia = clipOpen && expanded && Boolean(clipMeta);

  return (
    <article
      className={`result-card${expanded ? " expanded" : ""}${clipOpen ? " clip-open" : ""}${showSplitMedia ? " media-split" : ""}`}
    >
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

      <p className="result-text">
        {matchSentence
          ? highlightSnippet(matchSentence, query, wordMatchTerms)
          : previewText}
      </p>

      {showSplitMedia ? (
        <div className="result-media-row">
          <ClipEmbed
            youtubeVideoId={clipMeta!.youtubeVideoId}
            startSeconds={clipMeta!.startSeconds}
            title={match.title}
          />
          <HighlightedTranscript
            text={match.transcript_snippet}
            query={query}
            extraTerms={wordMatchTerms}
            className="result-transcript"
          />
        </div>
      ) : (
        <>
          {expanded ? (
            <HighlightedTranscript
              text={match.transcript_snippet}
              query={query}
              extraTerms={wordMatchTerms}
              className="result-transcript"
            />
          ) : null}

          {clipOpen && clipMeta ? (
            <ClipEmbed
              youtubeVideoId={clipMeta.youtubeVideoId}
              startSeconds={clipMeta.startSeconds}
              title={match.title}
            />
          ) : null}
        </>
      )}

      <footer className="result-actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={!clipMeta}
          onClick={() => setClipOpen((open) => !open)}
        >
          {clipOpen ? "Hide clip" : "Watch clip"}
        </button>
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
