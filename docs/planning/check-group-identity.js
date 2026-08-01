/**
 * check-group-identity.js
 *
 * Answers one question: is there a field that is IDENTICAL across all profiles
 * that belong to the same SimpleX group? That field would be the conversation-level
 * identity the archive needs, above the per-membership group_id.
 *
 * Run in the folder holding the measurement database:
 *   node check-group-identity.js
 *   node check-group-identity.js --db ./db/bench
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

const rows = db.prepare(`
  SELECT
    g.group_id                                     AS groupId,
    g.user_id                                      AS userId,
    gp.display_name                                AS groupName,
    hex(gp.public_group_id)                        AS publicGroupId,
    hex(gp.group_link)                             AS groupLink,
    hex(g.via_group_link_uri_hash)                 AS linkHash,
    hex(g.via_group_link_uri)                      AS linkUri
  FROM groups g
  LEFT JOIN group_profiles gp ON gp.group_profile_id = g.group_profile_id
  ORDER BY gp.display_name, g.user_id
`).all();

if (!rows.length) { console.log("no groups in this database."); process.exit(0); }

// Group the memberships by group name, then count distinct values per candidate.
const byName = new Map();
for (const r of rows) {
  const k = r.groupName || "(unnamed)";
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(r);
}

const candidates = ["publicGroupId", "groupLink", "linkHash", "linkUri"];

for (const [name, members] of byName) {
  console.log(`group "${name}": ${members.length} memberships`);
  console.log(`  group_id values: ${members.map(m => m.groupId).join(", ")}`);
  console.log("");
  console.log("  candidate           distinct  populated  verdict");
  console.log("  ------------------  --------  ---------  -------------------------");
  for (const c of candidates) {
    const vals = members.map(m => m[c]);
    const populated = vals.filter(v => v !== null && v !== "").length;
    const distinct = new Set(vals.filter(v => v !== null && v !== "")).size;
    let verdict;
    if (populated === 0) verdict = "unusable, never populated";
    else if (populated < members.length) verdict = `partial, ${members.length - populated} empty`;
    else if (distinct === 1) verdict = "USABLE, identical for all";
    else if (distinct === members.length) verdict = "unusable, unique per profile";
    else verdict = `unclear, ${distinct} distinct values`;
    console.log(`  ${c.padEnd(18)}  ${String(distinct).padStart(8)}  ${String(populated).padStart(9)}  ${verdict}`);
  }
  console.log("");
  const sample = members[0];
  for (const c of candidates) {
    const v = sample[c];
    if (v) console.log(`  sample ${c}: ${String(v).slice(0, 48)}${String(v).length > 48 ? "..." : ""}`);
  }
  console.log("");
}
