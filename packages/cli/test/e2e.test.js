import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURES = join(dirname(CLI), "../../core/fixtures");

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
