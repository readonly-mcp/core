/*
 * Stages the publishable package in dist/source beside the compiled code: the
 * manifest without its development-only fields, plus the README and LICENSE
 * npm expects at a package root. Scripts are dropped so that publishing the
 * directory cannot run a lifecycle hook written for the source checkout.
 *
 * The source manifest's bin points into dist/source, where the compiled entry
 * lives; publishConfig.bin holds the path relative to the package root. pnpm
 * applies that override on publish and npm does not, so it is applied here.
 */
import { copyFileSync, writeFileSync } from 'node:fs';
import packageJson from '../package.json' with { type: 'json' };

const OUT_DIR = 'dist/source';

const {
  devDependencies, packageManager, scripts,
  publishConfig: { bin, ...publishConfig },
  ...manifest
} = packageJson;

writeFileSync(
  `${OUT_DIR}/package.json`,
  `${JSON.stringify({ ...manifest, bin, publishConfig }, null, 2)}\n`,
);
['README.md', 'LICENSE'].forEach(file => copyFileSync(file, `${OUT_DIR}/${file}`));
