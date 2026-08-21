import type { StackProfile } from "../contracts/project.js";

/**
 * Detector Registry — SKILLmama's first deterministic knowledge base.
 *
 * A declarative mapping from structured evidence (a dependency name as
 * written in a manifest, a config file's presence) to a canonical
 * technology and the StackProfile slot it fills. analyzeProject() will
 * consume this registry; no other code interprets raw evidence.
 *
 * This file is DATA ONLY: no filesystem access, no scanning logic, no
 * scoring. Its invariants are pinned in test/detectors.test.js.
 *
 * Policies (from contract review — change deliberately, never silently):
 *
 *  1. Canonical IDs are stable, lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*).
 *     Many package names resolve to one canonical ("pg", "postgres",
 *     "postgres.js" → "postgresql"). scoreCandidate() compatibility matching
 *     will compare against these IDs, so they must not drift casually.
 *
 *  2. dependencyDetectors is ONE flat map keyed by the dependency name as
 *     written in the manifest, across ecosystems (npm, PyPI, go.mod,
 *     Cargo.toml, composer.json, Gemfile). Cross-ecosystem collisions are
 *     accepted for v1 — they overwhelmingly name the same technology anyway.
 *
 *  3. Two detector kinds only: "dependency" (fills a StackProfile array) and
 *     "file" (fills an array from manifest presence, or deploymentTarget from
 *     config-file presence). For file detectors the map key IS the provenance
 *     source filename that StackProfile.deploymentTarget requires — no
 *     redundant source field.
 *
 *  4. One canonical belongs to exactly one category. ORMs/ODMs/query builders
 *     fold into "databases" (prisma, drizzle, mongoose → mongodb, sqlalchemy).
 *     Vector databases sit under "search" for v1. Supabase spans several
 *     categories; it is pinned to "databases" until a real consumer needs
 *     otherwise. Deployment platforms fill deploymentTarget, which is a
 *     separate slot, not a category.
 *
 *  5. Unknown dependencies are silently ignored — that is a consumer policy
 *     owned by analyzeProject(), not encoded here. Every StackProfile value
 *     must trace to a registry hit; the registry makes no coverage promise
 *     beyond the seeds below.
 *
 *  6. CONSUMER POLICY for analyzeProject(): scan ALL dependency sections a
 *     manifest format supports (npm dependencies + devDependencies + others,
 *     pyproject dependency groups, Cargo [dev-dependencies], Gemfile groups,
 *     ...). Testing tools and dev-time technology are first-class stack
 *     evidence — SKILL.md reads the whole file, and categories like testing
 *     and languages live almost entirely in dev-only sections.
 *
 *     Raw names from every scanned section are preserved verbatim in
 *     StackProfile.matchedDependencies (canonical ID → raw names), which is
 *     what SKILL.md Phase 4's ALREADY PRESENT check matches against.
 */

/** The StackProfile array slots a detector can fill. Derived from the
 * contract itself, so adding/removing a StackProfile category forces a
 * conscious update here (via ALL_STACK_CATEGORIES below). */
export type StackCategory = {
  [K in keyof StackProfile]-?: StackProfile[K] extends string[] ? K : never;
}[keyof StackProfile];

export type DetectorKind = "dependency" | "file";

export interface DependencyDetectorEntry {
  kind: "dependency";
  canonical: string;
  category: StackCategory;
}

export interface FileDetectorEntry {
  kind: "file";
  /** Which StackProfile slot this file's presence fills. */
  target: StackCategory | "deploymentTarget";
  canonical: string;
}

export type DetectorEntry = DependencyDetectorEntry | FileDetectorEntry;

/**
 * Runtime mirror of StackCategory. The `satisfies` clause fails to compile
 * if StackProfile gains or loses an array category — the registry cannot
 * silently drift from the contract.
 */
const ALL_STACK_CATEGORIES = {
  languages: true,
  frameworks: true,
  databases: true,
  aiTools: true,
  authSystems: true,
  caching: true,
  queues: true,
  search: true,
  storage: true,
  email: true,
  payments: true,
  observability: true,
  testing: true,
} as const satisfies Record<StackCategory, boolean>;

export const stackCategories: StackCategory[] = Object.keys(
  ALL_STACK_CATEGORIES
) as StackCategory[];

/**
 * Dependency-name → technology. Keys are written exactly as they appear in
 * a manifest (scoped npm names, PyPI normalized names, full Go module paths).
 */
