export function applyEntryModulePreload(html: string): string {
  html = html.replace(
    /(<script type="module" crossorigin src="(\/assets\/index-[^"]+\.js)"><\/script>)/g,
    (match, _full, src) =>
      `<link rel="modulepreload" crossorigin href="${src}" fetchpriority="low">${match}`
  );

  // Demote Vite's build-time modulepreload tags (static deps of the entry) so
  // they stop competing with the render-blocking CSS for early bandwidth. The
  // LCP on most pages is server-rendered text/images painted by that CSS; JS
  // is only needed for hydration and can arrive slightly later.
  html = html.replace(
    /<link rel="modulepreload"(?![^>]*fetchpriority)([^>]*)>/g,
    '<link rel="modulepreload"$1 fetchpriority="low">'
  );

  return html;
}
