import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const excludedDirectories = new Set([".git", ".next", "node_modules", "coverage"]);
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".sql", ".yml", ".yaml", ".example"]);
const secretPatterns = [
  { name: "Anthropic API key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "Hugging Face token", pattern: /hf_[A-Za-z0-9]{20,}/ },
  { name: "Supabase secret key", pattern: /sb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Google API key", pattern: /AIza[A-Za-z0-9_-]{30,}/ },
];

const findings = [];
for await (const file of files(root)) {
  const relativePath = relative(root, file);
  if (/^\.env(?:\.|$)/.test(relativePath) && relativePath !== ".env.example") continue;
  if (!allowedExtensions.has(extname(file)) && relativePath !== ".env.example") continue;
  const content = await readFile(file, "utf8").catch(() => "");
  for (const { name, pattern } of secretPatterns) {
    const match = pattern.exec(content);
    if (match) findings.push(`${relativePath}:${content.slice(0, match.index).split("\n").length} (${name})`);
  }
}

if (findings.length) {
  console.error(`Potential committed secrets found:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("Secret scan passed.");

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}
