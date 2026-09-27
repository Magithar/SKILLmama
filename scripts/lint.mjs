import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", ".specstory", ".gstack", ".evidence-loop"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(mjs|js|ts)$/.test(entry.name)) yieldFile(path);
  }
}

function yieldFile(path) {
  const text = readFileSync(path, "utf8");
  const label = relative(root, path);
  if (/\r\n/.test(text)) failures.push(`${label}: CRLF line endings are not allowed`);
  if (/[ \t]+\n/.test(text)) failures.push(`${label}: trailing whitespace found`);
  if (path.endsWith(".js") || path.endsWith(".mjs")) {
    try { execFileSync(process.execPath, ["--check", path], { stdio: "pipe" }); }
    catch { failures.push(`${label}: JavaScript syntax check failed`); }
  }
}

walk(root);
if (failures.length) {
  console.error(failures.map((failure) => `lint: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Lint passed.");
