import type { HybridSearchRow } from "@/lib/supabase";
import { formatTranscriptForDisplay, formatTranscriptLines } from "@/lib/format-transcript";

export type SearchConfidence = "strong" | "medium" | "weak" | "no";

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "been",
  "being",
  "could",
  "does",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "most",
  "over",
  "some",
  "than",
  "that",
  "their",
  "there",
  "these",
  "this",
  "those",
  "through",
  "today",
  "under",
  "with",
  "would",
  "will",
  "your",
  "when",
  "where",
  "what",
  "which",
  "who",
  "how",
  "talk",
  "talked",
  "discuss",
  "discussed",
  "said",
  "clip",
  "episode",
  "stream",
  "tbpn",
]);

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/&amp;/g, " and ")
    .replace(/[@#]/g, "")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeImportantTerms(text: string) {
  return unique(
    normalizeText(text)
      .split(" ")
      .map((word) => word.replace(/^[.-]+|[.-]+$/g, ""))
      .filter((word) => word.length > 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word)),
  );
}

// Terms ignored for search ranking but still highlighted when the user types them.
const HIGHLIGHTABLE_STOPWORDS = new Set([
  "tbpn",
  "clip",
  "episode",
  "stream",
  "talk",
  "talked",
  "discuss",
  "discussed",
  "said",
]);

export function tokenizeHighlightTerms(text: string) {
  return unique(
    normalizeText(text)
      .split(" ")
      .map((word) => word.replace(/^[.-]+|[.-]+$/g, ""))
      .filter((word) => {
        if (word.length <= 1 || /^\d+$/.test(word)) {
          return false;
        }
        if (HIGHLIGHTABLE_STOPWORDS.has(word)) {
          return true;
        }
        return word.length > 2 && !STOPWORDS.has(word);
      }),
  );
}

export function extractEntities(text: string) {
  const properNouns = [...text.matchAll(/\b[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3}\b/g)]
    .map((match) => match[0].toLowerCase())
    .filter((entity) => entity.length > 3 && !STOPWORDS.has(entity));
  return unique(properNouns);
}

