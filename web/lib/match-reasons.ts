import OpenAI from "openai";
import { formatTranscriptForDisplay } from "@/lib/format-transcript";
import { hasWordForWordMatch } from "@/lib/rerank";
import type { SearchMatch } from "@/lib/supabase";

const REASON_MODEL = "gpt-4o-mini";
const MAX_SNIPPET_CHARS = 700;

type ReasonRequest = {
  transcript: string;
  episodeTitle?: string;
  guestName?: string;
};

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  return new OpenAI({ apiKey });
}

function trimSnippet(text: string) {
  const formatted = formatTranscriptForDisplay(text).replace(/\s+/g, " ").trim();
  if (formatted.length <= MAX_SNIPPET_CHARS) {
    return formatted;
  }
  return `${formatted.slice(0, MAX_SNIPPET_CHARS - 1).trim()}…`;
}

function buildClipBrief(request: ReasonRequest, index: number) {
  const lines = [`Clip ${index + 1}:`];
  if (request.episodeTitle) {
    lines.push(`Episode: ${request.episodeTitle}`);
  }
  if (request.guestName) {
    lines.push(`Guest segment: ${request.guestName}`);
  }
  lines.push(`Transcript: ${trimSnippet(request.transcript)}`);
  return lines.join("\n");
}

async function generateLlmReasons(query: string, requests: ReasonRequest[]) {
  const openai = getOpenAI();
  if (!openai || requests.length === 0) {
    return [];
  }

  const clipBlock = requests.map((request, index) => buildClipBrief(request, index)).join("\n\n");

  const response = await openai.chat.completions.create({
    model: REASON_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You explain why podcast transcript clips match a user's search. " +
          "Return JSON only: {\"reasons\": string[]}. " +
          "Each reason is one sentence, max 28 words, specific about what the clip discusses and why it fits the query. " +
          "Do not use generic phrases like 'matched by meaning', 'same topic', or 'semantically similar'. " +
          "Do not invent facts beyond the transcript.",
      },
      {
        role: "user",
        content: `Search query: ${query}\n\n${clipBlock}\n\nWrite ${requests.length} reasons in the same order as the clips.`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return [];
  }

  const parsed = JSON.parse(content) as { reasons?: unknown };
  if (!Array.isArray(parsed.reasons)) {
    return [];
  }

  return parsed.reasons
    .filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
    .map((reason) => reason.trim());
}

export async function enrichMatchReasonsWithLlm(query: string, matches: SearchMatch[]) {
  if (!process.env.OPENAI_API_KEY?.trim() || matches.length === 0) {
    return matches;
  }

  const targets = matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => !hasWordForWordMatch(match, query));

  if (targets.length === 0) {
    return matches;
  }

  try {
    const reasons = await generateLlmReasons(
      query,
      targets.map(({ match }) => ({
        transcript: match.transcript_snippet,
        episodeTitle: match.title,
        guestName: match.guest_name,
      })),
    );

    if (reasons.length === 0) {
      return matches;
    }

    const updated = matches.map((match) => ({ ...match }));
    targets.forEach(({ index }, reasonIndex) => {
      const reason = reasons[reasonIndex];
      if (!reason) {
        return;
      }
      updated[index] = {
        ...updated[index],
        match_reason: reason,
        summary: reason,
      };
    });

    return updated;
  } catch (error) {
    console.error("LLM match reason generation failed:", error);
    return matches;
  }
}
