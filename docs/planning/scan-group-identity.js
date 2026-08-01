/**
 * scan-group-identity.js
 *
 * Scans EVERY column of `groups` and `group_profiles` and reports which ones hold
 * the same value across all profiles that belong to the same group. Those are the
 * candidates for a conversation-level identity above the per-membership group_id.
 *
 * Run in the folder holding the measurement database:
 *   node scan-group-identity.js
 *   node scan-group-identity.js --db ./db/bench
 *
 * Reading the output: a candidate must be identical WITHIN a group and different
 * ACROSS groups. With only one group present, only the first half is testable, so
 * constants such as flags will also appear identical. The value length column
 * separates them: an identity is long and opaque, a flag is one or two characters.
 */
"use strict";
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const argv = process.argv.slice(2);
const i = argv.indexOf("--db");
const prefix = i >= 0 && argv[i + 1] ? argv[i + 1] : "./db/bench";
const file = path.resolve(prefix + "_chat.db");

console.log("database:", file, "\n");
const db = new DatabaseSync(file, { readOnly: true });

const cols = (table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);

const groupCols = cols("groups");
const profileCols = cols("group_profiles");

// hex() normalises BLOB and TEXT into one comparable representation.
const sel = [
  ...groupCols.map((c) => `hex(g.${c}) AS "g.${c}"`),
  ...profileCols.map((c) => `hex(gp.${c}) AS "gp.${c}"`),
].join(",\n    ");

const rows = db.prepare(`
  SELECT
    g.group_id AS _gid,
    gp.display_name AS _name,
    ${sel}
  FROM groups g
  LEFT JOIN group_profiles gp ON gp.group_profile_id = g.group_profile_id
  ORDER BY gp.display_name, g.user_id
`).all();

if (!rows.length) { console.log("no groups in this database."); process.exit(0); }

const byName = new Map();
for (const r of rows) {
  const k = r._name || "(unnamed)";
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(r);
}

const skip = new Set(["_gid", "_name"]);

for (const [name, members] of byName) {
  console.log(`group "${name}": ${members.length} memberships`);
  console.log(`  group_id values: ${members.map((m) => m._gid).join(", ")}\n`);

  const identical = [];
  const perProfile = [];
  const partial = [];

  for (const key of Object.keys(members[0])) {
    if (skip.has(key)) continue;
    const vals = members.map((m) => m[key]);
    const filled = vals.filter((v) => v !== null && v !== "");
    if (!filled.length) continue;                    // never populated, not a candidate
    const distinct = new Set(filled).size;
    const len = String(filled[0]).length;
    const entry = { key, distinct, populated: filled.length, len, sample: String(filled[0]) };
    if (filled.length < members.length) partial.push(entry);
    else if (distinct === 1) identical.push(entry);
    else if (distinct === members.length) perProfile.push(entry);
    else partial.push(entry);
  }

  identical.sort((a, b) => b.len - a.len);

  console.log("  IDENTICAL across all memberships (candidates, longest first)");
  console.log("  column                              len  sample");
  console.log("  ----------------------------------  ---  ------------------------------");
  for (const e of identical) {
    const flag = e.len <= 4 ? "  <- too short, likely a flag" : "";
    console.log(`  ${e.key.padEnd(34)}  ${String(e.len).padStart(3)}  ${e.sample.slice(0, 30)}${flag}`);
  }

  console.log(`\n  UNIQUE PER PROFILE (unusable as conversation identity): ${perProfile.length}`);
  console.log("  " + perProfile.map((e) => e.key).join(", "));

  if (partial.length) {
    console.log(`\n  PARTIALLY POPULATED OR MIXED: ${partial.length}`);
    for (const e of partial) {
      console.log(`  ${e.key.padEnd(34)}  ${e.populated}/${members.length} populated, ${e.distinct} distinct`);
    }
  }
  console.log("");
}