function overlap(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function confidenceRank(confidence: SearchConfidence) {
  return { no: 0, weak: 1, medium: 2, strong: 3 }[confidence];
}

export type QuerySignals = {
  terms: string[];
  entityPhrases: string[];
  entities: string[];
};

export function parseQuerySignals(query: string): QuerySignals {
  const terms = tokenizeImportantTerms(query);
  const entities = extractEntities(query);
  const entityPhrases = entities.filter((entity) => entity.includes(" "));

  return {
    terms,
    entityPhrases: unique(entityPhrases),
    entities,
  };
}

function normalizeVectorScores(rows: HybridSearchRow[]) {
  const scores = rows.map((row) => row.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  return new Map(
    rows.map((row) => [row.chunk_id, clamp((row.score - min) / range)] as const),
  );
}

function deriveConfidence(input: {
  vectorScore: number;
  totalScore: number;
  sharedTerms: string[];
  sharedEntities: string[];
  queryEntityCount: number;
  entityPartsInChunk: number;
  entityPartsRequired: number;
}): SearchConfidence {
  const hasSpecificEvidence =
    input.sharedEntities.length > 0 ||
    input.sharedTerms.length >= 3 ||
    (input.queryEntityCount > 0 && input.entityPartsInChunk > 0);

  if (input.queryEntityCount > 0 && input.entityPartsInChunk === 0) {
    return input.sharedTerms.length >= 2 ? "weak" : "no";
  }

  if (
    input.entityPartsRequired > 0 &&
    input.entityPartsInChunk < input.entityPartsRequired
  ) {
    return input.entityPartsInChunk > 0 ? "weak" : "no";
  }

  if (input.totalScore >= 0.68 && (hasSpecificEvidence || input.vectorScore >= 0.72)) {
    return "strong";
  }

  if (input.totalScore >= 0.6 && (hasSpecificEvidence || input.vectorScore >= 0.68)) {
    return "medium";
  }

  if (input.totalScore >= 0.58 || input.sharedTerms.length > 0) {
    return "weak";
  }

  return "no";
}

function scoreChunkCandidate(input: {
  query: string;
  signals: QuerySignals;
  row: HybridSearchRow;
  vectorScore: number;
}) {
  const chunkText = input.row.chunk_text;
  const episodeTitle = input.row.episode_title;
  const chunkTerms = tokenizeImportantTerms(`${chunkText} ${episodeTitle}`);
  const chunkEntities = extractEntities(`${chunkText} ${episodeTitle}`);
  const queryTerms = input.signals.terms;
  const queryEntities = unique([
    ...input.signals.entities,
    ...input.signals.entityPhrases,
  ]);

  const sharedTerms = overlap(queryTerms, chunkTerms).slice(0, 12);
  const sharedEntities = overlap(queryEntities, chunkEntities).slice(0, 8);

  const entityPartsRequired = input.signals.entityPhrases.reduce(
    (count, phrase) => count + phrase.split(" ").filter(Boolean).length,
    0,
  );
  const normalizedChunk = normalizeText(`${chunkText} ${episodeTitle}`);
  const entityPartsInChunk = input.signals.entityPhrases.reduce((count, phrase) => {
    return (
      count +
      phrase.split(" ").filter(Boolean).filter((part) => normalizedChunk.includes(part)).length
    );
  }, 0);

  const minTermCount = Math.max(1, Math.min(queryTerms.length, chunkTerms.length));
  const containment = sharedTerms.length / minTermCount;
  const termScore = clamp(containment * 0.34, 0, 0.34);
  const entityScore = clamp(sharedEntities.length * 0.07, 0, 0.24);
  const chunkEntityBonus = clamp(entityPartsInChunk * 0.04, 0, 0.2);
  const ruleScore = clamp(termScore + entityScore + chunkEntityBonus);
  const totalScore = clamp(input.vectorScore * 0.82 + ruleScore * 0.18);

  const confidence = deriveConfidence({
    vectorScore: input.vectorScore,
    totalScore,
    sharedTerms,
    sharedEntities,
    queryEntityCount: queryEntities.length,
    entityPartsInChunk,
    entityPartsRequired,
  });

  return {
    confidence,
    totalScore,
    vectorScore: input.vectorScore,
    ruleScore,
    sharedTerms,
    sharedEntities,
    chunkTermHits: sharedTerms.filter((term) =>
      normalizeText(chunkText).includes(term),
    ).length,
  };
}

function countTermHits(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  return terms.reduce(
    (count, term) => count + (normalized.includes(normalizeText(term)) ? 1 : 0),
    0,
  );
}

export function extractMatchSentence(text: string, terms: string[]) {
  const uniqueTerms = unique(terms.map((term) => term.trim()).filter(Boolean));
  if (!text.trim() || uniqueTerms.length === 0) {
    return null;
  }

  const formatted = formatTranscriptForDisplay(text);
  const lines = formatTranscriptLines(text);
  const sentences = formatted
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const candidates =
    lines.length > 1
      ? lines
      : sentences.length > 0
        ? sentences
        : [formatted.trim()];

  let bestSentence = candidates[0];
  let bestScore = -1;

  for (const sentence of candidates) {
    const score = countTermHits(sentence, uniqueTerms);
    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  if (bestScore > 0) {
    return bestSentence;
  }

  for (const term of uniqueTerms) {
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const match = formatted.match(pattern);
    if (match?.index != null) {
      const start = Math.max(0, match.index - 90);
      const end = Math.min(formatted.length, match.index + term.length + 140);
      let excerpt = formatted.slice(start, end).trim();
      if (start > 0) {
        excerpt = `…${excerpt}`;
      }
      if (end < formatted.length) {
        excerpt = `${excerpt}…`;
      }
      return excerpt;
    }
  }

  return null;
}

function buildMatchReason(input: {
  sharedTerms: string[];
  sharedEntities: string[];
  vectorScore: number;
  matchType: "keyword" | "semantic" | "hybrid";
}): string {
  if (input.sharedEntities.length > 0 && input.sharedTerms.length > 0) {
    return `Mentions ${input.sharedEntities.join(", ")} and uses your terms ${input.sharedTerms.slice(0, 4).join(", ")}.`;
  }

  if (input.sharedEntities.length > 0) {
    return `Mentions ${input.sharedEntities.join(", ")} from your search.`;
  }

  if (input.sharedTerms.length >= 2) {
    return `Uses your search terms: ${input.sharedTerms.slice(0, 5).join(", ")}.`;
  }

  if (input.sharedTerms.length === 1) {
    return `Mentions "${input.sharedTerms[0]}" from your query.`;
  }

  if (input.matchType === "semantic" || input.matchType === "hybrid") {
    return "Same topic as your query — matched by meaning, not exact wording.";
  }

  return "Related to your search terms.";
}

function normalizeForMatch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function shouldExcludeTerm(term: string, exclude: Set<string>) {
  const normalized = normalizeForMatch(term);
  if (exclude.has(normalized)) {
    return true;
  }

  return [...exclude].some(
    (needle) => normalized.includes(needle) || needle.includes(normalized),
  );
}

function filterExcludedTerms(terms: string[], exclude: Set<string>) {
  return terms.filter((term) => !shouldExcludeTerm(term, exclude));
}

function buildExcludeSet(guestName?: string) {
  const exclude = new Set<string>();
  if (!guestName?.trim()) {
    return exclude;
  }

  exclude.add(normalizeForMatch(guestName));
  for (const part of guestName.split(/\s+/)) {
    if (part.length > 2) {
      exclude.add(normalizeForMatch(part));
    }
  }

  return exclude;
}

export function formatMatchReason(
  row: Pick<RankedSearchResult, "shared_terms" | "shared_entities" | "match_type">,
  options?: { guestName?: string },
) {
  const exclude = buildExcludeSet(options?.guestName);
  const sharedTerms = filterExcludedTerms(row.shared_terms, exclude);
  const sharedEntities = filterExcludedTerms(row.shared_entities, exclude);

  return buildMatchReason({
    sharedTerms,
    sharedEntities,
    vectorScore: 0,
    matchType: row.match_type,
  });
}

function deriveMatchType(ruleScore: number, vectorScore: number) {
  if (ruleScore >= 0.2 && vectorScore >= 0.45) {
    return "hybrid" as const;
  }
  if (ruleScore >= 0.12) {
    return "keyword" as const;
  }
  return "semantic" as const;
}

export type RankedSearchResult = HybridSearchRow & {
  confidence: SearchConfidence;
  reason: string;
  shared_terms: string[];
  shared_entities: string[];
  match_type: "keyword" | "semantic" | "hybrid";
  vector_score: number;
  rule_score: number;
};

function rankRows(query: string, rows: HybridSearchRow[]): RankedSearchResult[] {
  if (rows.length === 0) {
    return [];
  }

  const signals = parseQuerySignals(query);
  const vectorScores = normalizeVectorScores(rows);

  const ranked = rows.map((row) => {
    const scored =
      signals.terms.length === 0 && signals.entities.length === 0
        ? {
            confidence: "weak" as SearchConfidence,
            totalScore: row.score,
            vectorScore: vectorScores.get(row.chunk_id) ?? 0,
            ruleScore: 0,
            sharedTerms: [] as string[],
            sharedEntities: [] as string[],
            chunkTermHits: 0,
          }
        : scoreChunkCandidate({
            query,
            signals,
            row,
            vectorScore: vectorScores.get(row.chunk_id) ?? 0,
          });

    const matchType = deriveMatchType(scored.ruleScore, scored.vectorScore);
    const confidence = scored.confidence;
    const reason = buildMatchReason({
      sharedTerms: scored.sharedTerms,
      sharedEntities: scored.sharedEntities,
      vectorScore: scored.vectorScore,
      matchType,
    });

    return {
      row,
      ...scored,
      matchType,
      reason,
    };
  });

  ranked.sort((left, right) => {
    const confidenceDiff = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }
    if (right.chunkTermHits !== left.chunkTermHits) {
      return right.chunkTermHits - left.chunkTermHits;
    }
    if (right.totalScore !== left.totalScore) {
      return right.totalScore - left.totalScore;
    }
    if (right.ruleScore !== left.ruleScore) {
      return right.ruleScore - left.ruleScore;
    }
    return right.vectorScore - left.vectorScore;
  });

  return ranked.map(
    ({
      row,
      totalScore,
      confidence,
      reason,
      sharedTerms,
      sharedEntities,
      matchType,
      vectorScore,
      ruleScore,
    }) => ({
      ...row,
      score: totalScore,
      confidence,
      reason,
      shared_terms: sharedTerms,
      shared_entities: sharedEntities,
      match_type: matchType,
      vector_score: vectorScore,
      rule_score: ruleScore,
    }),
  );
}

export function rerankSearchResults(query: string, rows: HybridSearchRow[]): HybridSearchRow[] {
  return rankRows(query, rows);
}

export function rerankSearchResultsDetailed(
  query: string,
  rows: HybridSearchRow[],
): RankedSearchResult[] {
  return rankRows(query, rows);
}

const RELEVANT_CONFIDENCE = new Set<SearchConfidence>(["strong", "medium"]);

/** Keep only confident matches, up to a ceiling — not a quota. */
export function takeRelevantResults(
  rows: RankedSearchResult[],
  maxResults = 8,
): RankedSearchResult[] {
  return rows.filter((row) => RELEVANT_CONFIDENCE.has(row.confidence)).slice(0, maxResults);
}
