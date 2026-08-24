#!/usr/bin/env node
import { parseArgs } from "node:util";
import { analyzeProject, type OsvEcosystem } from "skillmama";
import { resolveNpmDefaults, runCheck, type CheckTarget } from "./check.js";
import {
  renderCheckJson,
  renderCheckText,
  renderProfileJson,
  renderProfileText,
} from "./render.js";

const USAGE = `skillmama — the deterministic half of SKILLmama's pipeline

Usage:
  skillmama scan [dir]        Scan a project directory (default: current directory)
  skillmama check <package>   Run the live-data checks against a published package

Options:
  --json                      Output as JSON
  --ecosystem <name>          check: npm (default), PyPI, Go, crates.io
  --version <v>               check: the version you intend to recommend.
                              Omitted on npm, the registry's latest is queried
                              and the substitution is reported.
  --repo <owner/name>         check: GitHub repo for stars and last commit.
                              Omitted on npm, it is read from the packument.
  -h, --help                  Show this help

check runs the OSV.dev advisory query, the npm publisher-continuity check, and
the Popularity/Maintenance band lookups. It does NOT read the package's docs or
code, so it cannot produce Phase 3.5's content findings — a PASS means the
live-data checks found nothing, not that the package is safe. The output says so
before it says anything else.

Exit codes:
  0  completed; verdict PASS or WARN
  1  failed (unreadable project files, or a check that could not run)
  2  usage error
  3  completed; verdict BLOCKED`;

function fail(message: string, code: number): never {
  console.error(`skillmama: ${message}`);
  console.error(USAGE);
  process.exit(code);
}

const ECOSYSTEMS: OsvEcosystem[] = ["npm", "PyPI", "Go", "crates.io"];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    ecosystem: { type: "string" },
    version: { type: "string" },
    repo: { type: "string" },
  },
});

if (values.help || positionals.length === 0) {
  console.log(USAGE);
  process.exit(0);
}

const command = positionals[0];
if (command !== "scan" && command !== "check") {
  fail(`unknown command "${command}" — expected "scan" or "check"`, 2);
}

if (command === "scan") {
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
} else {
  if (positionals.length !== 2) {
    fail("usage: skillmama check <package>", 2);
  }
  const name = positionals[1];
  const ecosystem = (values.ecosystem ?? "npm") as OsvEcosystem;
  if (!ECOSYSTEMS.includes(ecosystem)) {
    fail(
      `unknown --ecosystem "${values.ecosystem}" — expected one of ${ECOSYSTEMS.join(", ")}`,
      2
    );
  }

  let version = values.version;
  let repo = values.repo;
  // Notes describe what was actually SUBSTITUTED, decided here, not what
  // the registry happened to report.
  const resolved: string[] = [];
  if ((!version || !repo) && ecosystem === "npm") {
    const defaults = await resolveNpmDefaults(name);
    if (!version && defaults.version) {
      version = defaults.version;
      resolved.push(
        `No --version given, so the registry's latest (${version}) was queried. SKILL.md says to query the version you intend to recommend; pass --version to do that.`
      );
    }
    if (!repo && defaults.repo) {
      repo = defaults.repo;
      resolved.push(`Repository ${repo} was read from the npm metadata, not supplied.`);
    }
  }
  if (!version) {
    fail(
      `--version is required for --ecosystem ${ecosystem}: SKILL.md says to query the version you intend to recommend, and only npm's latest can be resolved here`,
      2
    );
  }

  const target: CheckTarget = {
    name,
    ecosystem,
    version,
    ...(repo ? { repo } : {}),
    ...(ecosystem === "npm" ? { npmPackage: name } : {}),
  };

  try {
    const result = await runCheck(target, {
      ...(process.env.GITHUB_TOKEN ? { githubToken: process.env.GITHUB_TOKEN } : {}),
    });
    // Anything the run substituted for the user belongs with the other
    // "this is not what you asked for" notices, at the top.
    result.notRun.unshift(...resolved);
    console.log(values.json ? renderCheckJson(result) : renderCheckText(result));
    if (result.security.verdict === "BLOCKED") process.exit(3);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`skillmama: check failed for "${name}" — ${message}`);
    process.exit(1);
  }
}
