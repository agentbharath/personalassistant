import { chmod, readFile, rename, writeFile } from "node:fs/promises";

const file = process.argv[2] ?? ".env.local";
const source = await readFile(file, "utf8");
const values = new Map();
const order = [];

for (const line of source.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  const [, key, value] = match;
  if (!values.has(key)) order.push(key);
  const current = values.get(key) ?? "";
  if (value.length > 0 || current.length === 0) values.set(key, value);
}

const output = `${order.map((key) => `${key}=${values.get(key) ?? ""}`).join("\n")}\n`;
const temporary = `${file}.cleaning`;
await writeFile(temporary, output, { mode: 0o600 });
await rename(temporary, file);
await chmod(file, 0o600);
