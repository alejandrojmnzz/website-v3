import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertReattachRequiredFields,
  ReattachRequiredFieldsError,
} from "./shared-layout-detach";

const cleanups: Array<() => void> = [];

function tempSite(): { root: string; entryDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reattach-req-"));
  const blog = path.join(root, "blog", "demo-post");
  fs.mkdirSync(blog, { recursive: true });
  fs.writeFileSync(
    path.join(root, "content-types.yml"),
    [
      "blog:",
      "  directory: blog",
      "  single_template: true",
      "  url_pattern:",
      "    en: /en/blog/:slug",
      "  editor:",
      "    title:",
      "      required: true",
      "    call_to_action:",
      "      type: json",
      "      required: attached",
      "      schema:",
      "        type: object",
      "        required: [title, subtitle, conversion_name]",
      "        properties:",
      "          title: { type: string }",
      "          subtitle: { type: string }",
      "          conversion_name: { type: string }",
      "",
    ].join("\n"),
    "utf-8",
  );
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, entryDir: blog };
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("assertReattachRequiredFields", () => {
  it("fails when a live locale lacks attached-required fields", () => {
    const { root, entryDir } = tempSite();
    fs.writeFileSync(
      path.join(entryDir, "_common.yml"),
      "detached: true\ntitle: Demo\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(entryDir, "en.yml"), "title: Demo EN\n", "utf-8");
    fs.writeFileSync(
      path.join(entryDir, "draft.es.yml"),
      "title: Draft only — should be ignored\n",
      "utf-8",
    );

    expect(() =>
      assertReattachRequiredFields({
        contentType: "blog",
        slug: "demo-post",
        contentRoot: root,
        entryDir,
      }),
    ).toThrow(ReattachRequiredFieldsError);

    try {
      assertReattachRequiredFields({
        contentType: "blog",
        slug: "demo-post",
        contentRoot: root,
        entryDir,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ReattachRequiredFieldsError);
      const err = e as ReattachRequiredFieldsError;
      expect(err.missing_fields.some((f) => f.startsWith("en."))).toBe(true);
      expect(err.missing_fields.some((f) => f.startsWith("draft"))).toBe(false);
      expect(err.message).toContain("demo-post");
      expect(err.message).toContain("call_to_action");
    }
  });

  it("passes when live locale has schema-valid call_to_action", () => {
    const { root, entryDir } = tempSite();
    fs.writeFileSync(path.join(entryDir, "_common.yml"), "detached: true\n", "utf-8");
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      [
        "title: Demo EN",
        "call_to_action:",
        "  title: Start",
        "  subtitle: Join us",
        "  conversion_name: student_application",
        "",
      ].join("\n"),
      "utf-8",
    );

    expect(() =>
      assertReattachRequiredFields({
        contentType: "blog",
        slug: "demo-post",
        contentRoot: root,
        entryDir,
      }),
    ).not.toThrow();
  });
});
