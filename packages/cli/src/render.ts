import type { StackProfile } from "skillmama";

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
