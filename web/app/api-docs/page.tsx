import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API — TBPN Transcript Archive",
  description: "TBPN transcript archive API endpoints.",
};

type EndpointDoc = {
  title: string;
  summary: string;
  path: string;
  example: string;
};

const endpoints: EndpointDoc[] = [
  {
    title: "Search",
    summary: "Search all episodes for a topic.",
    path: "GET /api/search/{query}",
    example: `{
  "query": "ai agents",
  "matches": [
    {
      "episode_id": "2025-05-01-tbpn",
      "title": "TBPN | May 1, 2025",
      "date": "2025-05-01",
      "start_time": "01:23:45",
      "end_time": "01:24:30",
      "clip_url": "https://www.youtube.com/watch?v=abc123&t=5025",
      "transcript_snippet": "...",
      "score": 0.82,
      "rank": 1,
      "confidence": "strong",
      "match_reason": "Discusses AI agent frameworks.",
      "match_type": "hybrid"
    }
  ]
}`,
  },
  {
    title: "Episode search",
    summary: "Search within one episode.",
    path: "GET /api/episodes/{id}/search/{query}",
    example: `{
  "query": "nvidia",
  "episodeId": "2025-05-01-tbpn",
  "matches": []
}`,
  },
  {
    title: "Guest search",
    summary: "Search what a guest said about a topic.",
    path: "GET /api/guests/{guest}/search/{topic}",
    example: `{
  "query": "openai",
  "guestName": "Sam Altman",
  "windowsSearched": 3,
  "matches": []
}`,
  },
  {
    title: "Guest lookup",
    summary: "Find guest names for autocomplete.",
    path: "GET /api/guests/{guest}",
    example: `{
  "guests": [
    {
      "id": "sam-altman",
      "person": "Sam Altman",
      "company": "OpenAI",
      "job_position": "CEO"
    }
  ]
}`,
  },
  {
    title: "List episodes",
    summary: "All ingested episodes.",
    path: "GET /api/episodes",
    example: `{
  "episodes": [
    {
      "id": "2025-05-01-tbpn",
      "title": "TBPN | May 1, 2025",
      "published_at": "2025-05-01",
      "youtube_video_id": "abc123",
      "duration_seconds": 10800
    }
  ]
}`,
  },
  {
    title: "Episode transcript",
    summary: "Full transcript as timestamped chunks.",
    path: "GET /api/episodes/{id}/transcript",
    example: `{
  "episode": {
    "id": "2025-05-01-tbpn",
    "title": "TBPN | May 1, 2025",
    "published_at": "2025-05-01",
    "youtube_video_id": "abc123",
    "duration_seconds": 10800,
    "source_url": "https://www.youtube.com/watch?v=abc123"
  },
  "chunk_count": 142,
  "chunks": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "start_seconds": 0,
      "end_seconds": 62,
      "start_time": "00:00:00",
      "end_time": "00:01:02",
      "text": "...",
      "speaker": null,
      "clip_url": "https://www.youtube.com/watch?v=abc123&t=0",
      "words_url": "/api/chunks/550e8400-e29b-41d4-a716-446655440000"
    }
  ]
}`,
  },
  {
    title: "Chunk words",
    summary: "Word-level timestamps for a chunk.",
    path: "GET /api/chunks/{chunkId}",
    example: `{
  "episode_id": "2025-05-01-tbpn",
  "chunk": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "start_seconds": 0,
    "end_seconds": 62,
    "start_time": "00:00:00",
    "end_time": "00:01:02",
    "text": "..."
  },
  "word_count": 48,
  "words": [
    {
      "word_index": 0,
      "word": "Welcome",
      "start_seconds": 0.12,
      "end_seconds": 0.48
    }
  ]
}`,
  },
  {
    title: "Episode chunk words",
    summary: "Word timestamps for a chunk in an episode.",
    path: "GET /api/episodes/{id}/chunks/{chunkId}/words",
    example: `{
  "episode_id": "2025-05-01-tbpn",
  "chunk": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "start_seconds": 0,
    "end_seconds": 62,
    "start_time": "00:00:00",
    "end_time": "00:01:02",
    "text": "..."
  },
  "word_count": 48,
  "words": []
}`,
  },
];

export default function ApiDocsPage() {
  return (
    <main className="page api-docs-page">
      <h1 className="page-title">API</h1>

      <div className="api-endpoint-list">
        {endpoints.map((endpoint) => (
          <article className="api-endpoint" key={endpoint.path}>
            <div className="api-endpoint-intro">
              <h2 className="api-endpoint-title">{endpoint.title}</h2>
              <p className="api-endpoint-summary">{endpoint.summary}</p>
            </div>
            <code className="api-path">{endpoint.path}</code>
            <pre className="api-code">
              <code>{endpoint.example}</code>
            </pre>
          </article>
        ))}
      </div>
    </main>
  );
}
