#!/usr/bin/env node
/**
 * Fail when a workflow or composite action reintroduces the bot PAT or a
 * secrets fallback.
 *
 * Scans every workflow yml/yaml file and every composite action.yml / action.yaml.
 * Case-insensitive:
 *   secrets.MYTHOS_BOT_TOKEN
 *   secrets['MYTHOS_BOT_TOKEN'] / secrets["MYTHOS_BOT_TOKEN"]
 *   || secrets.   or   || secrets[
 *
 * Run: node .github/scripts/no-bot-token.js [root]
 * Exit 0 when clean, 1 when a pattern matches, 2 when root is not a directory.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  {
    id: 'mythos-bot-token-dot',
    source: String.raw`secrets\.MYTHOS_BOT_TOKEN\b`,
  },
  {
    id: 'mythos-bot-token-bracket',
    source: String.raw`secrets\[\s*(['"])MYTHOS_BOT_TOKEN\1\s*\]`,
  },
  {
    id: 'secrets-fallback',
    source: String.raw`\|\|\s*secrets[.\[]`,
  },
];

function listTargets(root) {
  const files = [];
  const workflows = path.join(root, '.github', 'workflows');
  if (isDir(workflows)) {
    for (const name of fs.readdirSync(workflows)) {
      if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
      const full = path.join(workflows, name);
      if (isFile(full)) files.push(full);
    }
  }
  const actions = path.join(root, '.github', 'actions');
  if (isDir(actions)) walkActions(actions, files);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function walkActions(dir, files) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkActions(full, files);
    else if (ent.isFile() && (ent.name === 'action.yml' || ent.name === 'action.yaml')) files.push(full);
  }
}

function isDir(full) {
  return fs.existsSync(full) && fs.statSync(full).isDirectory();
}

function isFile(full) {
  return fs.existsSync(full) && fs.statSync(full).isFile();
}

function toRel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function findingsInText(relPath, text) {
  const findings = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.source, 'gi');
    for (const match of text.matchAll(re)) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({
        file: relPath,
        line,
        rule: rule.id,
        match: match[0].replace(/\s+/g, ' '),
      });
    }
  }
  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

function formatFinding(finding) {
  return `no-bot-token: ${finding.file}:${finding.line}: ${finding.rule}: ${finding.match}`;
}

function scanRoot(root) {
  const findings = [];
  const files = listTargets(root);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    findings.push(...findingsInText(toRel(root, file), text));
  }
  return { files, findings };
}

function main(argv = process.argv.slice(2)) {
  const root = path.resolve(argv[0] || process.cwd());
  if (!isDir(root)) {
    console.error(`no-bot-token: not a directory: ${root}`);
    process.exit(2);
  }
  const { files, findings } = scanRoot(root);
  if (findings.length > 0) {
    for (const finding of findings) console.error(formatFinding(finding));
    process.exit(1);
  }
  console.log(`no-bot-token: clean (${files.length} files)`);
}

if (require.main === module) main();

module.exports = {
  RULES,
  findingsInText,
  formatFinding,
  listTargets,
  scanRoot,
};
