import { formatTranscriptLines } from "@/lib/format-transcript";

type FormattedTranscriptProps = {
  text: string;
  className?: string;
};

export function FormattedTranscript({ text, className }: FormattedTranscriptProps) {
  const lines = formatTranscriptLines(text);

  if (lines.length <= 1) {
    return <p className={className}>{lines[0] ?? ""}</p>;
  }

  return (
    <div className={className ? `${className} transcript-lines` : "transcript-lines"}>
      {lines.map((line, index) => (
        <p className="transcript-line" key={`${index}-${line.slice(0, 24)}`}>
          {line}
        </p>
      ))}
    </div>
  );
}
