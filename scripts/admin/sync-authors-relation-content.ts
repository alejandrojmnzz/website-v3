import "dotenv/config";
import fs from "fs";
import path from "path";
import { markFileAsModified } from "../../server/sync-state";
import { getConflictInfo, commitAndPush } from "../../server/github";

async function main() {
  const root = "site_4geeks-com";
  const contentRoot = path.join(process.cwd(), root);

  function walk(dir: string, out: string[] = []) {
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, out);
      else if (/\.(yml|yaml|json)$/.test(ent.name)) out.push(p);
    }
    return out;
  }

  const explicit = [
    path.join(contentRoot, "content-types.yml"),
    path.join(contentRoot, "blog/single.en.yml"),
    path.join(contentRoot, "blog/single.es.yml"),
    path.join(contentRoot, "pages/blog/en.yml"),
    path.join(contentRoot, "pages/blog/es.yml"),
  ];
  const blogCommons = walk(path.join(contentRoot, "blog")).filter((p) =>
    p.endsWith(`${path.sep}_common.yml`),
  );
  const authors = walk(path.join(contentRoot, "authors"));
  const lessonDb = walk(path.join(contentRoot, "db")).filter((p) => p.includes("lesson"));

  const all = [...new Set([...explicit, ...blogCommons, ...authors, ...lessonDb])];
  for (const abs of all) {
    markFileAsModified(abs, "composer-agent", undefined, contentRoot);
  }
  console.log("marked", all.length, "files");

  try {
    const conflicts = await getConflictInfo({
      repoUrl: "https://github.com/breatheco-de/website-4geeks-com",
      contentRoot,
    });
    console.log("conflict", {
      hasConflicts: conflicts.hasConflicts,
      changedSample: conflicts.changedFiles?.slice?.(0, 10),
      changedCount: conflicts.changedFiles?.length,
    });
  } catch (e) {
    console.log("getConflictInfo error", (e as Error).message);
  }

  const result = await commitAndPush(
    "[Author: composer-agent] Authors CT + blog.authors relation + default author seed",
    {
      contentRoot,
      repoUrl: "https://github.com/breatheco-de/website-4geeks-com",
    },
  );
  console.log("commitAndPush", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
