/*
 * Stages the publishable package in dist/source beside the compiled code: the
 * manifest without its development-only fields, plus the README and LICENSE
 * npm expects at a package root. Scripts are dropped so that publishing the
 * directory cannot run a lifecycle hook written for the source checkout.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const OUT_DIR = "dist/source";

const { devDependencies, packageManager, scripts, ...manifest } = JSON.parse(
  readFileSync("package.json", "utf8"),
);

writeFileSync(`${OUT_DIR}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`);
["README.md", "LICENSE"].forEach((file) => copyFileSync(file, `${OUT_DIR}/${file}`));
