#!/usr/bin/env node
// SKY-10918: mechanical check for the reachability standard (COMPANY-STANDARDS.md §4c).
//
// Rule (a) — never-passed optional callback props: for every component, collect
// optional function-typed props from its props type, then scan every JSX call
// site in production source. A prop no caller ever passes is dead wiring.
//
// Rule (b) — permanently-disabled controls: disabled={!someProp} /
// disabled={someProp === undefined} where someProp is one of the dead props
// found above can never evaluate to "enabled" — flagged as a bug by definition.
//
// Heuristics (documented, not hidden): props types are resolved within the
// same file as their component (the dominant pattern in this codebase); a
// call site using JSX spread ({...rest}) makes that component's evidence
// unreliable, so components with any spread call site are skipped entirely
// rather than risk a false positive. A component with zero non-spread JSX
// call sites in production source is skipped too (nothing to assert against).
// A prop declaration with a `dead-wiring-ignore` comment is exempt — the
// standard's explicit allow-hatch for genuine future hooks.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const IGNORE_MARKER = 'dead-wiring-ignore';
const TEST_FILE_RE = /\.(test|spec)\.(tsx?|jsx?)$/;
const SOURCE_FILE_RE = /\.(tsx?|jsx?)$/;

const BASELINE_PATH = path.join(__dirname, 'dead-wiring-baseline.json');

function parseArgs(argv) {
  const args = {
    src: path.join(REPO_ROOT, 'frontend', 'src'),
    reportOnly: false,
    noBaseline: false,
    updateBaseline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') args.src = path.resolve(argv[++i]);
    else if (argv[i] === '--report-only') args.reportOnly = true;
    else if (argv[i] === '--no-baseline') args.noBaseline = true;
    else if (argv[i] === '--update-baseline') args.updateBaseline = true;
  }
  return args;
}

function findingKey(f) {
  return `${f.file}::${f.component}.${f.prop}`;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return new Set();
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  return new Set(raw.entries || []);
}

function saveBaseline(keys) {
  const entries = Array.from(keys).sort();
  const payload = {
    _comment:
      'Pre-existing never-passed optional callback props, tracked at introduction of ' +
      'the rule-3a check (SKY-10918). NOT a suppression forever — each entry needs a ' +
      'fix or a real future-hook allow-comment, tracked on SKY-10923 (ManuscriptView/StoryNavigator) or SKY-10926 (everything else). Regenerate with ' +
      '`node scripts/check-dead-wiring.mjs --update-baseline` after fixing an entry so ' +
      'it drops out and a regression on it fails CI again.',
    entries,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
}

function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__fixtures__') continue;
      out.push(...collectFiles(full));
      continue;
    }
    if (!SOURCE_FILE_RE.test(entry.name)) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    out.push(full);
  }
  return out;
}

function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const scriptKind = file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
}

function isFunctionTypeNode(typeNode) {
  if (!typeNode) return false;
  if (ts.isFunctionTypeNode(typeNode)) return true;
  if (ts.isUnionTypeNode(typeNode)) return typeNode.types.some(isFunctionTypeNode);
  if (ts.isParenthesizedTypeNode(typeNode)) return isFunctionTypeNode(typeNode.type);
  return false;
}

function hasIgnoreComment(sourceFile, node) {
  const fullText = sourceFile.text;
  const ranges = [
    ...(ts.getLeadingCommentRanges(fullText, node.getFullStart()) || []),
    ...(ts.getTrailingCommentRanges(fullText, node.getEnd()) || []),
  ];
  return ranges.some((r) => fullText.slice(r.pos, r.end).includes(IGNORE_MARKER));
}

function lineOf(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function membersToProps(sourceFile, members) {
  const props = new Map();
  for (const m of members) {
    if (!ts.isPropertySignature(m) || !m.name || !ts.isIdentifier(m.name)) continue;
    if (!m.questionToken) continue; // only optional props are candidates
    if (!isFunctionTypeNode(m.type)) continue; // only callback-shaped props
    props.set(m.name.text, {
      node: m,
      line: lineOf(sourceFile, m.getStart()),
      ignored: hasIgnoreComment(sourceFile, m),
    });
  }
  return props;
}

// --- Pass 1: per-file props types (interface Foo / type Foo = {...}) ---
function collectPropsTypes(sourceFile) {
  const types = new Map(); // typeName -> Map<propName, info>
  ts.forEachChild(sourceFile, function visit(node) {
    if (ts.isInterfaceDeclaration(node) && /Props$/.test(node.name.text)) {
      types.set(node.name.text, membersToProps(sourceFile, node.members));
    } else if (
      ts.isTypeAliasDeclaration(node) &&
      /Props$/.test(node.name.text) &&
      ts.isTypeLiteralNode(node.type)
    ) {
      types.set(node.name.text, membersToProps(sourceFile, node.type.members));
    }
    ts.forEachChild(node, visit);
  });
  return types;
}

function typeRefName(typeNode) {
  if (!typeNode) return null;
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    return typeNode.typeName.text;
  }
  return null;
}

