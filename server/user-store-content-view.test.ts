import { describe, expect, it } from "vitest";
import {
  ensureContentViewOnEditorRoles,
  grantsCanMutateMetrics,
  type RoleDefinition,
} from "./user-store";

describe("ensureContentViewOnEditorRoles", () => {
  it("adds content_view with unioned types on custom editor roles", () => {
    const roles: Record<string, RoleDefinition> = {
      blog_editor: {
        label: "Blog editor",
        capabilities: [
          { name: "content_edit_text", contentTypes: ["blog"] },
          { name: "content_edit_structure", contentTypes: ["blog", "landing"] },
        ],
      },
    };
    expect(ensureContentViewOnEditorRoles(roles)).toBe(true);
    const view = roles.blog_editor.capabilities.find((g) => g.name === "content_view");
    expect(view?.contentTypes).toEqual(["blog", "landing"]);
    expect(ensureContentViewOnEditorRoles(roles)).toBe(false);
  });

  it("uses * when any mutate grant is unscoped or *", () => {
    const roles: Record<string, RoleDefinition> = {
      editors: {
        label: "Editors",
        capabilities: [
          { name: "content_edit_text", contentTypes: "*" },
          { name: "content_edit_media", contentTypes: ["blog"] },
        ],
      },
    };
    ensureContentViewOnEditorRoles(roles);
    expect(roles.editors.capabilities[0]).toEqual({
      name: "content_view",
      contentTypes: "*",
    });
  });

  it("skips built-in roles and roles that already have content_view", () => {
    const roles: Record<string, RoleDefinition> = {
      webmaster: {
        label: "Webmaster",
        capabilities: [{ name: "content_edit_text", contentTypes: "*" }],
      },
      already: {
        label: "Already",
        capabilities: [
          { name: "content_view", contentTypes: ["page"] },
          { name: "content_edit_text", contentTypes: ["blog"] },
        ],
      },
      seo: {
        label: "SEO",
        capabilities: [{ name: "seo_edit" }],
      },
    };
    expect(ensureContentViewOnEditorRoles(roles)).toBe(false);
    expect(roles.webmaster.capabilities.some((g) => g.name === "content_view")).toBe(false);
    expect(roles.already.capabilities.filter((g) => g.name === "content_view")).toHaveLength(1);
    expect(roles.seo.capabilities.some((g) => g.name === "content_view")).toBe(false);
  });
});

describe("grantsCanMutateMetrics", () => {
  it("excludes view-only caps", () => {
    expect(grantsCanMutateMetrics([{ name: "metrics_view" }])).toBe(false);
    expect(grantsCanMutateMetrics([{ name: "content_view", contentTypes: "*" }])).toBe(false);
    expect(
      grantsCanMutateMetrics([
        { name: "metrics_view" },
        { name: "content_view", contentTypes: "*" },
      ]),
    ).toBe(false);
    expect(grantsCanMutateMetrics([{ name: "seo_edit" }])).toBe(true);
  });
});
