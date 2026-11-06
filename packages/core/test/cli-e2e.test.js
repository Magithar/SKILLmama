import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { paintVerdict, renderBanner, renderGuide } from "../dist/cli/welcome.js";

const CLI = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const FIXTURES = join(dirname(CLI), "../../fixtures");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

test("scan on a fixture project renders detected stack and evidence", () => {
  const { status, stdout } = run(["scan", join(FIXTURES, "next-postgres")]);
  assert.equal(status, 0);
  assert.match(stdout, /Languages +nodejs/);
  assert.match(stdout, /Frameworks +nextjs/);
  assert.match(stdout, /Databases +postgresql/);
  assert.match(stdout, /Payments +stripe/);
  assert.match(stdout, /Deployment +flyio \(fly\.toml\)/);
  assert.match(stdout, /Dependency evidence:\n  nextjs: next/);
});

test("scan --json emits a parseable StackProfile matching the fixture expectation", () => {
  const { status, stdout } = run([
    "scan",
    "--json",
    join(FIXTURES, "next-postgres"),
  ]);
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(parsed, JSON.parse(readFileSync(join(FIXTURES, "next-postgres", "expected.json"), "utf8")));
});

test("scan of the empty fixture reports nothing detected, exit 0", () => {
  const { status, stdout } = run(["scan", join(FIXTURES, "empty")]);
  assert.equal(status, 0);
  assert.match(stdout, /No known technologies detected/);
});

test("missing directory fails loudly with exit code 1 and no usage dump", () => {
  const { status, stderr, stdout } = run(["scan", "/nonexistent/dir/xyz"]);
  assert.equal(status, 1);
  assert.match(stderr, /scan failed/);
  assert.doesNotMatch(stderr, /Usage:/);
});

test("unknown command is a usage error with exit code 2", () => {
  const { status, stderr } = run(["frobnicate"]);
  assert.equal(status, 2);
  assert.match(stderr, /unknown command/);
  assert.match(stderr, /Usage:/);
});

test("--help exits 0 and prints usage", () => {
  const { status, stdout } = run(["--help"]);
  assert.equal(status, 0);
  assert.match(stdout, /skillmama scan \[dir\]/);
});

test("no arguments shows the quick start, without the banner when piped", () => {
  const { status, stdout } = run([]);
  assert.equal(status, 0);
  assert.match(stdout, /Get started[\s\S]*skillmama scan[\s\S]*skillmama --help/);
  assert.match(stdout, /inside your coding agent:\s+\/skillmama /);
  for (const row of stdout.split("\n")) assert.ok(row.length <= 80, row);
  assert.doesNotMatch(stdout, /Usage:|made by|▀/);
});

test("guide colors only /skillmama", () => {
  const painted = renderGuide({ color: true, truecolor: false });
  assert.match(painted, /\x1b\[38;5;78m\/skillmama\x1b\[0m scans your project/);
  assert.match(painted, /\x1b\[38;5;78m\/skillmama\x1b\[0m find me/);
  assert.equal(painted.match(/\x1b\[38;5;78m/g).length, 2);
  assert.equal(
    painted.replace(/\x1b\[[0-9;]*m/g, ""),
    renderGuide({ color: false, truecolor: false })
  );
});

test("banner fits 80 columns and drops the wordmark when narrower", () => {
  const plain = { color: false, truecolor: false };
  const wide = renderBanner("1.2.3", 80, plain);
  assert.match(wide, /v1\.2\.3/);
  assert.match(wide, /https:\/\/x\.com\/magithar/);
  for (const row of wide.split("\n")) assert.ok(row.length <= 80, row);
  assert.doesNotMatch(renderBanner("1.2.3", 79, plain), /▀/);
  assert.doesNotMatch(wide, /\x1b/);
  assert.match(renderBanner("1.2.3", 80, { color: true, truecolor: true }), /38;2;89;195;120/);
  assert.match(renderBanner("1.2.3", 80, { color: true, truecolor: false }), /38;5;78/);
});

test("verdicts are red, yellow and green; plain output has no color", () => {
  const color = { color: true, truecolor: true };
  assert.match(paintVerdict("BLOCKED", color), /\x1b\[38;2;239;83;80mBLOCKED\x1b\[0m/);
  assert.match(paintVerdict("WARN", color), /\x1b\[38;2;245;221;17mWARN\x1b\[0m/);
  assert.match(paintVerdict("PASS", color), /\x1b\[38;2;89;195;120mPASS\x1b\[0m/);
  assert.equal(paintVerdict("PASS", { color: false, truecolor: true }), "PASS");
  assert.equal(paintVerdict("BLOCKED", { color: false, truecolor: true }), "BLOCKED");
  assert.match(paintVerdict("BLOCKED", { color: true, truecolor: false }), /38;5;203/);
});

// ---------------------------------------------------------------------------
// check — process-level behavior. These do not touch the network: they only
// exercise argument handling and the paths that fail before any request.
// ---------------------------------------------------------------------------

test("check requires an explicit version outside npm", () => {
  const { status, stderr } = run(["check", "flask", "--ecosystem", "PyPI"]);
  assert.equal(status, 2);
  assert.match(stderr, /--version is required for --ecosystem PyPI/);
});

test("check rejects an unknown ecosystem by name", () => {
  const { status, stderr } = run(["check", "x", "--ecosystem", "cargo"]);
  assert.equal(status, 2);
  assert.match(stderr, /unknown --ecosystem "cargo"/);
});

test("check needs exactly one package argument", () => {
  assert.equal(run(["check"]).status, 2);
  assert.equal(run(["check", "a", "b"]).status, 2);
});

test("an unknown command names both commands", () => {
  const { status, stderr } = run(["explore"]);
  assert.equal(status, 2);
  assert.match(stderr, /expected "scan" or "check"/);
});

test("help documents check and its exit codes", () => {
  const { status, stdout } = run(["--help"]);
  assert.equal(status, 0);
  assert.match(stdout, /skillmama check <package>/);
  assert.match(stdout, /3 {2}completed; verdict BLOCKED/);
  assert.match(stdout, /not that the package is safe/);
});
