import { useState } from "react";
import { Play, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import SolidCard from './SolidCard';
import UniversalImage from './UniversalImage';

export interface VideoConfig {
  url: string;
  ratio?: string;
  muted?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  preview_image_url?: string;
  with_shadow_border?: boolean;
}

interface UniversalVideoProps extends Omit<VideoConfig, 'with_shadow_border'> {
  className?: string;
  withShadowBorder?: boolean;
  useSolidCard?: boolean;
  bordered?: boolean;
  mobileRatio?: string;
}

const isLocalVideo = (url: string): boolean => {
  const localExtensions = [".mp4", ".webm", ".mov", ".ogg", ".m4v"];
  const lowerUrl = url?.toLowerCase();
  return localExtensions.some(ext => lowerUrl?.endsWith(ext)) || 
         (url?.startsWith("/") && !url?.includes("youtube") && !url?.includes("vimeo"));
};

const isYouTubeUrl = (url: string): boolean => {
  return url?.includes("youtube.com") || url?.includes("youtu.be");
};

const extractYouTubeId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url?.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
};

const getYouTubeThumbnail = (videoId: string): string => {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
};

const parseRatio = (ratio?: string): { paddingTop: string } => {
  if (!ratio) return { paddingTop: "56.25%" };
  const [w, h] = ratio.split(":").map(Number);
  if (w && h) {
    return { paddingTop: `${(h / w) * 100}%` };
  }
  return { paddingTop: "56.25%" };
};

const parseRatioValue = (ratio?: string): number => {
  if (!ratio) return 16 / 9;
  const [w, h] = ratio.split(":").map(Number);
  if (w && h) return w / h;
  return 16 / 9;
};

const usesMobileLayout = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
};

