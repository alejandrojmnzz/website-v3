import fs from "fs";
import path from "path";

export interface SiteScaffoldOptions {
  /** Folder under project root, e.g. site_4geeks-florida */
  contentFolder: string;
  /** Used in page copy and menus */
  displayName: string;
  includeSampleContent?: boolean;
}

function writeIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
  }
}

function mkdirIfMissing(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Create the minimum site folder structure required by check-sites / dev startup.
 * Skips files and directories that already exist.
 */
export function ensureSiteScaffold(options: SiteScaffoldOptions): void {
  const { contentFolder, displayName, includeSampleContent = true } = options;
  const folderPath = path.join(process.cwd(), contentFolder);

  mkdirIfMissing(folderPath);
  mkdirIfMissing(path.join(folderPath, "images"));
  mkdirIfMissing(path.join(folderPath, "menus"));
  mkdirIfMissing(path.join(folderPath, "pages"));

  writeIfMissing(path.join(folderPath, "images", ".gitkeep"), "");

  writeIfMissing(
    path.join(folderPath, "settings.yml"),
    `# Site settings for ${contentFolder}\ni18n:\n  defaultLocale: en\n  locales:\n    - en\n`,
  );

  writeIfMissing(
    path.join(folderPath, "content-types.yml"),
    `# Content types for ${contentFolder}\npage:\n  directory: pages\n  url_pattern:\n    en: /en/:slug\n  layout:\n    menu:\n      top: main-navbar\n      bottom: main-footer\n`,
  );

  writeIfMissing(
    path.join(folderPath, "image-registry.json"),
    JSON.stringify({ images: [], presets: [] }, null, 2),
  );

  writeIfMissing(path.join(folderPath, "custom-redirects.yml"), "redirects: []\n");

  writeIfMissing(
    path.join(folderPath, "menus", "main-navbar.yml"),
    `navbar:\n  items:\n    - label: Logo\n      href: /en\n      component: Logo\n    - label: Home\n      href: /en\n    - label: About\n      href: /en/about\n    - label: Language\n      component: LanguageSwitcher\n`,
  );

  writeIfMissing(
    path.join(folderPath, "menus", "main-footer.yml"),
    `footer:\n  columns: []\n  socials: []\n  copyright_text: "${displayName}. All rights reserved."\n`,
  );

  writeIfMissing(
    path.join(folderPath, "pages", "home.en.yml"),
    `meta:\n  title: "Welcome to ${displayName}"\n  description: "Home page for ${displayName}"\nsections:\n  - type: hero_single_column\n    title: "Welcome to ${displayName}"\n    subtitle: "Your new site is ready. Start editing this page to get started."\n    button_label: Get Started\n    button_url: /en/about\n`,
  );

  if (includeSampleContent) {
    writeIfMissing(
      path.join(folderPath, "pages", "about.en.yml"),
      `meta:\n  title: "About - ${displayName}"\n  description: "Learn more about ${displayName}"\nsections:\n  - type: two_column_text\n    title: "About Us"\n    left_body: |\n      We are a team passionate about building great products.\n      This is the about page for ${displayName}.\n    right_body: |\n      Feel free to edit this page with your own content.\n      Replace images, update the text, and make it yours.\n`,
    );

    mkdirIfMissing(path.join(folderPath, "blog"));

    writeIfMissing(
      path.join(folderPath, "blog", "_common.single.yml"),
      `sections:\n  - type: hero_single_column\n    title: "{{ single.title }}"\n    subtitle: "{{ single.excerpt }}"\n  - type: markdown_body\n    body: "{{ single.body }}"\n`,
    );

    writeIfMissing(
      path.join(folderPath, "blog", "sample-post.en.yml"),
      `title: "Sample Blog Post"\nexcerpt: "This is a sample blog post to get you started."\nbody: |\n  ## Hello World\n\n  This is a sample blog post for **${displayName}**. You can edit or delete this file\n  and create your own posts in this folder.\n`,
    );
  }
}
