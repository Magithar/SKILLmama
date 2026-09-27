import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const major = Number(process.versions.node.split(".")[0]);
const coverage = process.argv.includes("--coverage");
const testFiles = readdirSync("test")
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => `test/${name}`);

const args = ["--test"];
if (major >= 20) args.push("--test-timeout=30000");
if (coverage) {
  if (major < 20) {
    console.warn("Coverage thresholds require Node.js 20 or newer; skipping coverage mode on this runtime.");
    process.exit(0);
  }
  args.push(
    "--experimental-test-coverage",
    "--test-coverage-lines=70",
    "--test-coverage-functions=70",
    "--test-coverage-branches=60"
  );
}
args.push(...testFiles);

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