// Resolve the props-bearing param of a function/arrow, and (if it's an inline
// object type literal) its members directly, or (if a type reference) its name.
function resolveParamProps(fn, sourceFile) {
  const param = fn.parameters && fn.parameters[0];
  if (!param) return null;
  if (param.type && ts.isTypeLiteralNode(param.type)) {
    return { inline: membersToProps(sourceFile, param.type.members) };
  }
  const refName = typeRefName(param.type);
  if (refName) return { typeName: refName };
  return null;
}

// Unwrap `React.FC<XProps>` / `FC<XProps>` variable type annotations.
function fcGenericPropsName(typeNode) {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return null;
  const name = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName.text
    : ts.isQualifiedName(typeNode.typeName)
      ? typeNode.typeName.right.text
      : null;
  if (name !== 'FC' && name !== 'FunctionComponent') return null;
  const arg = typeNode.typeArguments && typeNode.typeArguments[0];
  return typeRefName(arg);
}

function unwrapCallWrapper(expr) {
  // React.memo(fn) / memo(fn) / React.forwardRef(fn) / forwardRef(fn) -> fn
  if (expr && ts.isCallExpression(expr) && expr.arguments.length > 0) {
    const callee = expr.expression;
    const calleeName = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null;
    if (calleeName === 'memo' || calleeName === 'forwardRef') {
      return unwrapCallWrapper(expr.arguments[0]);
    }
  }
  return expr;
}

// --- Pass: components declared in a file -> { name, propsSource } ---
function collectComponents(sourceFile, propsTypesInFile) {
  const components = []; // { name, propsSource: {typeName}|{inline} }

  function fromFn(name, fn) {
    if (!name || !/^[A-Z]/.test(name)) return;
    if (!fn.parameters || fn.parameters.length === 0) return;
    const propsSource = resolveParamProps(fn, sourceFile);
    if (propsSource) components.push({ name, propsSource });
  }

  ts.forEachChild(sourceFile, function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      fromFn(node.name.text, node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrapCallWrapper(node.initializer);
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        const fcProps = fcGenericPropsName(node.type);
        if (fcProps && /^[A-Z]/.test(node.name.text)) {
          components.push({ name: node.name.text, propsSource: { typeName: fcProps } });
        } else {
          fromFn(node.name.text, init);
        }
      }
    }
    ts.forEachChild(node, visit);
  });

  return components.map((c) => {
    if (c.propsSource.inline) return { name: c.name, props: c.propsSource.inline };
    const props = propsTypesInFile.get(c.propsSource.typeName) || null;
    return { name: c.name, props };
  });
}

// --- JSX call-site evidence across production source ---
function collectJsxEvidence(sourceFile, evidence) {
  ts.forEachChild(sourceFile, function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      const tagName = ts.isIdentifier(tag) ? tag.text : null;
      if (tagName && /^[A-Z]/.test(tagName)) {
        let entry = evidence.get(tagName);
        if (!entry) {
          entry = { passedAttrs: new Set(), hasSpread: false, callSites: 0 };
          evidence.set(tagName, entry);
        }
        entry.callSites++;
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name)) {
            entry.passedAttrs.add(attr.name.text);
          } else if (ts.isJsxSpreadAttribute(attr)) {
            entry.hasSpread = true;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  });
}

