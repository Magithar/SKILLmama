import { parse as parseToml } from "smol-toml";

/**
 * Per-format dependency extractors for analyzeProject().
 *
 * INTERNAL module — deliberately not re-exported through the package
 * boundary. Each parser receives one manifest's full text and returns raw
 * dependency names exactly as written, with no version specifiers, extras,
 * or environment markers. Lookup against dependencyDetectors and the
 * matchedDependencies bookkeeping live in analyzeProject(), not here.
 *
 * Registry policy 6 applies to every parser: scan ALL dependency sections
 * the format supports — testing tools and dev-time technology are
 * first-class stack evidence.
 *
 * Names are matched against the registry verbatim (policy 2: keys are
 * already normalized per ecosystem). No case/underscore folding here —
 * a name that misses the registry is unknown evidence and is dropped by
 * analyzeProject() (policy 5).
 */

/** Every parser maps one filename → raw dependency names. Keys must be
 *  filenames that also exist in fileDetectors (presence → language). */
export type ManifestParser = (contents: string) => string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Object.keys of each named section that is present as a table/map —
 *  the shared shape of npm's dependency blocks, composer's require
 *  blocks, and Cargo's [dependencies]-style tables. */
function sectionKeys(doc: unknown, sections: string[]): string[] {
  const names: string[] = [];
  if (!isRecord(doc)) return names;
  for (const section of sections) {
    const deps = doc[section];
    if (isRecord(deps)) names.push(...Object.keys(deps));
  }
  return names;
}

/** Leading distribution name of a PEP 508 requirement string, before any
 *  extras ("psycopg2[binary]") or specifiers (">=2.9", "; python_version"). */
function pep508Name(requirement: string): string | undefined {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(requirement);
  return match?.[1];
}

function collectPep508(value: unknown, into: string[]): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const name = pep508Name(entry);
    if (name) into.push(name);
  }
}

export function parsePackageJson(contents: string): string[] {
  return sectionKeys(JSON.parse(contents), [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]);
}

export function parseComposerJson(contents: string): string[] {
  return sectionKeys(JSON.parse(contents), ["require", "require-dev"]);
}

/** PEP 621 ([project]), PEP 735 ([dependency-groups]), and Poetry's
 *  [tool.poetry] layout — all are dependency sections a pyproject.toml
 *  may legitimately carry. Non-string group entries ({include-group =
 *  "dev"} and friends) carry no dependency name and are skipped. */
export function parsePyprojectToml(contents: string): string[] {
  const doc: unknown = parseToml(contents);
  const names: string[] = [];
  if (!isRecord(doc)) return names;

  const project = doc.project;
  if (isRecord(project)) {
    collectPep508(project.dependencies, names);
    const optional = project["optional-dependencies"];
    if (isRecord(optional)) {
      for (const group of Object.values(optional)) collectPep508(group, names);
    }
  }

  const groups = doc["dependency-groups"];
  if (isRecord(groups)) {
    for (const group of Object.values(groups)) collectPep508(group, names);
  }

  const tool = doc.tool;
  if (isRecord(tool) && isRecord(tool.poetry)) {
    const poetry = tool.poetry;
    if (isRecord(poetry.dependencies)) {
      names.push(...Object.keys(poetry.dependencies));
    }
    if (isRecord(poetry.group)) {
      for (const group of Object.values(poetry.group)) {
        if (isRecord(group) && isRecord(group.dependencies)) {
          names.push(...Object.keys(group.dependencies));
        }
      }
    }
  }
  return names;
}

/** Value shapes vary (version string, inline table, workspace inheritance);
 *  only the keys are dependency names — except rename syntax
 *  (`alias = { package = "real-crate", ... }`), where the aliased crate
 *  name is the actual evidence and the local alias usually resolves to
 *  nothing. Both names are emitted; the registry keeps what is real. */
export function parseCargoToml(contents: string): string[] {
  const doc: unknown = parseToml(contents);
  const names: string[] = [];
  if (!isRecord(doc)) return names;
  for (const section of ["dependencies", "dev-dependencies", "build-dependencies"]) {
    const deps = doc[section];
    if (!isRecord(deps)) continue;
    for (const [key, value] of Object.entries(deps)) {
      names.push(key);
      if (isRecord(value) && typeof value.package === "string") {
        names.push(value.package);
      }
    }
  }
  return names;
}

/** pip requirements format: one requirement per line, `-r`/`-e`/`--hash`
 *  option lines skipped, comments stripped, backslash continuations joined.
 *  Bare VCS/URL lines without a leading name are out of scope for v1;
 *  PEP 508 direct references (`name @ url`) keep their name. */
export function parseRequirementsTxt(contents: string): string[] {
  const joined = contents.replace(/\\\r?\n/g, " ");
  const names: string[] = [];
  for (let line of joined.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const comment = line.search(/\s#/);
    if (comment !== -1) line = line.slice(0, comment).trim();
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(line)) continue;
    const name = pep508Name(line);
    if (name) names.push(name);
  }
  return names;
}

/** go.mod: single `require path version` lines plus `require ( ... )`
 *  blocks, `// indirect` annotations included (they are still real
 *  requirements). exclude/replace/retract blocks are never entered. */
export function parseGoMod(contents: string): string[] {
  const names: string[] = [];
  let inRequireBlock = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!inRequireBlock) {
      if (/^require\s+\(/.test(line)) {
        inRequireBlock = true;
        continue;
      }
      const single = /^require\s+(\S+)/.exec(line);
      if (single) names.push(single[1]);
    } else {
      if (line.startsWith(")")) {
        inRequireBlock = false;
        continue;
      }
      if (!line || line.startsWith("//")) continue;
      const entry = /^(\S+)/.exec(line);
      if (entry) names.push(entry[1]);
    }
  }
  return names;
}

/** Bundler DSL, reduced to what carries evidence: `gem "name"` lines in
 *  single or double quotes. Gems inside `group ... do` blocks are captured
 *  too — policy 6 scans every section. */
export function parseGemfile(contents: string): string[] {
  const names: string[] = [];
  for (const rawLine of contents.split(/\r?\n/)) {
    const match = /^\s*gem\s+["']([^"']+)["']/.exec(rawLine);
    if (match) names.push(match[1]);
  }
  return names;
}

export const manifestParsers: Record<string, ManifestParser> = {
  "package.json": parsePackageJson,
  "pyproject.toml": parsePyprojectToml,
  "Cargo.toml": parseCargoToml,
  "requirements.txt": parseRequirementsTxt,
  "go.mod": parseGoMod,
  Gemfile: parseGemfile,
  "composer.json": parseComposerJson,
};
