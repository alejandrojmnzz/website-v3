/**
 * Propagate Logo media structure fields from the English master menu item
 * into a locale translation item. Locale menus must not drop imageId —
 * the visitor SSR image subset and LogoItem fallbacks depend on these fields.
 */
export function applyLogoStructureFromMaster(
  master: Record<string, unknown>,
  target: Record<string, unknown>,
): void {
  if (master.imageId !== undefined) {
    target.imageId = master.imageId;
  }
  if (master.imageIdDark !== undefined) {
    target.imageIdDark = master.imageIdDark;
  }
  if (master.imageAlt !== undefined) {
    target.imageAlt = master.imageAlt;
  }
}
