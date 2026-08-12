import { describe, expect, it } from "vitest";
import {
  conversionNameForValidation,
  validateFormSection,
} from "./validateFormSection";

describe("conversionNameForValidation", () => {
  it("returns plain conversion names", () => {
    expect(conversionNameForValidation("student_application")).toBe(
      "student_application",
    );
  });

  it("extracts plain pipe fallback from exact single binds", () => {
    expect(
      conversionNameForValidation(
        "{{ single.call_to_action.conversion_name | student_application }}",
      ),
    ).toBe("student_application");
  });

  it("skips template binds with empty fallback", () => {
    expect(
      conversionNameForValidation("{{ single.call_to_action.conversion_name | }}"),
    ).toBeNull();
    expect(
      conversionNameForValidation("{{ single.call_to_action.conversion_name }}"),
    ).toBeNull();
  });

  it("skips object/array JSON fallbacks", () => {
    expect(
      conversionNameForValidation(
        '{{ single.call_to_action.success | {"message": "ok"} }}',
      ),
    ).toBeNull();
  });
});

describe("validateFormSection with templated conversion_name", () => {
  const known = ["student_application", "newsletter_signup"];

  it("accepts templated conversion_name when pipe fallback is known", () => {
    expect(
      validateFormSection(
        {
          form: {
            variant: "stacked",
            conversion_name:
              "{{ single.call_to_action.conversion_name | student_application }}",
          },
        },
        known,
      ),
    ).toBeNull();
  });

  it("rejects templated conversion_name when pipe fallback is unknown", () => {
    const err = validateFormSection(
      {
        form: {
          variant: "stacked",
          conversion_name:
            "{{ single.call_to_action.conversion_name | not_a_real_event }}",
        },
      },
      known,
    );
    expect(err).toContain("not_a_real_event");
  });

  it("skips membership check when template has no plain fallback", () => {
    expect(
      validateFormSection(
        {
          form: {
            variant: "stacked",
            conversion_name: "{{ single.call_to_action.conversion_name }}",
          },
        },
        known,
      ),
    ).toBeNull();
  });
});
