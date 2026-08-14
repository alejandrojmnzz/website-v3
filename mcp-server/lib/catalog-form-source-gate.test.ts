import { describe, expect, it } from "vitest";
import {
  collectFormSourceHitsFromUpdates,
  getAtDottedPath,
} from "../../mcp-server/lib/catalog-form-source-gate";

describe("collectFormSourceHitsFromUpdates merge", () => {
  const currentDoc = {
    sections: [
      {
        type: "lead_form",
        fields: {
          program: {
            source: {
              content_type: "program",
              query: "purchasable=true",
              value_path: "bc_slug",
              label_path: "title",
            },
          },
        },
      },
    ],
  };

  it("merges nested source.query onto existing source", () => {
    const hits = collectFormSourceHitsFromUpdates(
      [
        {
          field_path: "sections.0.fields.program.source.query",
          value: "slug=ai-fluency",
        },
      ],
      currentDoc,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.property_path).toBe("sections.0.fields.program.source");
    expect(hits[0]!.source).toEqual({
      content_type: "program",
      query: "slug=ai-fluency",
      value_path: "bc_slug",
      label_path: "title",
    });
  });

  it("getAtDottedPath reads array indexes", () => {
    expect(getAtDottedPath(currentDoc, "sections.0.fields.program.source.value_path")).toBe(
      "bc_slug",
    );
  });
});
