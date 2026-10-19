// Builds the extension and zips what Chrome needs into extension/dist/release/ (ignored by git),
// ready to attach to a GitHub release. Usage: npm run ext:zip
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";

execFileSync("node", ["extension/build.mjs"], { stdio: "inherit" });
const { version } = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
const out = `dist/release/ea-drawing-extension-v${version}.zip`;
mkdirSync("extension/dist/release", { recursive: true });
rmSync(`extension/${out}`, { force: true });
const files = ["manifest.json", "popup.html", "icon.svg", "icon16.png", "icon32.png", "icon48.png", "icon128.png", "dist/background.js", "dist/content.js", "dist/inject.js", "dist/popup.js"];
execFileSync("zip", ["-q", "-X", out, ...files], { cwd: "extension", stdio: "inherit" });
console.log(`extension/${out}`);
