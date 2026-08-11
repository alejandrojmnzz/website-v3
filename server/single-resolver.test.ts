import { describe, expect, it } from "vitest";
import { resolveSingleVars } from "./single-resolver";

describe("resolveSingleVars exact structured pipe fallbacks", () => {
  it("returns bag arrays/objects as-is", () => {
    const data = { items: "{{ single.faq_entries }}" };
    const out = resolveSingleVars(data, {
      faq_entries: [{ question: "Q?", answer: "A." }],
    }) as { items: unknown };
    expect(out.items).toEqual([{ question: "Q?", answer: "A." }]);
  });

  it("parses JSON literal pipe fallbacks on exact miss", () => {
    const data = {
      items: "{{ single.faq_entries | [] }}",
      config: '{{ single.widget | {"enabled": false} }}',
      image: "{{ single.image | /fallback.webp }}",
    };
    const out = resolveSingleVars(data, {}) as Record<string, unknown>;
    expect(out.items).toEqual([]);
    expect(out.config).toEqual({ enabled: false });
    expect(out.image).toBe("/fallback.webp");
  });

  it("returns null on exact miss with no pipe", () => {
    const out = resolveSingleVars(
      { items: "{{ single.missing }}" },
      {},
    ) as { items: unknown };
    expect(out.items).toBeNull();
  });

  it("keeps inline interpolation string-only", () => {
    const out = resolveSingleVars(
      { title: "About {{ single.name }}" },
      { name: "Blog" },
    ) as { title: string };
    expect(out.title).toBe("About Blog");
  });
});
