import type { HybridSearchRow } from "@/lib/supabase";
import { formatTranscriptForDisplay, formatTranscriptLines } from "@/lib/format-transcript";

export type SearchConfidence = "strong" | "medium" | "weak" | "no";

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "any",
  "are",
  "because",
  "been",
  "being",
  "but",
  "can",
  "could",
  "did",
  "does",
  "for",
  "from",
  "get",
  "had",
  "has",
  "have",
  "her",
  "him",
  "his",
  "into",
  "its",
  "just",
  "like",
  "more",
  "most",
  "not",
  "now",
  "off",
  "one",
  "our",
  "out",
  "over",
  "put",
  "say",
  "see",
  "she",
  "some",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "today",
  "too",
  "two",
  "under",
  "use",
  "was",
  "way",
  "were",
  "who",
  "with",
  "would",
  "will",
  "you",
  "your",
  "when",
  "where",
  "what",
  "which",
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseHasHighlightableWord(phrase: string) {
  return phrase
    .split(/\s+/)
    .some((word) => word.length > 2 && !STOPWORDS.has(word) && !HIGHLIGHTABLE_STOPWORDS.has(word));
}

export function getHighlightTerms(query: string, extraTerms: string[] = []) {
  const terms = new Set<string>(tokenizeHighlightTerms(query));

  for (const raw of extraTerms) {
    const term = raw.trim().toLowerCase();
    if (!term) {
      continue;
    }

    if (term.includes(" ")) {
      if (phraseHasHighlightableWord(term)) {
        terms.add(term);
      }
      for (const part of term.split(/\s+/)) {
        if (part.length > 2 && !STOPWORDS.has(part) && !HIGHLIGHTABLE_STOPWORDS.has(part)) {
          terms.add(part);
        }
      }
      continue;
    }

    if (term.length > 2 && !STOPWORDS.has(term) && !HIGHLIGHTABLE_STOPWORDS.has(term)) {
      terms.add(term);
    }
  }

  return [...terms].sort((left, right) => right.length - left.length);
}

