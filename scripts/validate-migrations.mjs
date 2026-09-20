import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const directory = join(process.cwd(), "supabase", "migrations");
const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
const prefixes = migrations.map((name) => name.split("_")[0]);
const duplicates = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index);
if (duplicates.length) throw new Error(`Duplicate migration versions: ${[...new Set(duplicates)].join(", ")}`);

for (const migration of migrations) {
  const sql = await readFile(join(directory, migration), "utf8");
  const tables = [...sql.matchAll(/create table public\.([a-z0-9_]+)/gi)].map((match) => match[1]);
  for (const table of tables) {
    if (!new RegExp(`alter table public\\.${table} enable row level security`, "i").test(sql)) {
      throw new Error(`${migration}: public.${table} does not enable row-level security in the same migration`);
    }
  }
}
console.log(`Validated ${migrations.length} ordered migrations with RLS checks.`);