export function UniversalVideo({
  url,
  ratio = "16:9",
  mobileRatio,
  muted = true,
  autoplay = false,
  loop = true,
  preview_image_url,
  className = "",
  withShadowBorder = false,
  useSolidCard = false,
  bordered = false,
}: UniversalVideoProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPlayingInline, setIsPlayingInline] = useState(false);
  const [videoId] = useState(() => `video-${Math.random().toString(36).substr(2, 9)}`);
  const aspectRatio = parseRatio(ratio);
  const mobileAspectRatio = mobileRatio ? parseRatio(mobileRatio) : null;
  const ratioValue = parseRatioValue(ratio);
  const borderClasses = bordered ? "border-2 border-muted-foreground/40 rounded-lg" : "";
  
  const responsiveStyles = mobileAspectRatio ? `
    #${videoId} { padding-top: ${mobileAspectRatio.paddingTop}; }
    @media (min-width: 768px) { #${videoId} { padding-top: ${aspectRatio.paddingTop}; } }
  ` : null;

  const isYouTube = isYouTubeUrl(url);
  const youtubeId = isYouTube ? extractYouTubeId(url) : null;
  
  const thumbnailUrl = preview_image_url || (youtubeId ? getYouTubeThumbnail(youtubeId) : null);

  const handleClick = () => {
    if (usesMobileLayout()) {
      setIsPlayingInline(true);
    } else {
      setIsModalOpen(true);
    }
  };

  const handleStopInline = () => {
    setIsPlayingInline(false);
  };

  const buildYouTubeEmbedUrl = (ytId: string, forInline: boolean): string => {
    const domain = 'https://www.youtube-nocookie.com';
    const params = forInline
      ? 'autoplay=1&playsinline=1&rel=0'
      : 'autoplay=1&rel=0';
    return `${domain}/embed/${ytId}?${params}`;
  };

  const renderInlinePlayer = () => {
    return (
      <>
        {responsiveStyles && <style>{responsiveStyles}</style>}
        <div
          id={mobileAspectRatio ? videoId : undefined}
          className={`relative overflow-hidden rounded-lg bg-black ${borderClasses} ${className}`}
          style={mobileAspectRatio ? undefined : aspectRatio}
          data-testid="video-inline-playing"
        >
          {isYouTube && youtubeId ? (
            <iframe
              src={buildYouTubeEmbedUrl(youtubeId, true)}
              title="Video"
              className="absolute inset-0 w-full h-full rounded-lg"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              data-testid="video-inline-player"
            />
          ) : isLocalVideo(url) ? (
            <video
              src={url}
              autoPlay
              loop={loop}
              muted={muted}
              playsInline
              controls
              className="absolute inset-0 w-full h-full object-contain rounded-lg bg-black"
              data-testid="video-inline-player"
            />
          ) : (
            <iframe
              src={url}
              title="Video"
              className="absolute inset-0 w-full h-full rounded-lg"
              allowFullScreen
              data-testid="video-inline-player"
            />
          )}
          <button
            onClick={handleStopInline}
            className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors"
            data-testid="button-close-inline-video"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
      </>
    );
  };

  const renderPreview = () => {
    if (isPlayingInline) {
      return renderInlinePlayer();
    }

    if (thumbnailUrl) {
      return (
        <>
          {responsiveStyles && <style>{responsiveStyles}</style>}
          <div 
            id={mobileAspectRatio ? videoId : undefined}
            className={`relative overflow-hidden rounded-lg cursor-pointer group ${borderClasses} ${className}`}
            style={mobileAspectRatio ? undefined : aspectRatio}
            onClick={handleClick}
            data-testid="video-preview"
          >
          <div className="absolute inset-0">
            <UniversalImage
              id={thumbnailUrl}
              alt="Video preview"
              className="w-full h-full"
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 800px"
            />
          </div>
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-primary flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <Play className="fill-current w-8 h-8 md:w-10 md:h-10 text-primary-foreground ml-1" />
            </div>
          </div>
        </div>
        </>
      );
    }

    return (
      <>
        {responsiveStyles && <style>{responsiveStyles}</style>}
        <div 
          id={mobileAspectRatio ? videoId : undefined}
          className={`relative overflow-hidden rounded-lg cursor-pointer group bg-muted ${borderClasses} ${className}`}
          style={mobileAspectRatio ? undefined : aspectRatio}
          onClick={handleClick}
          data-testid="video-placeholder"
        >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-primary/80 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <Play className="fill-current w-8 h-8 md:w-10 md:h-10 text-primary-foreground ml-1" />
          </div>
          <p className="text-sm text-muted-foreground text-center px-4">
            Video preview not available
          </p>
        </div>
      </div>
      </>
    );
  };

  const renderModalPlayer = () => {
    if (isYouTube && youtubeId) {
      return (
        <iframe
          src={buildYouTubeEmbedUrl(youtubeId, false)}
          title="Video"
          className="w-full h-full rounded-lg"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          data-testid="video-modal-player"
        />
      );
    }

    if (isLocalVideo(url)) {
      return (
        <video
          src={url}
          autoPlay
          loop={loop}
          muted={muted}
          playsInline
          controls
          className="w-full h-full object-contain rounded-lg"
          data-testid="video-modal-player"
        />
      );
    }

    return (
      <iframe
        src={url}
        title="Video"
        className="w-full h-full rounded-lg"
        allowFullScreen
        data-testid="video-modal-player"
      />
    );
  };

  const renderAutoplayInlineVideo = () => {
    return (
      <>
        {responsiveStyles && <style>{responsiveStyles}</style>}
        <div 
          id={mobileAspectRatio ? videoId : undefined}
          className={`relative overflow-hidden rounded-lg ${borderClasses} ${className}`}
          style={mobileAspectRatio ? undefined : aspectRatio}
          data-testid="video-inline"
        >
          <video
            src={url}
            autoPlay
            loop={loop}
            muted={muted}
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      </>
    );
  };

  const shouldPlayInline = autoplay && isLocalVideo(url);

  const previewContent = shouldPlayInline ? renderAutoplayInlineVideo() : renderPreview();

  const wrappedPreview = (withShadowBorder || useSolidCard) ? (
    <SolidCard className="!p-0 !min-h-0 overflow-hidden">
      {previewContent}
    </SolidCard>
  ) : previewContent;

  if (shouldPlayInline || isPlayingInline) {
    return wrappedPreview;
  }

  return (
    <>
      {wrappedPreview}
      
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent 
          className="p-4 bg-black border-none overflow-hidden flex items-center justify-center"
          style={{
            maxWidth: '90vw',
            maxHeight: '90vh',
            width: `min(90vw, calc(85vh * ${ratioValue}))`,
            height: `min(85vh, calc(90vw / ${ratioValue}))`,
          }}
          aria-describedby={undefined}
        >
          <VisuallyHidden>
            <DialogTitle>Video Player</DialogTitle>
          </VisuallyHidden>
          <div className="w-full h-full">
            {isModalOpen && renderModalPlayer()}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default UniversalVideo;
