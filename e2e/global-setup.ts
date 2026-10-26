import fs from "node:fs";
import path from "node:path";

// A stale manifest from an earlier run would attach old sealed
// documents to this run's gallery, so each suite run starts clean.
// (Screenshots accumulate across local runs by design; CI starts clean.)
export default function globalSetup() {
  const manifest = path.join(__dirname, "gallery-manifest.jsonl");
  if (fs.existsSync(manifest)) fs.unlinkSync(manifest);
}
