// Build the visual-review gallery for a Playwright run (issue #31,
// step 3): rendered sealed-PDF pages for every document the specs
// recorded in gallery-manifest.jsonl, plus the numbered screenshots
// the specs saved, in one gallery/index.html with "what to check"
// captions. No pixel-diff goldens — capture-and-present first.
//
// Sealed pages come from the test-stack-only endpoint in
// backend/apps/signing/e2e_views.py (404 outside the test stack, in
// which case the gallery still builds from screenshots alone).
// Run: `npm run gallery` after `npm test` (CI does this on every run).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
const OUT = path.join(ROOT, "gallery");
const SHOT_CAPTIONS = {
  "01-send-link-qr.png": "Sending link + QR: QR renders, link copies, no layout breakage",
  "02-signer-intro.png": "Signer intro: title shown, View document link present",
  "03-signature-drawn.png": "Drawn signature: ink follows the stroke, pad usable",
  "04-photo-step.png": "Photo step: consent gate, preview shown before submit",
  "05-done.png": "Done screen: Signed. Seen. Sealed. + audit seal visible",
  "06-camera-live.png": "Live camera: fake-device stream flowing (videoWidth > 0)",
  "07-camera-captured.png": "Captured frame: preview shown, seal offered with photo",
  "08-stale-token-link.png": "Stale sender token: signing link still loads",
  "09-dashboard-send.png": "Dashboard send: confirmation after a logged-in send",
  "10-premium-branding.png": "Premium dashboard: branding saved, branded send",
};

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function fetchSealedPages(docId) {
  // Probe pages until the first 404 (cap: sealed docs are short).
  const pages = [];
  for (let n = 1; n <= 20; n++) {
    const res = await fetch(`${API_URL}/api/e2e/sealed/${docId}/page/${n}.png`);
    if (!res.ok) break;
    pages.push(Buffer.from(await res.arrayBuffer()));
  }
  return pages;
}

const manifestPath = path.join(ROOT, "gallery-manifest.jsonl");
const entries = fs.existsSync(manifestPath)
  ? fs
      .readFileSync(manifestPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "sealed"), { recursive: true });
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

let sections = "";
let sealedCount = 0;
for (const [i, entry] of entries.entries()) {
  const slug = entry.label.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  let pages = [];
  try {
    pages = await fetchSealedPages(entry.docId);
  } catch {
    pages = [];
  }
  // First page (signature placement, watermark) + last page
  // (certificate, photo block, branding) are the ones worth eyes.
  const keep = pages.length > 1 ? [0, pages.length - 1] : pages.map((_, k) => k);
  const imgs = [];
  for (const k of keep) {
    const name = `${slug}-p${k + 1}.png`;
    fs.writeFileSync(path.join(OUT, "sealed", name), pages[k]);
    imgs.push(
      `<figure><img src="sealed/${name}"><figcaption>Sealed PDF, page ${k + 1} of ${pages.length}</figcaption></figure>`,
    );
  }
  if (imgs.length) sealedCount++;
  sections += `<section><h2>${esc(entry.label)}</h2><p>Check: ${entry.checks.map(esc).join("; ")}</p>${imgs.join("") || "<p><em>Sealed pages unavailable — this run was not against the test stack.</em></p>"}</section>\n`;
}

const shotsDir = path.join(ROOT, "screenshots");
const shots = fs.existsSync(shotsDir)
  ? fs.readdirSync(shotsDir).filter((f) => f.endsWith(".png")).sort()
  : [];
for (const f of shots) {
  fs.copyFileSync(path.join(shotsDir, f), path.join(OUT, "shots", f));
}
const shotFigures = shots
  .map(
    (f) =>
      `<figure><img src="shots/${f}"><figcaption>${esc(SHOT_CAPTIONS[f] ?? f)}</figcaption></figure>`,
  )
  .join("\n");

const html = `<!doctype html><meta charset="utf-8"><title>SignSeen review gallery</title>
<style>body{font-family:system-ui;max-width:72rem;margin:2rem auto;padding:0 1rem}img{max-width:100%;border:1px solid #ddd}figure{margin:1rem 0}figcaption{color:#555;font-size:.9rem}</style>
<h1>SignSeen review gallery</h1>
<p>Sealed documents: ${sealedCount} rendered; screenshots: ${shots.length}. Pixel-diff goldens are a later step — this gallery is capture-and-present.</p>
${sections}
<h2>Screenshots</h2>
${shotFigures || "<p><em>No screenshots captured.</em></p>"}
`;
fs.writeFileSync(path.join(OUT, "index.html"), html);
console.log(
  `gallery: ${sealedCount} sealed document(s), ${shots.length} screenshot(s) -> e2e/gallery/index.html`,
);
