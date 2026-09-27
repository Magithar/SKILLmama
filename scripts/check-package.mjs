import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cache = mkdtempSync(join(tmpdir(), "skillmama-npm-cache-"));
try {
  const output = execFileSync("npm", ["pack", "--workspace", "packages/core", "--dry-run", "--json", "--loglevel=error"], {
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
  });
  const report = JSON.parse(output);
  const files = report[0]?.files ?? [];
  const binary = files.find((file) => file.path === "dist/cli/main.js");
  if (!files.some((file) => file.path === "LICENSE")) throw new Error("package is missing LICENSE");
  if (!binary) throw new Error("package is missing dist/cli/main.js");
  if ((binary.mode & 0o111) === 0) throw new Error("CLI binary is not executable in the package");
  console.log(`Package check passed: ${report[0].filename}; executable CLI preserved.`);
} finally {
  rmSync(cache, { recursive: true, force: true });
  rmSync("packages/core/LICENSE", { force: true });
}
