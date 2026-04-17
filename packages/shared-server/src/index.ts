import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export * from "./logger";

type PackageVersionManifest = {
  version: string;
};

export type AppVersions = {
  app: string;
  web: string;
  mobile: string;
};

const workspaceRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

async function readPackageVersion(relativePath: string, fallbackVersion?: string) {
  try {
    const packageJson = await readFile(path.join(workspaceRoot, relativePath), "utf8");

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
