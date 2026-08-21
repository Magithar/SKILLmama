import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parsePackageJson,
  parseComposerJson,
  parsePyprojectToml,
  parseCargoToml,
  parseRequirementsTxt,
  parseGoMod,
  parseGemfile,
} from "../dist/mechanical/parsers.js";
import { analyzeProject } from "../dist/index.js";

// Parser-level pins for the tricky extraction rules, plus analyzeProject
// behaviors the fixtures cannot express (precedence, error policy).

test("package.json: every dependency section is scanned", () => {
  const names = parsePackageJson(
    JSON.stringify({
      dependencies: { next: "^14" },
      devDependencies: { vitest: "^2" },
      optionalDependencies: { fsevents: "^2" },
      peerDependencies: { react: ">=18" },
    })
  );
  assert.deepEqual(names.sort(), ["fsevents", "next", "react", "vitest"]);
});

test("composer.json: require and require-dev are scanned", () => {
  const names = parseComposerJson(
    JSON.stringify({
      require: { "php": ">=8.1", "laravel/framework": "^11.0" },
      "require-dev": { "phpunit/phpunit": "^11.0" },
    })
  );
  assert.deepEqual(names.sort(), ["laravel/framework", "php", "phpunit/phpunit"]);
});

test("pyproject.toml: PEP 621, PEP 735, and Poetry sections all scanned", () => {
  const names = parsePyprojectToml(`
[project]
name = "x"
dependencies = [
    "fastapi>=0.111",
    "psycopg2-binary[binary]>=2.9 ; python_version >= '3.12'",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[dependency-groups]
lint = ["ruff>=0.4"]
dev = [{include-group = "lint"}, "mypy>=1.10"]

[tool.poetry.dependencies]
python = "^3.12"
sqlalchemy = "^2.0"

[tool.poetry.group.dev.dependencies]
black = "^24.4"
`);
  assert.deepEqual(names.sort(), [
    "black",
    "fastapi",
    "mypy",
    "psycopg2-binary",
    "pytest",
    "python",
    "ruff",
    "sqlalchemy",
  ]);
});

test("Cargo.toml: dependency tables scanned regardless of value shape", () => {
  const names = parseCargoToml(`
[dependencies]
axum = "0.7"
serde = { version = "1.0", features = ["derive"] }

[dev-dependencies]
tokio = { workspace = true }

[build-dependencies]
cc = "1.0"

[profile.release]
opt-level = 3
`);
  assert.deepEqual(names.sort(), ["axum", "cc", "serde", "tokio"]);
});

test("Cargo.toml: renamed dependencies expose the real crate name", () => {
  const names = parseCargoToml(`
[dependencies]
redis_stable = { package = "redis", version = "0.25" }
serde_json_new = { package = "serde_json", version = "0.9" }
`);
  assert.deepEqual(names.sort(), [
    "redis",
    "redis_stable",
    "serde_json",
    "serde_json_new",
  ]);
});

test("requirements.txt: options, comments, extras, markers, URLs handled", () => {
  const names = parseRequirementsTxt(`
# full comment line
-r base.txt
-e git+https://github.com/x/y.git#egg=y
--hash=sha256:abc
fastapi>=0.111
psycopg2[binary]>=2.9 ; python_version >= "3.12"
sqlalchemy==2.0.30  # trailing comment
requests @ https://example.com/requests.whl
git+https://github.com/x/z.git#egg=z
flask \\
  >=3.0
`);
  assert.deepEqual(names.sort(), [
    "fastapi",
    "flask",
    "psycopg2",
    "requests",
    "sqlalchemy",
  ]);
});

test("go.mod: single requires, blocks, indirect; exclude not captured", () => {
  const names = parseGoMod(`
module example.com/app

go 1.22

require github.com/gin-gonic/gin v1.10.0

require (
    github.com/foo/bar v1.0.0
    gorm.io/gorm v1.25.0 // indirect
)

exclude github.com/bad/dep v1.0.0
`);
  assert.deepEqual(names.sort(), [
    "github.com/foo/bar",
    "github.com/gin-gonic/gin",
    "gorm.io/gorm",
  ]);
});

test("Gemfile: both quote styles, versions ignored, groups captured", () => {
  const names = parseGemfile(`
source "https://rubygems.org"

gem "rails", "~> 7.1"
gem 'pg'

group :development, :test do
  gem "rspec"
end
# gem "commented-out"
`);
  assert.deepEqual(names.sort(), ["pg", "rails", "rspec"]);
});

// --- analyzeProject behaviors ---

async function withTempProject(files, run) {
  const dir = await mkdtemp(join(tmpdir(), "skillmama-scan-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(join(dir, name), contents);
    }
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("empty directory: all categories present and empty, no deploymentTarget", async () => {
  await withTempProject({}, async (dir) => {
    const profile = await analyzeProject(dir);
    assert.deepEqual(profile.matchedDependencies, {});
    assert.equal(profile.deploymentTarget, undefined);
    for (const category of Object.keys(profile)) {
      if (category === "matchedDependencies") continue;
      assert.deepEqual(profile[category], []);
    }
  });
});

test("unknown dependencies are silently ignored (policy 5)", async () => {
  await withTempProject(
    { "package.json": JSON.stringify({ dependencies: { "who-is-this": "^1" } }) },
    async (dir) => {
      const profile = await analyzeProject(dir);
      assert.deepEqual(profile.languages, ["nodejs"]);
      assert.deepEqual(profile.matchedDependencies, {});
    }
  );
});

test("normalization fallback matches case/underscore variants, stores raw verbatim", async () => {
  await withTempProject(
    { "requirements.txt": "Django>=4.0\npsycopg2_binary>=2.9\n" },
    async (dir) => {
      const profile = await analyzeProject(dir);
      assert.deepEqual(profile.frameworks, ["django"]);
      assert.deepEqual(profile.databases, ["postgresql"]);
      assert.deepEqual(profile.matchedDependencies["django"], ["Django"]);
      assert.deepEqual(profile.matchedDependencies["postgresql"], ["psycopg2_binary"]);
    }
  );
});

test("multiple deployment configs: lexicographically first source wins", async () => {
  await withTempProject(
    {
      "vercel.json": "{}",
      "fly.toml": 'app = "x"',
    },
    async (dir) => {
      const profile = await analyzeProject(dir);
      assert.deepEqual(profile.deploymentTarget, {
        value: "flyio",
        source: "fly.toml",
      });
    }
  );
});

test("malformed dependency manifest throws loudly, with cause", async () => {
  await withTempProject(
    { "package.json": "{ not json" },
    async (dir) => {
      await assert.rejects(
        analyzeProject(dir),
        (error) => error instanceof Error && /package\.json/.test(error.message)
      );
    }
  );
});

test("presence-only detectors never read contents: broken fly.toml still detected", async () => {
  await withTempProject(
    { "fly.toml": "((((not toml" },
    async (dir) => {
      const profile = await analyzeProject(dir);
      assert.deepEqual(profile.deploymentTarget, {
        value: "flyio",
        source: "fly.toml",
      });
    }
  );
});
