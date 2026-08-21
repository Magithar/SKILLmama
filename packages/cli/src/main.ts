#!/usr/bin/env node
import { parseArgs } from "node:util";
import { analyzeProject } from "skillmama";
import { renderProfileJson, renderProfileText } from "./render.js";

const USAGE = `skillmama — structured project scan

Usage:
  skillmama scan [dir]     Scan a project directory (default: current directory)

Options:
  --json                   Output the StackProfile as JSON
  -h, --help               Show this help

Exit codes:
  0  scan completed
  1  scan failed (unreadable or unparseable project files)
  2  usage error`;

function fail(message: string, code: number): never {
  console.error(`skillmama: ${message}`);
  console.error(USAGE);
  process.exit(code);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals.length === 0) {
  console.log(USAGE);
  process.exit(0);
}

if (positionals[0] !== "scan") {
  fail(`unknown command "${positionals[0]}" — expected "scan"`, 2);
}
if (positionals.length > 2) {
  fail("too many arguments — usage: skillmama scan [dir]", 2);
}

const dir = positionals[1] ?? ".";

try {
  const profile = await analyzeProject(dir);
  console.log(values.json ? renderProfileJson(profile) : renderProfileText(profile));
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`skillmama: scan failed for "${dir}" — ${message}`);
  process.exit(1);
}
