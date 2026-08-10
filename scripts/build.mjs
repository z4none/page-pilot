import { mkdir, copyFile } from "node:fs/promises";
import esbuild from "esbuild";

const outdir = "dist";

await mkdir(outdir, { recursive: true });

const shared = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
};

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: ["src/background.js"],
    outfile: `${outdir}/background.js`,
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["src/source-extractor.js"],
    outfile: `${outdir}/source-extractor.js`,
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["src/deepseek-content.js"],
    outfile: `${outdir}/deepseek-content.js`,
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["src/sidepanel.js"],
    outfile: `${outdir}/sidepanel.js`,
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["src/options.js"],
    outfile: `${outdir}/options.js`,
  }),
]);

await Promise.all([
  copyFile("src/manifest.json", `${outdir}/manifest.json`),
  copyFile("src/rules.json", `${outdir}/rules.json`),
  copyFile("src/sidepanel.html", `${outdir}/sidepanel.html`),
  copyFile("src/options.html", `${outdir}/options.html`),
  copyFile("src/styles.css", `${outdir}/styles.css`),
]);
