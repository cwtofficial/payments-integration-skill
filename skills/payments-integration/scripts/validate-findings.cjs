#!/usr/bin/env node
// Validate a payments audit findings file against report-schema.json, plus checks
// the schema can't express: severity ordering, unique IDs, and (with --root) that
// each cited file and line exists.
//
// Usage: node validate-findings.cjs <findings.json> [--root <repo-root>]
// Exit 0 when valid, 1 with a list of problems otherwise. No dependencies.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const PATTERN_ID = /^(AMT|CNF|WHK|IDM|LDG|PAY|REF|SUB|SEC|AUTHZ|OPS)-[0-9]+$/;
const TOP_KEYS = new Set(['project', 'summary', 'providers', 'money_paths', 'findings', 'open_questions', 'strengths']);
const FINDING_KEYS = new Set(['id', 'severity', 'title', 'pattern', 'location', 'what', 'scenario', 'fix', 'confidence']);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function validate(report, { root } = {}) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return ['report must be a JSON object'];
  }
  for (const key of Object.keys(report)) {
    if (!TOP_KEYS.has(key)) err(key, 'unknown top-level field');
  }
  if (!isNonEmptyString(report.project)) err('project', 'required non-empty string');
  if (!isNonEmptyString(report.summary)) err('summary', 'required non-empty string');

  if (!Array.isArray(report.money_paths)) {
    err('money_paths', 'required array');
  } else {
    if (report.money_paths.length === 0) err('money_paths', 'list at least one reviewed path');
    report.money_paths.forEach((p, i) => {
      if (!p || !isNonEmptyString(p.name)) err(`money_paths[${i}].name`, 'required non-empty string');
      if (!p || !isNonEmptyString(p.entry)) err(`money_paths[${i}].entry`, 'required non-empty string');
    });
  }

  for (const key of ['providers', 'open_questions', 'strengths']) {
    if (report[key] !== undefined && (!Array.isArray(report[key]) || !report[key].every((s) => typeof s === 'string'))) {
      err(key, 'must be an array of strings');
    }
  }

  if (!Array.isArray(report.findings)) {
    err('findings', 'required array (empty is allowed)');
    return errors;
  }

  const seenIds = new Set();
  let lastRank = 0;
  report.findings.forEach((f, i) => {
    const at = `findings[${i}]${f && f.id ? ` (${f.id})` : ''}`;
    if (!f || typeof f !== 'object') return err(at, 'must be an object');

    for (const key of Object.keys(f)) {
      if (!FINDING_KEYS.has(key)) err(at, `unknown field "${key}"`);
    }

    if (typeof f.id !== 'string' || !/^F-[0-9]+$/.test(f.id)) err(at, 'id must look like F-1');
    else if (seenIds.has(f.id)) err(at, 'duplicate id');
    else seenIds.add(f.id);

    const rank = SEVERITY_ORDER.indexOf(f.severity);
    if (rank === -1) {
      err(at, `severity must be one of ${SEVERITY_ORDER.join(', ')}`);
    } else {
      if (rank < lastRank) err(at, `ordered after a less severe finding; sort most severe first`);
      lastRank = Math.max(lastRank, rank);
    }

    if (!isNonEmptyString(f.title)) err(at, 'title required');
    else if (f.title.length > 120) err(at, 'title longer than 120 characters');
    for (const key of ['what', 'fix']) {
      if (!isNonEmptyString(f[key])) err(at, `${key} required`);
    }
    if (!isNonEmptyString(f.scenario) || f.scenario.trim().length < 20) {
      err(at, 'scenario required: concrete steps leading to a concrete loss (20+ characters)');
    }
    if (f.pattern !== undefined && !PATTERN_ID.test(f.pattern)) {
      err(at, 'pattern must be an ID from references/audit-checklist.md, e.g. WHK-1');
    }
    if (f.confidence !== undefined && !['confirmed', 'likely'].includes(f.confidence)) {
      err(at, 'confidence must be "confirmed" or "likely"');
    }

    const loc = f.location;
    if (!loc || typeof loc !== 'object') {
      err(at, 'location {file, line} required');
    } else {
      if (!isNonEmptyString(loc.file)) err(at, 'location.file required');
      if (!Number.isInteger(loc.line) || loc.line < 1) err(at, 'location.line must be a positive integer');
      if (loc.end_line !== undefined && (!Number.isInteger(loc.end_line) || loc.end_line < loc.line)) {
        err(at, 'location.end_line must be an integer >= line');
      }
      if (root && isNonEmptyString(loc.file) && Number.isInteger(loc.line)) {
        const full = path.resolve(root, loc.file);
        if (!fs.existsSync(full)) {
          err(at, `location.file not found under root: ${loc.file}`);
        } else {
          const lineCount = fs.readFileSync(full, 'utf8').split('\n').length;
          const last = loc.end_line || loc.line;
          if (last > lineCount) err(at, `line ${last} is past the end of ${loc.file} (${lineCount} lines)`);
        }
      }
    }
  });

  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root');
  const rootIdx = args.indexOf('--root');
  const root = rootIdx !== -1 ? args[rootIdx + 1] : undefined;
  if (!file) {
    console.error('usage: node validate-findings.cjs <findings.json> [--root <repo-root>]');
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`could not read ${file}: ${e.message}`);
    process.exit(1);
  }

  const errors = validate(report, { root });
  if (errors.length) {
    console.error(`${errors.length} problem(s) in ${file}:`);
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }
  const counts = SEVERITY_ORDER.map((s) => `${report.findings.filter((f) => f.severity === s).length} ${s}`).join(', ');
  console.log(`OK: ${report.findings.length} finding(s) (${counts}), ${report.money_paths.length} money path(s) reviewed.`);
}

if (require.main === module) main();

module.exports = { validate };
