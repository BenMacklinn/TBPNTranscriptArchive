const SPEAKER_BREAK = /\s*>>+\s*/g;

function normalizeLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

export function formatTranscriptLines(text: string) {
  return text
    .replace(SPEAKER_BREAK, "\n")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean);
}

export function formatTranscriptForDisplay(text: string) {
  return formatTranscriptLines(text).join("\n");
}
