import { describe, expect, it } from "vitest";
import { extractHrefPaths, findMissingMemberLinks } from "./cluster-hub-links";

describe("cluster-hub-links", () => {
  it("extractHrefPaths collects anchor hrefs", () => {
    const html = `<nav><a href="/us/blog/a">A</a></nav><a href="https://4geeks.com/us/blog/b">B</a>`;
    expect(extractHrefPaths(html)).toEqual(["/us/blog/a", "https://4geeks.com/us/blog/b"]);
  });

  it("findMissingMemberLinks flags members not linked from hub html", () => {
    const html = `<a href="/us/blog/linked">Linked</a>`;
    const missing = findMissingMemberLinks({
      html,
      members: [
        {
          memberId: "blog/linked/en",
          memberSlug: "linked",
          memberPath: "/us/blog/linked",
          locale: "en",
        },
        {
          memberId: "blog/missing/en",
          memberSlug: "missing",
          memberPath: "/us/blog/missing",
          locale: "en",
        },
      ],
      ci: {
        getRedirects: () => [],
        refreshCustomRedirects: () => [],
        isKnownUrl: () => true,
        findBySlug: () => [],
      } as unknown as import("./content-index").ContentIndex,
    });
    expect(missing).toHaveLength(1);
    expect(missing[0]?.memberSlug).toBe("missing");
  });
});
