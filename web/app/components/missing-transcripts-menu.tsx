"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatSidebarDate,
  type MissingEpisodeSummary,
} from "@/lib/supabase";

type MissingTranscriptsMenuProps = {
  episodes: MissingEpisodeSummary[];
};

export function MissingTranscriptsMenu({ episodes }: MissingTranscriptsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (!open) {
      return;
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (episodes.length === 0) {
    return null;
  }

  return (
    <div className="missing-transcripts-menu" ref={rootRef}>
      <button
        type="button"
        className="missing-transcripts-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((previous) => !previous)}
      >
        Missing transcripts
        <span className="missing-transcripts-chevron" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open ? (
        <div className="missing-transcripts-panel" role="dialog" aria-label="Missing transcripts">
          <p className="missing-transcripts-lead">
            Some days are missing because YouTube has no captions for those episodes.
          </p>
          <p className="missing-transcripts-count">
            {episodes.length} episode{episodes.length === 1 ? "" : "s"}
          </p>
          <ul className="missing-transcripts-list">
            {episodes.map((episode) => (
              <li key={episode.id}>
                <a
                  className="missing-transcripts-link"
                  href={episode.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="missing-transcripts-date">
                    {formatSidebarDate(episode.published_at)}
                  </span>
                  <span className="missing-transcripts-title">{episode.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
