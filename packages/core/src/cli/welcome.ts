import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The first-run welcome and the no-arguments guide. Rendering is pure; only
 * showWelcomeOnce() touches the terminal state and disk, and main.ts calls it.
 */

// Letters drawn as scanlines: each "▀" is a bar with a dark gap under it. "mama" is
// a row shorter than "SKILL", on the same baseline, as the logo writes the name.
const SKILL = [
  "▀▀▀▀▀▀▀ ▀▀   ▀▀ ▀▀ ▀▀      ▀▀     ",
  "▀▀      ▀▀  ▀▀  ▀▀ ▀▀      ▀▀     ",
  "▀▀▀▀▀▀▀ ▀▀▀▀▀   ▀▀ ▀▀      ▀▀     ",
  "     ▀▀ ▀▀▀▀▀   ▀▀ ▀▀      ▀▀     ",
  "     ▀▀ ▀▀  ▀▀  ▀▀ ▀▀      ▀▀     ",
  "▀▀▀▀▀▀▀ ▀▀   ▀▀ ▀▀ ▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀",
];
const MAMA = [
  "",
  "▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀",
  "▀▀  ▀▀  ▀▀      ▀▀ ▀▀  ▀▀  ▀▀      ▀▀",
  "▀▀  ▀▀  ▀▀ ▀▀▀▀▀▀▀ ▀▀  ▀▀  ▀▀ ▀▀▀▀▀▀▀",
  "▀▀  ▀▀  ▀▀ ▀▀   ▀▀ ▀▀  ▀▀  ▀▀ ▀▀   ▀▀",
  "▀▀  ▀▀  ▀▀ ▀▀▀▀▀▀▀ ▀▀  ▀▀  ▀▀ ▀▀▀▀▀▀▀",
];

export interface Palette {
  color: boolean;
  truecolor: boolean;
}

// The same fade as skill-land: light mint at the top to emerald #59C378 at the
// bottom. Without 24-bit color (macOS Terminal sets no COLORTERM) the nearest
// 256-color steps do the same.
const TOP = [200, 245, 214];
const EMERALD = [89, 195, 120];
const FADE_256 = [194, 158, 121, 114, 78, 78];

function paint(code: string, text: string, { color }: Palette): string {
  return color ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function shade(row: number, { truecolor }: Palette): string {
  if (!truecolor) return `38;5;${FADE_256[row]}`;
  const rgb = TOP.map((top, i) =>
    Math.round(top + ((EMERALD[i] as number) - top) * (row / (SKILL.length - 1)))
  );
  return `38;2;${rgb.join(";")}`;
}

export function renderBanner(version: string, columns: number, palette: Palette): string {
  const brand = (text: string) => paint(shade(SKILL.length - 1, palette), text, palette);
  const dim = (text: string) => paint(`2;${shade(SKILL.length - 1, palette)}`, text, palette);
  // A mid grey, readable on both dark and white terminals.
  const muted = (text: string) =>
    paint(palette.truecolor ? "38;2;138;138;132" : "38;5;245", text, palette);
  // "mama" keeps the terminal's own text color, which separates the two words and
  // shows on dark and white alike. The wordmark would wrap and fall apart in a
  // narrow terminal.
  const mark = columns >= 80
    ? SKILL.map((row, i) => `  ${paint(shade(i, palette), row, palette)}  ${MAMA[i]}`.trimEnd()).join("\n")
    : `  ${brand("SKILL")}mama`;
  return [
    "",
    mark,
    "",
    `  ${muted("find the right library · checked before you add it · ")}${dim(`v${version}`)}`,
    "",
    `  ${muted("made by  ")}${brand("magithar")}`,
    `  ${muted("contact  ")}${brand("https://x.com/magithar")}`,
  ].join("\n");
}

/**
 * Red, yellow, green. A green PASS still only means the live-data checks found
 * nothing, which is why check prints what it did not run above the verdict.
 */
export function paintVerdict(verdict: string, palette: Palette): string {
  if (verdict === "BLOCKED") {
    return paint(palette.truecolor ? "38;2;239;83;80" : "38;5;203", verdict, palette);
  }
  if (verdict === "WARN") {
    return paint(palette.truecolor ? "38;2;245;221;17" : "38;5;220", verdict, palette);
  }
  if (verdict === "PASS") {
    return paint(palette.truecolor ? "38;2;89;195;120" : "38;5;78", verdict, palette);
  }
  return verdict;
}

export function terminalPalette(): Palette {
  return {
    color: process.stdout.isTTY === true && !process.env.NO_COLOR,
    truecolor: /truecolor|24bit/i.test(process.env.COLORTERM || ""),
  };
}

/** The quick start. Green marks only the command that is the point of it all. */
export function renderGuide(palette: Palette): string {
  const skill = paint(shade(SKILL.length - 1, palette), "/skillmama", palette);
  return `
  Get started
    1. See your stack       skillmama scan
    2. Check a package      skillmama check lodash --version 4.17.15
    3. Add the agent skill  npx skill-land Magithar/SKILLmama --for claude-code

  Then, inside your coding agent:
    ${skill} scans your project and asks what to find
    ${skill} find me a vector database for my FastAPI project

  All options: skillmama --help
`;
}

/**
 * Prints the banner once per machine, only to a person at a terminal: piped
 * output, CI and --json never see it. Failing to record that it was shown skips
 * it rather than repeating it on every run, and never fails the command.
 */
export function showWelcomeOnce(version: string, json: boolean): void {
  if (json || !process.stdout.isTTY || process.env.CI) return;
  const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "skillmama");
  const marker = join(dir, "welcomed");
  if (existsSync(marker)) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(marker, `${new Date().toISOString()}\n`);
  } catch {
    return;
  }
  console.log(renderBanner(version, process.stdout.columns || 80, terminalPalette()));
}
