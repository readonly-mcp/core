import { configure, defaultEntryPoints } from '@gtbuchanan/eslint-config';

export default configure({
  // The server entry point sits at the root, outside the default bin directories.
  entryPoints: [...defaultEntryPoints, 'index.ts'],
  tsconfigRootDir: import.meta.dirname,
});
