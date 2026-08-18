import { describe, expect, it } from "vitest";
import {
  collectMissingConfirms,
  failBeforeFromOnPageYaml,
  stackedConfirmPayload,
  validateRedirectUpdateInput,
} from "./redirect-update";

describe("validateRedirectUpdateInput", () => {
  it("refuses variant", () => {
    const result = validateRedirectUpdateInput({
      action: "add",
      from: "/old",
      to: "/en/new",
      variant: "draft",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.code).toBe("variant_not_allowed");
  });

  it("fails before_from / move on a page YAML source", () => {
    const move = validateRedirectUpdateInput({
      action: "move",
      from: "/us",
      before_from: "/other",
      source: "site_4geeks-com/pages/home/en.yml",
    });
    expect(move.ok).toBe(false);
    if (!move.ok) expect(move.details.code).toBe("move_page_yaml");

    const before = failBeforeFromOnPageYaml("/us", false);
    expect(before?.details.code).toBe("before_from_page_yaml");
    expect(failBeforeFromOnPageYaml("/us", true)).toBeNull();
  });

  it("requires from+to for add and from+source for delete", () => {
    const add = validateRedirectUpdateInput({ action: "add", from: "/a" });
    expect(add.ok).toBe(false);
    if (!add.ok) expect(add.details.missing).toEqual(["to"]);

    const del = validateRedirectUpdateInput({ action: "delete", from: "/a" });
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.details.missing).toEqual(["source"]);
  });

  it("rejects extras that do not belong to the action", () => {
    const del = validateRedirectUpdateInput({
      action: "delete",
      from: "/a",
      source: "site_x/custom-redirects.yml",
      to: "/en/b",
    });
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.details.extras_rejected).toContain("to");
  });
});

describe("stacked confirms", () => {
  it("lists both flags when both apply", () => {
    const missing = collectMissingConfirms({
      needsOverwrite: true,
      needsLiveEdit: true,
    });
    expect(missing).toEqual(["confirm_overwrite_content", "confirm_live_edit"]);
            const payload = stackedConfirmPayload(missing);
    expect(payload.action_required).toBe("confirm_flags");
    expect(payload.missing_confirms).toEqual(["confirm_overwrite_content", "confirm_live_edit"]);
    expect(payload.message).toContain("confirm_overwrite_content");
    expect(payload.message).toContain("confirm_live_edit");
  });

  it("does not treat overwrite confirm as live confirm", () => {
    const missing = collectMissingConfirms({
      needsOverwrite: true,
      needsLiveEdit: true,
      confirm_overwrite_content: true,
    });
    expect(missing).toEqual(["confirm_live_edit"]);
  });
});
