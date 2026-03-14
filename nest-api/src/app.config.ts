// app.config.ts
import * as packageJson from '../package.json';

export const AppMeta = {
  name: packageJson.name,
  version: packageJson.version,
};