export const dependencyDetectors: Record<string, DependencyDetectorEntry> = {
  // languages
  typescript: { kind: "dependency", canonical: "typescript", category: "languages" },

  // frameworks
  next: { kind: "dependency", canonical: "nextjs", category: "frameworks" },
  react: { kind: "dependency", canonical: "react", category: "frameworks" },
  vue: { kind: "dependency", canonical: "vue", category: "frameworks" },
  svelte: { kind: "dependency", canonical: "svelte", category: "frameworks" },
  "@angular/core": { kind: "dependency", canonical: "angular", category: "frameworks" },
  nuxt: { kind: "dependency", canonical: "nuxt", category: "frameworks" },
  express: { kind: "dependency", canonical: "express", category: "frameworks" },
  fastify: { kind: "dependency", canonical: "fastify", category: "frameworks" },
  "@nestjs/core": { kind: "dependency", canonical: "nestjs", category: "frameworks" },
  hono: { kind: "dependency", canonical: "hono", category: "frameworks" },
  astro: { kind: "dependency", canonical: "astro", category: "frameworks" },
  django: { kind: "dependency", canonical: "django", category: "frameworks" },
  flask: { kind: "dependency", canonical: "flask", category: "frameworks" },
  fastapi: { kind: "dependency", canonical: "fastapi", category: "frameworks" },
  "laravel/framework": { kind: "dependency", canonical: "laravel", category: "frameworks" },
  rails: { kind: "dependency", canonical: "ruby-on-rails", category: "frameworks" },
  "github.com/gin-gonic/gin": { kind: "dependency", canonical: "gin", category: "frameworks" },
  axum: { kind: "dependency", canonical: "axum", category: "frameworks" },
  tailwindcss: { kind: "dependency", canonical: "tailwindcss", category: "frameworks" },

  // databases (ORMs/ODMs/query builders folded here per policy 4)
  pg: { kind: "dependency", canonical: "postgresql", category: "databases" },
  postgres: { kind: "dependency", canonical: "postgresql", category: "databases" },
  "postgres.js": { kind: "dependency", canonical: "postgresql", category: "databases" },
  psycopg2: { kind: "dependency", canonical: "postgresql", category: "databases" },
  "psycopg2-binary": { kind: "dependency", canonical: "postgresql", category: "databases" },
  mysql2: { kind: "dependency", canonical: "mysql", category: "databases" },
  "better-sqlite3": { kind: "dependency", canonical: "sqlite", category: "databases" },
  mongodb: { kind: "dependency", canonical: "mongodb", category: "databases" },
  mongoose: { kind: "dependency", canonical: "mongodb", category: "databases" },
  sqlalchemy: { kind: "dependency", canonical: "sqlalchemy", category: "databases" },
  "@prisma/client": { kind: "dependency", canonical: "prisma", category: "databases" },
  "drizzle-orm": { kind: "dependency", canonical: "drizzle", category: "databases" },
  typeorm: { kind: "dependency", canonical: "typeorm", category: "databases" },
  sequelize: { kind: "dependency", canonical: "sequelize", category: "databases" },
  knex: { kind: "dependency", canonical: "knex", category: "databases" },
  "gorm.io/gorm": { kind: "dependency", canonical: "gorm", category: "databases" },
  // Supabase spans db/auth/storage; pinned to databases per policy 4.
  "@supabase/supabase-js": { kind: "dependency", canonical: "supabase", category: "databases" },

  // AI tools
  openai: { kind: "dependency", canonical: "openai", category: "aiTools" },
  "@anthropic-ai/sdk": { kind: "dependency", canonical: "anthropic", category: "aiTools" },
  langchain: { kind: "dependency", canonical: "langchain", category: "aiTools" },
  "@langchain/core": { kind: "dependency", canonical: "langchain", category: "aiTools" },
  ollama: { kind: "dependency", canonical: "ollama", category: "aiTools" },

  // auth
  "next-auth": { kind: "dependency", canonical: "next-auth", category: "authSystems" },
  "better-auth": { kind: "dependency", canonical: "better-auth", category: "authSystems" },
  "@clerk/nextjs": { kind: "dependency", canonical: "clerk", category: "authSystems" },
  "@auth0/nextjs-auth0": { kind: "dependency", canonical: "auth0", category: "authSystems" },
  passport: { kind: "dependency", canonical: "passport", category: "authSystems" },
  lucia: { kind: "dependency", canonical: "lucia", category: "authSystems" },

  // caching
  redis: { kind: "dependency", canonical: "redis", category: "caching" },
  ioredis: { kind: "dependency", canonical: "redis", category: "caching" },
  "@upstash/redis": { kind: "dependency", canonical: "upstash-redis", category: "caching" },
  memcached: { kind: "dependency", canonical: "memcached", category: "caching" },

  // queues
  bullmq: { kind: "dependency", canonical: "bullmq", category: "queues" },
  bull: { kind: "dependency", canonical: "bull", category: "queues" },
  amqplib: { kind: "dependency", canonical: "rabbitmq", category: "queues" },
  kafkajs: { kind: "dependency", canonical: "kafka", category: "queues" },
  celery: { kind: "dependency", canonical: "celery", category: "queues" },
  sidekiq: { kind: "dependency", canonical: "sidekiq", category: "queues" },

  // search (vector databases included here per policy 4)
  "@elastic/elasticsearch": { kind: "dependency", canonical: "elasticsearch", category: "search" },
  meilisearch: { kind: "dependency", canonical: "meilisearch", category: "search" },
  typesense: { kind: "dependency", canonical: "typesense", category: "search" },
  algoliasearch: { kind: "dependency", canonical: "algolia", category: "search" },
  "@pinecone-database/pinecone": { kind: "dependency", canonical: "pinecone", category: "search" },

  // storage
  "@aws-sdk/client-s3": { kind: "dependency", canonical: "aws-s3", category: "storage" },
  "@google-cloud/storage": { kind: "dependency", canonical: "google-cloud-storage", category: "storage" },
  "@azure/storage-blob": { kind: "dependency", canonical: "azure-blob-storage", category: "storage" },
  minio: { kind: "dependency", canonical: "minio", category: "storage" },

  // email
  nodemailer: { kind: "dependency", canonical: "nodemailer", category: "email" },
  "@sendgrid/mail": { kind: "dependency", canonical: "sendgrid", category: "email" },
  resend: { kind: "dependency", canonical: "resend", category: "email" },
  postmark: { kind: "dependency", canonical: "postmark", category: "email" },
  "@aws-sdk/client-ses": { kind: "dependency", canonical: "amazon-ses", category: "email" },

  // payments
  stripe: { kind: "dependency", canonical: "stripe", category: "payments" },
  "@stripe/stripe-js": { kind: "dependency", canonical: "stripe", category: "payments" },
  "@paypal/paypal-server-sdk": { kind: "dependency", canonical: "paypal", category: "payments" },

  // observability
  "@sentry/node": { kind: "dependency", canonical: "sentry", category: "observability" },
  pino: { kind: "dependency", canonical: "pino", category: "observability" },
  winston: { kind: "dependency", canonical: "winston", category: "observability" },
  "dd-trace": { kind: "dependency", canonical: "datadog", category: "observability" },
  newrelic: { kind: "dependency", canonical: "newrelic", category: "observability" },
  "prom-client": { kind: "dependency", canonical: "prometheus", category: "observability" },
  "@opentelemetry/api": { kind: "dependency", canonical: "opentelemetry", category: "observability" },

  // testing
  vitest: { kind: "dependency", canonical: "vitest", category: "testing" },
  jest: { kind: "dependency", canonical: "jest", category: "testing" },
  mocha: { kind: "dependency", canonical: "mocha", category: "testing" },
  "@playwright/test": { kind: "dependency", canonical: "playwright", category: "testing" },
  cypress: { kind: "dependency", canonical: "cypress", category: "testing" },
  pytest: { kind: "dependency", canonical: "pytest", category: "testing" },
};

