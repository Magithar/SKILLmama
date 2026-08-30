import type { BandOutcome, StackProfile } from "../index.js";
import type { CheckResult } from "./check.js";

/**
 * Pure rendering of a StackProfile for terminal output. No I/O here —
 * main.ts owns process concerns; this module stays unit-testable.
 */

const CATEGORY_LABELS: Record<string, string> = {
  languages: "Languages",
  frameworks: "Frameworks",
  databases: "Databases",
  aiTools: "AI tools",
  authSystems: "Auth systems",
  caching: "Caching",
  queues: "Queues",
  search: "Search",
  storage: "Storage",
  email: "Email",
  payments: "Payments",
  observability: "Observability",
  testing: "Testing",
};

const LABEL_WIDTH = Math.max(
  ...[...Object.values(CATEGORY_LABELS), "Deployment"].map((l) => l.length)
) + 1;

function line(label: string, value: string): string {
  return `${label.padEnd(LABEL_WIDTH)}${value}`;
}

export function renderProfileText(profile: StackProfile): string {
  const rows: string[] = [];
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const values = profile[key as keyof StackProfile];
    if (Array.isArray(values) && values.length > 0) {
      rows.push(line(label, values.join(", ")));
    }
  }
  if (profile.deploymentTarget) {
    const { value, source } = profile.deploymentTarget;
    rows.push(line("Deployment", `${value} (${source})`));
  }

  const sections: string[] = [];
  if (rows.length === 0) {
    sections.push("No known technologies detected.");
  } else {
    sections.push(rows.join("\n"));
  }

  const matched = Object.entries(profile.matchedDependencies);
  if (matched.length > 0) {
    sections.push(
      "Dependency evidence:\n" +
        matched
          .map(([canonical, names]) => `  ${canonical}: ${names.join(", ")}`)
          .join("\n")
    );
  }
  return sections.join("\n\n");
}

export function renderProfileJson(profile: StackProfile): string {
  return JSON.stringify(profile, null, 2);
}

/**
 * Rendering for `skillmama check`. Same posture as the profile renderer:
 * pure, no I/O. The ordering is fixed so identical input produces
 * byte-identical output.
 *
 * One rule shapes the whole layout: what did NOT run is printed FIRST,
 * above the verdict. A reader who stops after the first screen must not
 * come away thinking a package was cleared when only half the gate ran.
 */
export function renderCheckText(result: CheckResult): string {
  const { target, security, popularity, maintenance } = result;
  const sections: string[] = [];

  sections.push(`${target.name}@${target.version}  (${target.ecosystem})`);

  sections.push(
    "Not checked:\n" + result.notRun.map((note) => `  ! ${note}`).join("\n")
  );

  sections.push(`Verdict  ${security.verdict}`);

  if (security.notes && security.notes.length > 0) {
    sections.push(security.notes.map((note) => `  - ${note}`).join("\n"));
  }
  if (security.sqpFlags && security.sqpFlags.length > 0) {
    sections.push(`  Flags: ${security.sqpFlags.join(", ")}`);
  }

  sections.push(
    ["Popularity", "Maintenance"]
      .map((label, i) => {
        const outcome = i === 0 ? popularity.band : maintenance.band;
        return `${label.padEnd(LABEL_WIDTH)}${renderBand(outcome)}`;
      })
      .join("\n") +
      "\n" +
      [...popularity.band.notes, ...maintenance.band.notes]
        .map((note) => `  - ${note}`)
        .join("\n")
  );

  return sections.join("\n\n");
}

function renderBand(outcome: BandOutcome): string {
  if (outcome.status === "unbanded") {
    return "N/A (unverified)";
  }
  const { low, high } = outcome.band;
  const range = low === high ? `${low}` : `${low}-${high}`;
  return `${range}/10  (pick a point in this band)`;
}

export function renderCheckJson(result: CheckResult): string {
  return JSON.stringify(result, null, 2);
}
