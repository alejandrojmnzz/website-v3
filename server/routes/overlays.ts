import type { Express, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { safeYamlLoad, safeYamlDump, requireCapability } from "./_helpers";
import { markFileAsModified } from "../sync-state";

function getOverlaysFile(contentRoot: string): string {
  return path.join(contentRoot, "overlays.yml");
}

function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? path.join(process.cwd(), process.env.CONTENT_FOLDER || "content");
}

function readOverlays(contentRoot: string): unknown {
  const overlaysFile = getOverlaysFile(contentRoot);
  if (!fs.existsSync(overlaysFile)) {
    return { overlays: [] };
  }
  return safeYamlLoad(fs.readFileSync(overlaysFile, "utf-8")) ?? {
    overlays: [],
  };
}

export function registerOverlaysRoutes(app: Express): void {
  app.get("/api/overlays", (_req: Request, res: Response) => {
    try {
      const data = readOverlays(getContentRoot(res));
      res.json(data);
    } catch {
      res.status(500).json({ error: "Failed to read overlays" });
    }
  });

  app.put("/api/overlays", async (req: Request, res: Response) => {
    const { authorized } = await requireCapability(req, res, "content_editor");
    if (!authorized) return;

    try {
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Invalid body" });
        return;
      }
      const contentRoot = getContentRoot(res);
      const contentFolder = path.basename(contentRoot);
      const overlaysFile = getOverlaysFile(contentRoot);
      const yaml = safeYamlDump(body);
      fs.writeFileSync(overlaysFile, yaml, "utf-8");
      markFileAsModified(`${contentFolder}/overlays.yml`);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to save overlays" });
    }
  });
}
