// Copies the deployable site into dist/. No dependencies, nothing to compile:
// the site is plain HTML/CSS/JS plus the PHP form endpoint.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const out = "dist";
const entries = ["index.html", "robots.txt", ".htaccess", "assets", "api"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const entry of entries) {
  if (existsSync(entry)) cpSync(entry, `${out}/${entry}`, { recursive: true });
}
// Real credentials never ship from the repo.
rmSync(`${out}/api/config.php`, { force: true });
console.log(`Built ${out}/ (${entries.join(", ")})`);
