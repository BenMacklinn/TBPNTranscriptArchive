export function encodePathSegment(value: string) {
  return encodeURIComponent(value.trim().toLowerCase().replace(/\s+/g, "-"));
}

export function buildGuestLookupPath(needle: string) {
  return `/api/guests/${encodePathSegment(needle)}`;
}

export function buildSearchPath(options: {
  query: string;
  guestName?: string;
  episodeId?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const topic = encodePathSegment(options.query);
  const params = new URLSearchParams();
  if (options.dateFrom) {
    params.set("from", options.dateFrom);
  }
  if (options.dateTo) {
    params.set("to", options.dateTo);
  }

  if (options.guestName?.trim()) {
    if (options.episodeId) {
      params.set("episode", options.episodeId);
    }
    const queryString = params.toString();
    return `/api/guests/${encodePathSegment(options.guestName)}/search/${topic}${
      queryString ? `?${queryString}` : ""
    }`;
  }

  if (options.episodeId) {
    const queryString = params.toString();
    return `/api/episodes/${encodeURIComponent(options.episodeId)}/search/${topic}${
      queryString ? `?${queryString}` : ""
    }`;
  }

  const queryString = params.toString();
  return `/api/search/${topic}${queryString ? `?${queryString}` : ""}`;
}

export function buildTranscriptPath(episodeId: string) {
  return `/api/episodes/${encodeURIComponent(episodeId)}/transcript`;
}