/**
 * Filename → technology. The key doubles as the provenance source for
 * StackProfile.deploymentTarget.
 *
 * Deliberately absent for v1:
 *  - Dockerfile / docker-compose.yml — no StackProfile slot exists yet
 *  - .env.example — would be a third detector kind (env-var prefixes),
 *    outside the two kinds agreed in contract review
 */
export const fileDetectors: Record<string, FileDetectorEntry> = {
  // manifest presence → language
  "package.json": { kind: "file", canonical: "nodejs", target: "languages" },
  "requirements.txt": { kind: "file", canonical: "python", target: "languages" },
  "pyproject.toml": { kind: "file", canonical: "python", target: "languages" },
  "go.mod": { kind: "file", canonical: "go", target: "languages" },
  "Cargo.toml": { kind: "file", canonical: "rust", target: "languages" },
  "composer.json": { kind: "file", canonical: "php", target: "languages" },
  Gemfile: { kind: "file", canonical: "ruby", target: "languages" },

  // config-file presence → deployment platform
  "fly.toml": { kind: "file", canonical: "flyio", target: "deploymentTarget" },
  "render.yaml": { kind: "file", canonical: "render", target: "deploymentTarget" },
  "vercel.json": { kind: "file", canonical: "vercel", target: "deploymentTarget" },
  "railway.toml": { kind: "file", canonical: "railway", target: "deploymentTarget" },
  "railway.json": { kind: "file", canonical: "railway", target: "deploymentTarget" },
};
