import { describe, expect, it } from "vitest";
import {
  buildContentTypeRoutes,
  inferPublicPageChunk,
  matchContentTypeRoute,
  type ContentTypeRouteInput,
} from "./content-type-routes";

const FAKE_TYPES: ContentTypeRouteInput[] = [
  {
    name: "program",
    has_database: false,
    single_template: false,
    url_pattern: {
      en: "/en/career-programs/:slug",
      es: "/es/programas-de-carrera/:slug",
    },
  },
  {
    name: "location",
    has_database: false,
    single_template: false,
    url_pattern: {
      en: "/en/location/:slug",
      es: "/es/ubicacion/:slug",
    },
  },
  {
    name: "page",
    has_database: false,
    single_template: false,
    url_pattern: {
      en: "/en/:slug",
      es: "/es/:slug",
    },
  },
  {
    name: "blog",
    has_database: false,
    single_template: true,
    url_pattern: {
      en: "/en/blog/:category/:slug",
      es: "/es/blog/:category/:slug",
    },
  },
  {
    name: "how-to",
    has_database: true,
    single_template: true,
    url_pattern: {
      en: "/en/how-to/:slug",
      es: "/es/how-to/:slug",
    },
  },
];

function paths(types = FAKE_TYPES) {
  return buildContentTypeRoutes(types).map((r) => r.path);
}

describe("buildContentTypeRoutes", () => {
  it("emits program and location patterns so JSX duplicates are not needed", () => {
    const routes = buildContentTypeRoutes(FAKE_TYPES);
    expect(routes.some((r) => r.path === "/en/career-programs/:slug" && r.type === "program")).toBe(
      true,
    );
    expect(
      routes.some((r) => r.path === "/es/programas-de-carrera/:slug" && r.type === "program"),
    ).toBe(true);
    expect(routes.some((r) => r.path === "/en/location/:slug" && r.type === "location")).toBe(true);
    expect(routes.some((r) => r.path === "/es/ubicacion/:slug" && r.type === "location")).toBe(true);
    expect(
      routes.find((r) => r.path === "/en/career-programs/:slug")?.kind,
    ).toBe("content-type-detail");
  });

  it("sorts page /en/:slug after career-programs and blog multi-param routes", () => {
    const routes = buildContentTypeRoutes(FAKE_TYPES);
    const list = routes.map((r) => r.path);
    const pageEn = list.indexOf("/en/:slug");
    const programsEn = list.indexOf("/en/career-programs/:slug");
    const blogEn = list.indexOf("/en/blog/:category/:slug");
    expect(pageEn).toBeGreaterThan(programsEn);
    expect(pageEn).toBeGreaterThan(blogEn);
    const firstPage = routes.findIndex((r) => r.type === "page");
    expect(firstPage).toBeGreaterThan(programsEn);
    expect(routes.slice(firstPage).every((r) => r.type === "page")).toBe(true);
  });

  it("emits regional /:locale/career-programs/:slug and /:locale/:slug", () => {
    const list = paths();
    expect(list).toContain("/:locale/career-programs/:slug");
    expect(list).toContain("/:locale/:slug");
    const regionalPage = buildContentTypeRoutes(FAKE_TYPES).find(
      (r) => r.path === "/:locale/:slug",
    );
    expect(regionalPage).toMatchObject({ type: "page", regional: true, kind: "template" });
    const regionalProgram = buildContentTypeRoutes(FAKE_TYPES).find(
      (r) => r.path === "/:locale/career-programs/:slug",
    );
    expect(regionalProgram).toMatchObject({
      type: "program",
      regional: true,
      kind: "content-type-detail",
    });
  });

  it("does not emit a blog listing prefix", () => {
    const routes = buildContentTypeRoutes(FAKE_TYPES);
    expect(routes.some((r) => r.path === "/en/blog" || r.path === "/es/blog")).toBe(false);
    expect(routes.some((r) => r.type === "blog" && r.isListingPrefix)).toBe(false);
    expect(routes.find((r) => r.path === "/en/blog/:category/:slug")?.kind).toBe("database-single");
  });

  it("emits a how-to listing prefix because it has_database", () => {
    const routes = buildContentTypeRoutes(FAKE_TYPES);
    expect(routes.some((r) => r.path === "/en/how-to" && r.isListingPrefix && r.kind === "template")).toBe(
      true,
    );
    expect(routes.some((r) => r.path === "/:locale/how-to" && r.isListingPrefix && r.regional)).toBe(
      true,
    );
    expect(routes.find((r) => r.path === "/en/how-to/*")?.kind).toBe("database-single");
  });
});

describe("matchContentTypeRoute / inferPublicPageChunk", () => {
  const routes = buildContentTypeRoutes(FAKE_TYPES);

  it("matches blog singles before the page catch-all", () => {
    const match = matchContentTypeRoute(
      "/en/blog/herramientas-ia/mejores-agentes-de-codigo",
      routes,
    );
    expect(match).toMatchObject({ type: "blog", kind: "database-single" });
    expect(inferPublicPageChunk("/en/blog/foo/bar", FAKE_TYPES)).toBe("database-single");
  });

  it("matches regional program URLs and not plain /es/ on the en pattern", () => {
    expect(matchContentTypeRoute("/es-mx/career-programs/full-stack", routes)).toMatchObject({
      type: "program",
      regional: true,
    });
    expect(matchContentTypeRoute("/es/career-programs/full-stack", routes)).toBeNull();
    expect(inferPublicPageChunk("/en/career-programs/full-stack", FAKE_TYPES)).toBe(
      "content-type-detail",
    );
  });

  it("falls back to template when content types are missing", () => {
    expect(inferPublicPageChunk("/en/about")).toBe("template");
  });
});
