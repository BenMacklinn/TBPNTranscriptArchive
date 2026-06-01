export type PineconeChunkMatch = {
  chunkId: string;
  score: number;
};

type PineconeQueryMatch = {
  id: string;
  score?: number;
};

type PineconeQueryResponse = {
  matches?: PineconeQueryMatch[];
};

export type PineconeChunkFilter = {
  dateFrom?: string | null;
  dateTo?: string | null;
  episodeId?: string | null;
  minStartSeconds?: number | null;
  maxStartSeconds?: number | null;
};

const PINECONE_API_VERSION = "2025-10";
const DEFAULT_PINECONE_INDEX_NAME = "tbpn-transcript-chunks";
const DEFAULT_PINECONE_NAMESPACE = "production";

let resolvedHost: string | null = null;

function getPineconeApiKey() {
  return process.env.PINECONE_API_KEY?.trim() || "";
}

export function isPineconeConfigured() {
  return Boolean(getPineconeApiKey());
}

export function getPineconeNamespace() {
  return process.env.PINECONE_NAMESPACE?.trim() || DEFAULT_PINECONE_NAMESPACE;
}

function getPineconeIndexName() {
  return process.env.PINECONE_INDEX_NAME?.trim() || DEFAULT_PINECONE_INDEX_NAME;
}

function normalizeHost(host: string) {
  return host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
}

async function getPineconeIndexHost() {
  const configuredHost = process.env.PINECONE_INDEX_HOST?.trim();
  if (configuredHost) {
    return normalizeHost(configuredHost);
  }

  if (resolvedHost) {
    return resolvedHost;
  }

  const apiKey = getPineconeApiKey();
  if (!apiKey) {
    throw new Error("PINECONE_API_KEY is not configured");
  }

  const response = await fetch(
    `https://api.pinecone.io/indexes/${encodeURIComponent(getPineconeIndexName())}`,
    {
      headers: {
        "Api-Key": apiKey,
        "X-Pinecone-API-Version": PINECONE_API_VERSION,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to resolve Pinecone index host: ${response.statusText}`);
  }

  const body = (await response.json()) as { host?: string };
  if (!body.host) {
    throw new Error("Pinecone index response did not include a host");
  }

  resolvedHost = normalizeHost(body.host);
  return resolvedHost;
}

function dateToNumber(date: string) {
  return Number(date.replaceAll("-", ""));
}

function buildPineconeFilter(filter: PineconeChunkFilter) {
  const clauses: Record<string, unknown>[] = [];

  if (filter.episodeId) {
    clauses.push({ episode_id: { $eq: filter.episodeId } });
  }
  if (filter.dateFrom) {
    clauses.push({ published_date_num: { $gte: dateToNumber(filter.dateFrom) } });
  }
  if (filter.dateTo) {
    clauses.push({ published_date_num: { $lte: dateToNumber(filter.dateTo) } });
  }
  if (filter.minStartSeconds != null) {
    clauses.push({ start_seconds: { $gte: filter.minStartSeconds } });
  }
  if (filter.maxStartSeconds != null) {
    clauses.push({ start_seconds: { $lt: filter.maxStartSeconds } });
  }

  if (clauses.length === 0) {
    return undefined;
  }
  if (clauses.length === 1) {
    return clauses[0];
  }
  return { $and: clauses };
}

export async function queryPineconeChunks(options: {
  vector: number[];
  topK: number;
  filter?: PineconeChunkFilter;
}) {
  const apiKey = getPineconeApiKey();
  if (!apiKey) {
    return [];
  }

  const host = await getPineconeIndexHost();
  const response = await fetch(`${host}/query`, {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": PINECONE_API_VERSION,
    },
    body: JSON.stringify({
      vector: options.vector,
      topK: options.topK,
      namespace: getPineconeNamespace(),
      includeMetadata: false,
      includeValues: false,
      filter: options.filter ? buildPineconeFilter(options.filter) : undefined,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Pinecone query failed: ${message || response.statusText}`);
  }

  const body = (await response.json()) as PineconeQueryResponse;
  return (body.matches ?? []).map((match) => ({
    chunkId: match.id,
    score: match.score ?? 0,
  }));
}
