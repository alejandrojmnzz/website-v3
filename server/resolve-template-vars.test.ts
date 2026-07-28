import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveAllTemplateVars, resolveBagVars, buildParamBag } from "./resolve-template-vars";
import { resetVariableManagerCache, getVariableManager } from "./variable-manager";

describe("resolveBagVars", () => {
  it("resolves exact {{ meta.page_title }} to the bag value", () => {
    const result = resolveBagVars(
      { title: "{{ meta.page_title }}" },
      "meta",
      { page_title: "Hello SEO" },
    );
    expect(result).toEqual({ title: "Hello SEO" });
  });

  it("resolves inline meta tokens in strings", () => {
    const result = resolveBagVars(
      "Read {{ meta.description }}",
      "meta",
      { description: "About us" },
    );
    expect(result).toBe("Read About us");
  });
});

describe("buildParamBag", () => {
  it("merges query then path, with path winning on conflict", () => {
    const bag = buildParamBag(
      { slug: "from-path", category: "eng" },
      { utm: "x", slug: "from-query", category: "query-cat" },
    );
    expect(bag).toEqual({
      utm: "x",
      slug: "from-path",
      category: "eng",
    });
  });

  it("flattens array query values to the first entry", () => {
    expect(buildParamBag(null, { tag: ["a", "b"] })).toEqual({ tag: "a" });
  });
});

describe("resolveAllTemplateVars", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brand-vars-"));
    fs.writeFileSync(
      path.join(tmpRoot, "variables.yml"),
      [
        "brand.title:",
        '  default: "Acme Corp"',
        "brand.logo:",
        '  default: "logo-light-id"',
        "brand.logo_dark:",
        '  default: "logo-dark-id"',
        "global.greeting:",
        '  default: "Hi"',
      ].join("\n"),
      "utf-8",
    );
    resetVariableManagerCache();
  });

  afterEach(() => {
    resetVariableManagerCache();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resolves single → meta → param → brand in order", () => {
    const data = {
      meta: {
        page_title: "{{ single.title }}",
        description: "Static desc",
      },
      sections: [
        {
          type: "hero",
          data: {
            headline: "{{ meta.page_title }}",
            cat: "{{ param.category }}",
            brand: "{{ brand.title }}",
            hello: "{{ global.greeting }}",
          },
        },
      ],
    };

    const result = resolveAllTemplateVars(data, {
      singleEntry: { title: "Entry Title" },
      param: { category: "engineering" },
      contentRoot: tmpRoot,
      context: { locale: "en" },
    }) as {
      meta: { page_title: string };
      sections: Array<{ data: { headline: string; cat: string; brand: string; hello: string } }>;
    };

    expect(result.meta.page_title).toBe("Entry Title");
    expect(result.sections[0].data.headline).toBe("Entry Title");
    expect(result.sections[0].data.cat).toBe("engineering");
    expect(result.sections[0].data.brand).toBe("Acme Corp");
    expect(result.sections[0].data.hello).toBe("Hi");
  });

  it("exposes slug/locale/image under plain and underscore keys", () => {
    const result = resolveAllTemplateVars(
      {
        a: "{{ single.slug }}",
        b: "{{ single._slug }}",
        c: "{{ single.locale }}",
        d: "{{ single._locale }}",
        e: "{{ single.image }}",
        f: "{{ single._image }}",
      },
      {
        singleEntry: { slug: "hello", locale: "en", image: "https://x/y.png" },
        skipSiteVars: true,
      },
    ) as Record<string, string>;

    expect(result).toEqual({
      a: "hello",
      b: "hello",
      c: "en",
      d: "en",
      e: "https://x/y.png",
      f: "https://x/y.png",
    });
  });

  it("does not expose _hreflangs on the single bag", () => {
    const result = resolveAllTemplateVars(
      { x: "{{ single._hreflangs }}" },
      {
        singleEntry: { slug: "a", _hreflangs: { en: "a", es: "b" } },
        skipSiteVars: true,
      },
    ) as { x: string };
    expect(result.x).toBe("{{ single._hreflangs }}");
  });

  it("resolves brand vars in menu-shaped data without single/meta", () => {
    const menu = {
      navbar: {
        items: [
          {
            component: "Logo",
            imageId: "{{ brand.logo }}",
            imageIdDark: "{{ brand.logo_dark }}",
          },
        ],
      },
    };

    const result = resolveAllTemplateVars(menu, {
      contentRoot: tmpRoot,
      context: { locale: "en" },
    }) as { navbar: { items: Array<{ imageId: string; imageIdDark: string }> } };

    expect(result.navbar.items[0].imageId).toBe("logo-light-id");
    expect(result.navbar.items[0].imageIdDark).toBe("logo-dark-id");
  });

  it("seeds brand.* on VariableManager load when missing", () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brand-seed-"));
    fs.writeFileSync(path.join(emptyRoot, "variables.yml"), "global.x:\n  default: \"1\"\n", "utf-8");
    resetVariableManagerCache();
    const vm = getVariableManager(emptyRoot);
    const brand = vm.getBrandSettings();
    expect(brand.title).toBeTruthy();
    expect(brand.logo).toBeTruthy();
    expect(vm.getDefinition("brand.title")?.isReserved).toBe(true);
    fs.rmSync(emptyRoot, { recursive: true, force: true });
    resetVariableManagerCache();
  });
});
