import type { Express, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { safeYamlLoad, safeYamlDump, requireCapability } from "./_helpers";
import { markFileAsModified } from "../sync-state";

const OVERLAYS_FILE = path.join(
  process.cwd(),
  "marketing-content",
  "overlays.yml"
);

function readOverlays(): unknown {
  if (!fs.existsSync(OVERLAYS_FILE)) {
    return { overlays: [] };
  }
  return safeYamlLoad(fs.readFileSync(OVERLAYS_FILE, "utf-8")) ?? {
    overlays: [],
  };
}

export function registerOverlaysRoutes(app: Express): void {
  app.get("/api/overlays", (_req: Request, res: Response) => {
    try {
      const data = readOverlays();
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
      const yaml = safeYamlDump(body);
      fs.writeFileSync(OVERLAYS_FILE, yaml, "utf-8");
      markFileAsModified("marketing-content/overlays.yml");
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to save overlays" });
    }
  });
}
