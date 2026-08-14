/** Public content pages and `/private/preview/*` can use Edit/Read + device chrome. Admin `/private/*` cannot. */
export function isVisualEditPath(pathname: string): boolean {
  const isPrivate =
    pathname === "/private" || pathname.startsWith("/private/");
  if (!isPrivate) return true;
  return pathname === "/private/preview" || pathname.startsWith("/private/preview/");
}