export function getDisplayHighlightTerms(query: string, extraTerms: string[] = []) {
  const terms = new Set<string>(getHighlightTerms(query, extraTerms));
  const normalizedQuery = normalizeText(query);
  const queryWords = normalizedQuery
    .split(" ")
    .map((word) => word.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((word) => word.length >= 2 && !/^\d+$/.test(word));

  for (const word of queryWords) {
    terms.add(word);
  }

  if (queryWords.length >= 2) {
    terms.add(normalizedQuery);
  }

  return [...terms].sort((left, right) => right.length - left.length);
}

export function buildHighlightPattern(terms: string[]) {
  if (terms.length === 0) {
    return null;
  }

  const pattern = terms.map((term) => escapeRegExp(term)).join("|");
  return new RegExp(`(?<![\\w-])(${pattern})(?![\\w-])`, "gi");
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
  return terms.reduce((count, term) => {
    const pattern = new RegExp(
      `(?<![\\w-])${escapeRegExp(normalizeText(term))}(?![\\w-])`,
      "i",
    );
    return count + (pattern.test(normalized) ? 1 : 0);
  }, 0);
}

function splitIntoSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function collectSentenceCandidates(text: string) {
  const formatted = formatTranscriptForDisplay(text);
  const fromLines = formatTranscriptLines(text).flatMap((line) => splitIntoSentences(line));
  const fromBlocks = splitIntoSentences(formatted.replace(/\n+/g, " "));
  return unique([...fromLines, ...fromBlocks, formatted.trim()].filter(Boolean));
}

function trimAroundTermMatch(sentence: string, terms: string[]) {
  if (sentence.length <= 280) {
    return sentence;
  }

  const normalized = normalizeText(sentence);
  for (const term of terms) {
    const pattern = new RegExp(
      `(?<![\\w-])${escapeRegExp(normalizeText(term))}(?![\\w-])`,
      "i",
    );
    const match = normalized.match(pattern);
    if (match?.index == null) {
      continue;
    }

    const ratio = sentence.length / Math.max(normalized.length, 1);
    const approxStart = Math.max(0, Math.floor(match.index * ratio) - 100);
    const approxEnd = Math.min(sentence.length, approxStart + 260);
    let excerpt = sentence.slice(approxStart, approxEnd).trim();
    if (approxStart > 0) {
      excerpt = `…${excerpt}`;
    }
    if (approxEnd < sentence.length) {
      excerpt = `${excerpt}…`;
    }
    return excerpt;
  }

  return `${sentence.slice(0, 277).trim()}…`;
}

export function hasWordForWordMatch(
  match: Pick<SearchMatchLike, "shared_terms" | "shared_entities">,
  query: string,
) {
  const wordMatchTerms = [...match.shared_terms, ...match.shared_entities].filter(Boolean);
  const highlightTerms = getHighlightTerms(query, wordMatchTerms);
  return (
    highlightTerms.length > 0 &&
    (match.shared_terms.length > 0 || match.shared_entities.length > 0)
  );
}

type SearchMatchLike = {
  shared_terms: string[];
  shared_entities: string[];
  match_type: "keyword" | "semantic" | "hybrid";
};

export function extractMatchSentence(text: string, terms: string[]) {
  const uniqueTerms = unique(terms.map((term) => term.trim()).filter(Boolean));
  if (!text.trim() || uniqueTerms.length === 0) {
    return null;
  }

  const candidates = collectSentenceCandidates(text);
  let bestSentence = candidates[0];
  let bestScore = -1;

  for (const sentence of candidates) {
    const score = countTermHits(sentence, uniqueTerms);
    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  if (bestScore <= 0 || !bestSentence) {
    return null;
  }

  return trimAroundTermMatch(bestSentence, uniqueTerms);
}

export function resolveMatchPreview(input: {
  query: string;
  transcript: string;
  sharedTerms: string[];
  sharedEntities: string[];
  matchReason: string;
  summary: string;
}) {
  const wordMatchTerms = [...input.sharedTerms, ...input.sharedEntities].filter(Boolean);
  const highlightTerms = getHighlightTerms(input.query, wordMatchTerms);
  const exactMatch = hasWordForWordMatch(
    {
      shared_terms: input.sharedTerms,
      shared_entities: input.sharedEntities,
    },
    input.query,
  );

  if (exactMatch) {
    const sentence = extractMatchSentence(input.transcript, highlightTerms);
    if (sentence) {
      return { mode: "sentence" as const, text: sentence, highlightTerms: wordMatchTerms };
    }
  }

  return {
    mode: "reason" as const,
    text: input.matchReason || input.summary,
    highlightTerms: wordMatchTerms,
  };
}

function summarizeQueryPhrase(query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return "your search";
  }
  if (trimmed.length <= 72) {
    return `"${trimmed}"`;
  }
  return `"${trimmed.slice(0, 69)}..."`;
}

function termFrequencyInText(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  const freq = new Map<string, number>();

  for (const term of terms) {
    const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(term)}(?![\\w-])`, "gi");
    freq.set(term, (normalized.match(pattern) || []).length);
  }

  return freq;
}

function extractTopChunkTerms(
  chunkText: string,
  episodeTitle: string,
  excludeTerms: Set<string>,
  limit = 4,
) {
  const corpus = `${chunkText} ${episodeTitle}`;
  const terms = tokenizeImportantTerms(corpus);
  const freq = termFrequencyInText(corpus, terms);

  return terms
    .filter((term) => !excludeTerms.has(term) && (freq.get(term) ?? 0) > 0)
    .sort((left, right) => (freq.get(right) ?? 0) - (freq.get(left) ?? 0))
    .slice(0, limit);
}

function findRelatedWording(queryTerms: string[], chunkText: string, episodeTitle: string) {
  const chunkTerms = tokenizeImportantTerms(`${chunkText} ${episodeTitle}`);
  const related = new Set<string>();

  for (const queryTerm of queryTerms) {
    for (const chunkTerm of chunkTerms) {
      if (queryTerm === chunkTerm) {
        continue;
      }

      const stemLength = Math.min(queryTerm.length, chunkTerm.length, 6);
      if (stemLength >= 4 && queryTerm.slice(0, stemLength) === chunkTerm.slice(0, stemLength)) {
        related.add(chunkTerm);
      }
    }

    const normalized = normalizeText(chunkText);
    for (const word of normalized.split(/\s+/)) {
      if (word.length < 4 || queryTerm.length < 4 || word === queryTerm) {
        continue;
      }

      if (word.startsWith(queryTerm.slice(0, 5)) || queryTerm.startsWith(word.slice(0, 5))) {
        related.add(word);
      }
    }
  }

  return [...related].slice(0, 4);
}

function buildSemanticMatchReason(input: {
  query: string;
  chunkText: string;
  episodeTitle: string;
  vectorScore: number;
  queryTerms: string[];
}) {
  const queryPhrase = summarizeQueryPhrase(input.query);
  const excludeTerms = new Set(input.queryTerms);
  const relatedWording = findRelatedWording(input.queryTerms, input.chunkText, input.episodeTitle);

  if (relatedWording.length > 0) {
    const wording = relatedWording.map((term) => `"${term}"`).join(", ");
    return `Discusses similar ideas using ${wording}, connected to ${queryPhrase}.`;
  }

  const topChunkTerms = extractTopChunkTerms(
    input.chunkText,
    input.episodeTitle,
    excludeTerms,
    4,
  );

  if (topChunkTerms.length >= 2) {
    return `Covers ${topChunkTerms.slice(0, 3).join(", ")} in a segment tied to ${queryPhrase}.`;
  }

  if (topChunkTerms.length === 1) {
    return `Centers on ${topChunkTerms[0]} in a segment tied to ${queryPhrase}.`;
  }

  const snippet = collectSentenceCandidates(input.chunkText)[0];
  if (snippet) {
    const preview = snippet.length <= 120 ? snippet : `${snippet.slice(0, 117).trim()}…`;
    return `Matched this segment — "${preview}" — because it relates to ${queryPhrase}.`;
  }

  if (input.vectorScore >= 0.72) {
    return `Strong contextual overlap with ${queryPhrase} in this part of the episode.`;
  }

  if (input.vectorScore >= 0.55) {
    return `Likely related to ${queryPhrase} based on what is being discussed here.`;
  }

  return `Possible connection to ${queryPhrase} from the surrounding conversation.`;
}

function buildMatchReason(input: {
  sharedTerms: string[];
  sharedEntities: string[];
  vectorScore: number;
  matchType: "keyword" | "semantic" | "hybrid";
  query?: string;
  chunkText?: string;
  episodeTitle?: string;
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

  if (input.query && input.chunkText) {
    return buildSemanticMatchReason({
      query: input.query,
      chunkText: input.chunkText,
      episodeTitle: input.episodeTitle ?? "",
      vectorScore: input.vectorScore,
      queryTerms: tokenizeImportantTerms(input.query),
    });
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
  row: Pick<
    RankedSearchResult,
    | "shared_terms"
    | "shared_entities"
    | "match_type"
    | "chunk_text"
    | "episode_title"
    | "vector_score"
  >,
  options?: { guestName?: string; query?: string },
) {
  const exclude = buildExcludeSet(options?.guestName);
  const sharedTerms = filterExcludedTerms(row.shared_terms, exclude);
  const sharedEntities = filterExcludedTerms(row.shared_entities, exclude);

  return buildMatchReason({
    sharedTerms,
    sharedEntities,
    vectorScore: row.vector_score,
    matchType: row.match_type,
    query: options?.query,
    chunkText: row.chunk_text,
    episodeTitle: row.episode_title,
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
      query,
      chunkText: row.chunk_text,
      episodeTitle: row.episode_title,
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
