export function applyEntryModulePreload(html: string): string {
  return html.replace(
    /(<script type="module" crossorigin src="(\/assets\/index-[^"]+\.js)"><\/script>)/g,
    (match, _full, src) =>
      `<link rel="modulepreload" crossorigin href="${src}" fetchpriority="low">${match}`
  );
}
