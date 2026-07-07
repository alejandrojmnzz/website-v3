import { describe, expect, it } from "vitest";
import {
  formStateReadKeys,
  legacyPerSiteSyncGcsKey,
  platformSitesYmlGcsKey,
  platformSitesYmlReadKeys,
  platformUserStoreGcsKey,
  siteConversationsGcsKey,
  siteLighthouseGcsPrefix,
  siteMediaGcsPrefix,
  siteSyncGcsKey,
  syncStateReadKeys,
  userStoreReadKeys,
} from "./gcsKeys";

describe("gcsKeys", () => {
  it("builds site-first sync keys", () => {
    expect(siteSyncGcsKey("site_4geeks-florida", "sync-state.json")).toBe(
      "site_4geeks-florida/sync/sync-state.json",
    );
  });

  it("builds legacy per-site sync keys", () => {
    expect(legacyPerSiteSyncGcsKey("site_4geeks-florida", "sync-state.json")).toBe(
      "sync/site_4geeks-florida/sync-state.json",
    );
  });

  it("builds platform user store key", () => {
    expect(platformUserStoreGcsKey()).toBe("multisite-global/users-state.json");
  });

  it("builds platform sites.yml key", () => {
    expect(platformSitesYmlGcsKey()).toBe("multisite-global/sites.yml");
  });

  it("reads user store new-first with legacy fallbacks", () => {
    const keys = userStoreReadKeys();
    expect(keys[0]).toBe("multisite-global/users-state.json");
    expect(keys).toContain("multisite-user-store/users-state.json");
    expect(keys).toContain("sync/users-state.json");
  });

  it("reads sites.yml new-first with legacy fallback", () => {
    const keys = platformSitesYmlReadKeys();
    expect(keys[0]).toBe("multisite-global/sites.yml");
    expect(keys).toContain("multisite-platform/sites.yml");
  });

  it("builds site media prefix", () => {
    expect(siteMediaGcsPrefix("site_4geeks-com")).toBe("site_4geeks-com/media/");
  });

  it("builds conversation key", () => {
    expect(siteConversationsGcsKey("site_4geeks-com", "abc-123")).toBe(
      "site_4geeks-com/conversations/abc-123/context.json",
    );
  });

  it("builds lighthouse prefix", () => {
    expect(siteLighthouseGcsPrefix("site_4geeks-com", "2026-07-03")).toBe(
      "site_4geeks-com/reports/lighthouse/2026-07-03",
    );
  });

  it("orders sync state read keys new-first", () => {
    const keys = syncStateReadKeys("site_4geeks-florida");
    expect(keys[0]).toBe("site_4geeks-florida/sync/sync-state.json");
    expect(keys).toContain("sync/site_4geeks-florida/sync-state.json");
  });

  it("includes legacy global form state for default site only", () => {
    const defaultKeys = formStateReadKeys("site_4geeks-com", true);
    expect(defaultKeys).toContain("sync/form-state.json");
    const otherKeys = formStateReadKeys("site_4geeks-florida", false);
    expect(otherKeys).not.toContain("sync/form-state.json");
  });
});
