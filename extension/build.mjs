// Bundles the extension into extension/dist. Usage: npm run ext:build [-- --watch]
import * as esbuild from "esbuild";

const ctx = await esbuild.context({
  entryPoints: ["extension/src/background.ts", "extension/src/content.ts", "extension/src/inject.ts", "extension/src/popup.ts"],
  outdir: "extension/dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  logLevel: "info",
});

if (process.argv.includes("--watch")) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
