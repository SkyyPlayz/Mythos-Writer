#!/usr/bin/env node
// AST-check electron-main/src/artifacts for filesystem write APIs.
// artifactCleanup.ts may rename (trash move) and unlink/rm (guarded delete). Nothing else may write.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../electron-main/package.json'));
const ts = require('typescript');

const WRITE_NAMES = new Set([
  'writeFile',
  'writeFileSync',
  'createWriteStream',
  'rename',
  'renameSync',
  'copyFile',
  'copyFileSync',
  'appendFile',
  'appendFileSync',
  'rm',
  'rmSync',
  'unlink',
  'unlinkSync',
  'symlink',
  'symlinkSync',
]);

const CLEANUP_ALLOWED = new Set(['rename', 'renameSync', 'rm', 'rmSync', 'unlink', 'unlinkSync']);

function calleeName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function importedFromFs(sourceFile, name) {
  let found = false;
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (spec === 'fs' || spec === 'node:fs' || spec === 'fs-extra' || spec === 'fs/promises' || spec === 'node:fs/promises') {
        const clause = node.importClause;
        if (!clause) return;
        if (clause.name && clause.name.text === name) found = true;
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if ((el.propertyName ?? el.name).text === name || el.name.text === name) found = true;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

export function lintArtifactsFs(dir) {
  const hits = [];
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.includes('.test.'));
  for (const name of files) {
    const file = path.join(dir, name);
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const cleanup = name === 'artifactCleanup.ts';
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const called = calleeName(node.expression);
        if (called && WRITE_NAMES.has(called)) {
          const allowed = cleanup && CLEANUP_ALLOWED.has(called);
          const fsCall = ts.isPropertyAccessExpression(node.expression)
            || importedFromFs(source, called)
            || called === 'createWriteStream';
          if (fsCall && !allowed) {
            const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
            hits.push(`${path.basename(file)}:${pos.line + 1} ${called}`);
          }
        }
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'fs-extra') {
        const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
        hits.push(`${path.basename(file)}:${pos.line + 1} fs-extra`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hits;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../electron-main/src/artifacts');
  const hits = lintArtifactsFs(dir);
  if (hits.length > 0) {
    console.error(hits.join('\n'));
    process.exit(1);
  }
}
