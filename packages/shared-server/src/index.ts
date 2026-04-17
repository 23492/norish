import { readFile } from "node:fs/promises";

import { resolveExistingWorkspacePath } from "./lib/workspace-paths";

export * from "./logger";

type PackageVersionManifest = {
  version: string;
};

export type AppVersions = {
  app: string;
  web: string;
  mobile: string;
};

async function readPackageVersion(relativePath: string, fallbackVersion?: string) {
  try {
    const packageJson = await readFile(resolveExistingWorkspacePath(relativePath), "utf8");

    return (JSON.parse(packageJson) as PackageVersionManifest).version;
  } catch (error) {
    if (fallbackVersion !== undefined) {
      return fallbackVersion;
    }

    throw error;
  }
}

const appVersionsPromise = Promise.all([
  readPackageVersion("package.json"),
  readPackageVersion("apps/web/package.json"),
  readPackageVersion("apps/mobile/package.json", "unavailable"),
]).then(([appVersion, webVersion, mobileVersion]) => {
  return {
    app: appVersion,
    web: webVersion,
    mobile: mobileVersion,
  } satisfies AppVersions;
});

export function getAppVersions() {
  return appVersionsPromise;
}