// --- disabled={!prop} / disabled={prop === undefined} scan, restricted to a set of dead prop names ---
function findDisabledOnDeadProps(sourceFile, deadPropNames) {
  const hits = [];
  function identName(expr) {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
    return null;
  }
  ts.forEachChild(sourceFile, function visit(node) {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'disabled') {
      const init = node.initializer;
      if (init && ts.isJsxExpression(init) && init.expression) {
        const expr = init.expression;
        let name = null;
        if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
          name = identName(expr.operand);
        } else if (ts.isBinaryExpression(expr)) {
          const isEqUndefined = (a, b) =>
            b.kind === ts.SyntaxKind.UndefinedKeyword ||
            (ts.isIdentifier(b) && b.text === 'undefined');
          if (
            (expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
              expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
            (isEqUndefined(expr.left, expr.right) || isEqUndefined(expr.right, expr.left))
          ) {
            name = identName(isEqUndefined(expr.left, expr.right) ? expr.left : expr.right);
          }
        }
        if (name && deadPropNames.has(name)) {
          hits.push({ propName: name, line: lineOf(sourceFile, node.getStart()) });
        }
      }
    }
    ts.forEachChild(node, visit);
  });
  return hits;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.src)) {
    console.error(`check-dead-wiring: source dir not found: ${args.src}`);
    process.exit(2);
  }

  const allFiles = collectFiles(args.src);
  const prodFiles = allFiles.filter((f) => !TEST_FILE_RE.test(f));

  const parsed = new Map(prodFiles.map((f) => [f, parseFile(f)]));

  // Components + their resolvable optional callback props, per production file.
  const fileComponents = new Map(); // file -> [{name, props: Map|null}]
  for (const [file, sourceFile] of parsed) {
    const propsTypesInFile = collectPropsTypes(sourceFile);
    fileComponents.set(file, collectComponents(sourceFile, propsTypesInFile));
  }

  // JSX evidence across ALL production files (a component defined in file A can
  // be called from file B).
  const evidence = new Map();
  for (const sourceFile of parsed.values()) collectJsxEvidence(sourceFile, evidence);

  const deadPropFindings = [];
  const disabledFindings = [];

  for (const [file, components] of fileComponents) {
    const sourceFile = parsed.get(file);
    const relFile = path.relative(REPO_ROOT, file);

    for (const comp of components) {
      if (!comp.props || comp.props.size === 0) continue;
      const ev = evidence.get(comp.name);
      if (!ev || ev.callSites === 0) continue; // never used as JSX in prod source — out of scope
      if (ev.hasSpread) continue; // spread call site: evidence unreliable, skip to avoid false positives

      const deadNames = new Set();
      for (const [propName, info] of comp.props) {
        if (info.ignored) continue;
        if (ev.passedAttrs.has(propName)) continue;
        deadPropFindings.push({
          file: relFile,
          line: info.line,
          component: comp.name,
          prop: propName,
        });
        deadNames.add(propName);
      }
      if (deadNames.size > 0) {
        for (const hit of findDisabledOnDeadProps(sourceFile, deadNames)) {
          disabledFindings.push({ file: relFile, line: hit.line, component: comp.name, prop: hit.propName });
        }
      }
    }
  }

  deadPropFindings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  disabledFindings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (args.updateBaseline) {
    saveBaseline(new Set(deadPropFindings.map(findingKey)));
    console.log(`Wrote ${deadPropFindings.length} entries to ${path.relative(REPO_ROOT, BASELINE_PATH)}.`);
    return;
  }

  const baseline = args.noBaseline ? new Set() : loadBaseline();
  const newDeadProps = deadPropFindings.filter((f) => !baseline.has(findingKey(f)));
  const baselinedDeadProps = deadPropFindings.filter((f) => baseline.has(findingKey(f)));
  const newDisabled = disabledFindings.filter((f) => !baseline.has(findingKey(f)));
  const baselinedDisabled = disabledFindings.filter((f) => baseline.has(findingKey(f)));

  console.log('--- check-dead-wiring (SKY-10918 reachability standard, rule 3a) ---');
  console.log(`Scanned ${prodFiles.length} production source file(s) under ${path.relative(REPO_ROOT, args.src)}.`);
  console.log(
    `Total: ${deadPropFindings.length} never-passed optional callback prop(s), ${disabledFindings.length} permanently-disabled control(s).`
  );
  console.log('');

  if (newDeadProps.length === 0) {
    console.log('No NEW never-passed optional callback props (beyond the tracked baseline).');
  } else {
    console.log(`${newDeadProps.length} NEW never-passed optional callback prop(s) — this fails the build:`);
    for (const f of newDeadProps) {
      console.log(`  ${f.file}:${f.line}  ${f.component}.${f.prop} — declared optional, never passed by any JSX caller`);
    }
  }
  if (baselinedDeadProps.length > 0) {
    console.log(
      `(${baselinedDeadProps.length} more are pre-existing, tracked in the baseline — see SKY-10923 (ManuscriptView/StoryNavigator) or SKY-10926 (everything else).)`
    );
  }
  console.log('');

  if (newDisabled.length === 0) {
    console.log('No NEW permanently-disabled controls (beyond the tracked baseline).');
  } else {
    console.log(`${newDisabled.length} NEW permanently-disabled control(s) — this fails the build:`);
    for (const f of newDisabled) {
      console.log(`  ${f.file}:${f.line}  ${f.component} — disabled on dead prop "${f.prop}", can never be enabled`);
    }
  }
  if (baselinedDisabled.length > 0) {
    console.log(
      `(${baselinedDisabled.length} more are pre-existing, tracked in the baseline — see SKY-10923 (ManuscriptView/StoryNavigator) or SKY-10926 (everything else).)`
    );
  }
  console.log('');
  console.log(
    `Suppress a genuine future hook with a "${IGNORE_MARKER}" comment on the prop declaration. ` +
      'Fixed a baselined entry? Re-run with --update-baseline so a regression on it fails CI again.'
  );

  const failing = newDeadProps.length > 0 || newDisabled.length > 0;
  if (failing && !args.reportOnly) {
    process.exitCode = 1;
  }
}

main();
