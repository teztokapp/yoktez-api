import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const entrypoints = [
  "createYoktezApp.js",
  "yoktezClient.js",
  "summary.js",
  "yoktezServer.js",
];

for (const entrypoint of entrypoints) {
  const fileUrl = new URL(`../${entrypoint}`, import.meta.url);
  await access(fileUrl);
  await execFileAsync(process.execPath, ["--check", fileUrl.pathname]);
}

console.log("Build check passed.");
