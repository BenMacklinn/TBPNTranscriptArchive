import { getMissingCaptionEpisodes } from "@/lib/supabase";
import { MissingTranscriptsMenu } from "./missing-transcripts-menu";

export async function ArchiveDisclaimer() {
  let missingEpisodes: Awaited<ReturnType<typeof getMissingCaptionEpisodes>> = [];

  try {
    missingEpisodes = await getMissingCaptionEpisodes();
  } catch {
    missingEpisodes = [];
  }

  return <MissingTranscriptsMenu episodes={missingEpisodes} />;
}
