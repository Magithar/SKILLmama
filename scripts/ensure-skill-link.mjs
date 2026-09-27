import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve("skillmama/SKILL.md");
const target = resolve(".claude/skills/skillmama/SKILL.md");
mkdirSync(dirname(target), { recursive: true });

if (!existsSync(target)) {
  copyFileSync(source, target);
  console.log("Created a portable SKILL.md copy.");
} else if (lstatSync(target).isSymbolicLink()) {
  if (realpathSync(target) !== source) throw new Error(`SKILL.md symlink points somewhere unexpected: ${target}`);
  console.log("SKILL.md symlink is valid.");
} else if (readFileSync(target, "utf8").trim() === "../../../skillmama/SKILL.md") {
  copyFileSync(source, target);
  console.log("Replaced Windows symlink placeholder with a portable copy.");
} else if (readFileSync(target, "utf8") !== readFileSync(source, "utf8")) {
  throw new Error(".claude/skills/skillmama/SKILL.md differs from the canonical skillmama/SKILL.md");
} else {
  console.log("Portable SKILL.md copy is valid.");
}
