import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FAQSection } from "@/components/faq/variants/FaqDefault";

vi.mock("@/contexts/SessionContext", () => ({
  useSession: () => ({ session: { location: null } }),
}));

vi.mock("@/hooks/useInternalNav", () => ({
  useInternalNav: () => () => {},
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/en/test", vi.fn()],
}));

const editModeMock = vi.hoisted(() => ({
  isEditMode: false,
}));

vi.mock("@/contexts/EditModeContext", () => ({
  useEditModeOptional: () => editModeMock,
}));

describe("FAQSection empty state", () => {
  it("renders nothing when empty and not in edit mode", () => {
    editModeMock.isEditMode = false;
    const html = renderToStaticMarkup(
      <FAQSection data={{ type: "faq", title: "FAQ", items: [] } as never} />,
    );
    expect(html).toBe("");
  });

  it("shows edit placeholder when empty in edit mode", () => {
    editModeMock.isEditMode = true;
    const html = renderToStaticMarkup(
      <FAQSection data={{ type: "faq", title: "FAQ", items: [] } as never} />,
    );
    expect(html).toContain("section-faq-empty-edit");
    expect(html).toContain("no results");
    expect(html).toContain("hidden on the live page");
  });
});
