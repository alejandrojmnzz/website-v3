import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { setValueAtPath } from "./content-editor";

describe("setValueAtPath identity null persistence", () => {
  it("persists ecommerce_products: null in dumped YAML", () => {
    const obj: Record<string, unknown> = { type: "pricing_plans" };
    setValueAtPath(obj, "ecommerce_products", null);
    expect(obj).toHaveProperty("ecommerce_products", null);
    const dumped = yaml.dump(obj);
    expect(dumped).toMatch(/ecommerce_products:\s*null/);
  });

  it("persists conversion_name: null in dumped YAML", () => {
    const obj: Record<string, unknown> = { type: "lead_form" };
    setValueAtPath(obj, "conversion_name", null);
    expect(obj).toHaveProperty("conversion_name", null);
    expect(yaml.dump(obj)).toMatch(/conversion_name:\s*null/);
  });

  it("still deletes unrelated null keys", () => {
    const obj: Record<string, unknown> = { title: "x", unused: "y" };
    setValueAtPath(obj, "unused", null);
    expect(obj).not.toHaveProperty("unused");
  });
});
