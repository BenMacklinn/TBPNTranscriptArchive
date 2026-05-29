import { buildClipEmbedUrl } from "@/lib/supabase";

type ClipEmbedProps = {
  youtubeVideoId: string;
  startSeconds: number;
  title: string;
};

export function ClipEmbed({ youtubeVideoId, startSeconds, title }: ClipEmbedProps) {
  const embedUrl = buildClipEmbedUrl(youtubeVideoId, startSeconds);

  return (
    <div className="clip-embed">
      <iframe
        src={embedUrl}
        title={`${title} clip`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}
