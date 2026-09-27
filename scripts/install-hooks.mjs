import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".git") || existsSync(".git/HEAD")) {
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
    console.log("Git hooks configured: .githooks");
  } catch {
    console.warn("Could not configure Git hooks automatically; run `npm run hooks:install` in a writable checkout.");
  }
}
