import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatSitePath } from "@shared/formatSitePath";

interface SiteInfo {
  contentFolder: string;
}

interface SiteConfig {
  contentFolder: string;
}

export function useFormatSitePath() {
  const { data: siteInfo } = useQuery<SiteInfo>({
    queryKey: ["/api/site/info"],
  });
  const { data: sites } = useQuery<SiteConfig[]>({
    queryKey: ["/api/sites"],
  });

  const knownSiteFolders = sites?.map((s) => s.contentFolder) ?? [];

  return useCallback(
    (filePath: string) =>
      formatSitePath(filePath, {
        contentFolder: siteInfo?.contentFolder,
        knownSiteFolders,
      }),
    [siteInfo?.contentFolder, knownSiteFolders],
  );
}
