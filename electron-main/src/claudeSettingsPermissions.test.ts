import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

type Outcome = 'deny' | 'ask' | 'allow';

type SettingsFile = {
  permissions: {
    allow?: readonly string[];
    deny?: readonly string[];
    ask?: readonly string[];
  };
};

const settingsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.claude/settings.json',
);
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as SettingsFile;

function bashPatterns(rules: readonly string[] | undefined): string[] {
  if (!rules) {
    return [];
  }
  return rules
    .filter((rule) => rule.startsWith('Bash(') && rule.endsWith(')'))
    .map((rule) => rule.slice('Bash('.length, -1));
}

const allowPatterns = bashPatterns(settings.permissions.allow);
const denyPatterns = bashPatterns(settings.permissions.deny);
const askPatterns = bashPatterns(settings.permissions.ask);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Claude Code Bash match, from the permissions doc.
 * A rule with no `*` is exact. A single trailing ` *` also matches the bare
 * command. The space is literal, so `ls *` does not match `lsof` and
 * `gh pr create --draft *` does not match `gh pr create --draft=no`.
 */
function matchesBash(pattern: string, command: string): boolean {
  if (!pattern.includes('*')) {
    return pattern === command;
  }
  const starCount = pattern.split('*').length - 1;
  if (pattern.endsWith(' *') && starCount === 1) {
    const base = pattern.slice(0, -2);
    return command === base || command.startsWith(`${base} `);
  }
  const parts = pattern.split('*').map((part) => escapeRegex(part));
  return new RegExp(`^${parts.join('.*')}$`).test(command);
}

function outcome(command: string): Outcome {
  for (const pattern of denyPatterns) {
    if (matchesBash(pattern, command)) {
      return 'deny';
    }
  }
  for (const pattern of askPatterns) {
    if (matchesBash(pattern, command)) {
      return 'ask';
    }
  }
  for (const pattern of allowPatterns) {
    if (matchesBash(pattern, command)) {
      return 'allow';
    }
  }
  return 'ask';
}

const FLAG_OVERRIDE_CASES = [
  'git commit -m x --no-verify',
  'git commit -m x -n',
  'git commit -m x --no-gpg-sign',
  'npm test --prefix ../other',
  'npm test --userconfig /tmp/npmrc',
  'npm run test --prefix ../other',
  'npm run build --prefix ../other',
  'npm run lint --prefix ../other',
  'npm run typecheck --prefix ../other',
  'git add -f /etc/shadow',
  'gh pr create --draft --no-draft',
  'gh pr create --draft --draft=false --title x',
  'gh pr create --draft --draft false --title x',
  'gh pr create --draft -d=false --title x',
] as const;

const DRAFT_VALUE_CASES = [
  'gh pr create --draft=no',
  'gh pr create --draft=off',
  'gh pr create --draft=N',
  'gh pr create --draft --draft=no',
  'gh pr create --draft --draft=off',
  'gh pr create --draft --draft=N',
] as const;

const MUST_RUN = [
  'git status',
  'git diff',
  'git log',
  'git checkout -b claude/topic',
  'git switch claude/topic',
  'git push -u origin claude/topic',
  'git push origin claude/topic',
  'npm ci --ignore-scripts',
  'npm test',
  'npm run test',
  'npm run lint',
  'npm run typecheck',
  'npm run build',
  'npm run build:electron',
  'npx vitest run',
  'npx tsc --noEmit',
  'npx eslint .',
  'rg TODO',
  'gh pr create --draft',
  'gh pr checks 1775',
] as const;

const PROBE_CORPUS: ReadonlyArray<readonly [string, Outcome]> = [
  ['git commit -m x --no-verify', 'ask'],
  ['git commit -m x -n', 'ask'],
  ['git commit -m x --no-gpg-sign', 'ask'],
  ['npm test --prefix ../other', 'ask'],
  ['npm test --userconfig /tmp/npmrc', 'ask'],
  ['npm run test --prefix ../other', 'ask'],
  ['npm run build --prefix ../other', 'ask'],
  ['npm run lint --prefix ../other', 'ask'],
  ['npm run typecheck --prefix ../other', 'ask'],
  ['git add -f /etc/shadow', 'ask'],
  ['gh pr create --draft --no-draft', 'ask'],
  ['gh pr create --draft --draft=false --title x', 'deny'],
  ['gh pr create --draft --draft false --title x', 'deny'],
  ['gh pr create --draft -d=false --title x', 'deny'],
  ['gh pr create --draft=no', 'ask'],
  ['gh pr create --draft=off', 'ask'],
  ['gh pr create --draft=N', 'ask'],
  ['gh pr create --draft --draft=no', 'ask'],
  ['gh pr create --draft --draft=off', 'ask'],
  ['gh pr create --draft --draft=N', 'ask'],
  ['git status', 'allow'],
  ['git diff', 'allow'],
  ['git log', 'allow'],
  ['git checkout -b claude/topic', 'allow'],
  ['git switch claude/topic', 'allow'],
  ['git push -u origin claude/topic', 'allow'],
  ['git push origin claude/topic', 'allow'],
  ['npm ci --ignore-scripts', 'allow'],
  ['npm test', 'allow'],
  ['npm run test', 'allow'],
  ['npm run lint', 'allow'],
  ['npm run typecheck', 'allow'],
  ['npm run build', 'allow'],
  ['npm run build:electron', 'allow'],
  ['npx vitest run', 'allow'],
  ['npx tsc --noEmit', 'allow'],
  ['npx eslint .', 'allow'],
  ['rg TODO', 'allow'],
  ['gh pr create --draft', 'allow'],
  ['gh pr checks 1775', 'allow'],
  ['npm run build:installer --prefix ../other', 'ask'],
  ['npm run build:electron --prefix ../other', 'ask'],
  ['npm run test:fidelity-harness --prefix ../other', 'ask'],
  ['npm run test:e2e --prefix ../other', 'ask'],
  ['npm run test:e2e:smoke --prefix ../other', 'ask'],
  ['npm run test:e2e:packaged --prefix ../other', 'ask'],
  ['npm run test:e2e:obsidian-import-fidelity --prefix ../other', 'ask'],
  ['npm run test:e2e:vault-open-folder-guard --prefix ../other', 'ask'],
  ['npm run test:e2e:auto-update --prefix ../other', 'ask'],
  ['npm run test:e2e:crud --prefix ../other', 'ask'],
  ['npm run test:e2e:ivy-r6-vault-park-close --prefix ../other', 'ask'],
  ['npm run test:e2e:vault-rail-stable-order --prefix ../other', 'ask'],
  ['npm run test:e2e:archive-quickadd --prefix ../other', 'ask'],
  ['npm run test:e2e:timeline-rebuild --prefix ../other', 'ask'],
  ['npm run test:e2e:timeline-wikilinks --prefix ../other', 'ask'],
  ['npm run test:e2e:paragraph-editing --prefix ../other', 'ask'],
  ['npm run test:e2e:jobs-responsiveness --prefix ../other', 'ask'],
  ['npm run test:e2e:folder-ops --prefix ../other', 'ask'],
  ['npm run test:e2e:notes-drag --prefix ../other', 'ask'],
  ['npm run test:e2e:scene-notes-promote --prefix ../other', 'ask'],
  ['npm run test:e2e:seed-once --prefix ../other', 'ask'],
  ['npm run test:e2e:notes-unicode-names --prefix ../other', 'ask'],
  ['npm run test:e2e:draft-history --prefix ../other', 'ask'],
  ['npm run test:e2e:comments --prefix ../other', 'ask'],
  ['npm run test:e2e:brainstorm --prefix ../other', 'ask'],
  ['npm run test:e2e:coach-page --prefix ../other', 'ask'],
  ['npm run test:e2e:agent-hub-session-picker --prefix ../other', 'ask'],
  ['npm run test:e2e:nav-history --prefix ../other', 'ask'],
  ['npm run test:e2e:brainstorm-glass --prefix ../other', 'ask'],
  ['npm run test:e2e:liquid-neon-views --prefix ../other', 'ask'],
  ['npm run test:e2e:brainstorm-sidebar-slot --prefix ../other', 'ask'],
  ['npm run test:e2e:lmp --prefix ../other', 'ask'],
  ['npm run test:e2e:visual-capture --prefix ../other', 'ask'],
  ['npm run test:e2e:writing-modes --prefix ../other', 'ask'],
  ['npm run test:e2e:depth-slider --prefix ../other', 'ask'],
  ['npm run test:e2e:writing-assistant-tips --prefix ../other', 'ask'],
  ['npm run test:e2e:title-bar-undo-redo --prefix ../other', 'ask'],
  ['npm run test:e2e:two-vault --prefix ../other', 'ask'],
  ['npm run test:e2e:notes-vault-registry --prefix ../other', 'ask'],
  ['npm run test:e2e:story-vault-registry --prefix ../other', 'ask'],
  ['npm run test:e2e:story-vault-picker --prefix ../other', 'ask'],
  ['npm run test:e2e:vault-create-primitive --prefix ../other', 'ask'],
  ['npm run test:e2e:notes-vault-swap-windows --prefix ../other', 'ask'],
  ['npm run test:e2e:two-vault-firstrun --prefix ../other', 'ask'],
  ['npm run test:e2e:delete-scene-chapter --prefix ../other', 'ask'],
  ['npm run test:e2e:nav-rail-vault-tiles --prefix ../other', 'ask'],
  ['npm run test:e2e:onboarding-four-paths --prefix ../other', 'ask'],
  ['npm run test:e2e:move-vault --prefix ../other', 'ask'],
  ['npm run test:e2e:export --prefix ../other', 'ask'],
  ['npm run test:e2e:versioned-drafts --prefix ../other', 'ask'],
  ['npm run test:e2e:visual-regression --prefix ../other', 'ask'],
  ['npm run test:e2e:vault-routing --prefix ../other', 'ask'],
  ['npm run test:e2e:a11y --prefix ../other', 'ask'],
  ['npm run test:e2e:entity --prefix ../other', 'ask'],
  ['npm run test:e2e:vault-graph --prefix ../other', 'ask'],
  ['npm run test:e2e:vault-graph-v0 --prefix ../other', 'ask'],
  ['npm run test:e2e:entity-mention --prefix ../other', 'ask'],
  ['npm run test:e2e:entity-creation --prefix ../other', 'ask'],
  ['npm run test:e2e:timeline --prefix ../other', 'ask'],
  ['npm run test:e2e:entries --prefix ../other', 'ask'],
  ['npm run test:e2e:post-onboarding --prefix ../other', 'ask'],
  ['npm run test:e2e:continuity-panel --prefix ../other', 'ask'],
  ['npm run test:e2e:continuity-peek --prefix ../other', 'ask'],
  ['npm run test:e2e:scene-crafter --prefix ../other', 'ask'],
  ['npm run test:e2e:scene-crafter-ai-off --prefix ../other', 'ask'],
  ['npm run test:e2e:ai-precedence --prefix ../other', 'ask'],
  ['npm run test:e2e:comments-ai-off --prefix ../other', 'ask'],
  ['npm run test:e2e:timeline-ai-off --prefix ../other', 'ask'],
  ['npm run test:e2e:ai-off-network-silence --prefix ../other', 'ask'],
  ['npm run test:e2e:ai-off-walkthrough --prefix ../other', 'ask'],
  ['npm run test:e2e:ai-off-persistence --prefix ../other', 'ask'],
  ['npm run test:e2e:writing-assistant --prefix ../other', 'ask'],
  ['npm run test:e2e:beta-reader-consolidation --prefix ../other', 'ask'],
  ['npm run test:e2e:production-roles --prefix ../other', 'ask'],
  ['npm run test:e2e:beta-report-reasoning-parser --prefix ../other', 'ask'],
  ['npm run test:e2e:outline --prefix ../other', 'ask'],
  ['npm run test:e2e:settings-background --prefix ../other', 'ask'],
  ['npm run test:e2e:editor-format-bar --prefix ../other', 'ask'],
  ['npm run test:e2e:editor-page-chrome --prefix ../other', 'ask'],
  ['npm run test:e2e:notes-parity --prefix ../other', 'ask'],
  ['npm run test:e2e:wiki-link-autocomplete --prefix ../other', 'ask'],
  ['npm run test:e2e:mythos-migration --prefix ../other', 'ask'],
  ['npm run test:e2e:windows-vault-delete-lifecycle --prefix ../other', 'ask'],
  ['npm run test:e2e:windows-vault-migration-lifecycle --prefix ../other', 'ask'],
  ['npm run test:e2e:windows-quit-teardown --prefix ../other', 'ask'],
  ['npm run test:e2e:archive-agent-mvp --prefix ../other', 'ask'],
  ['npm run test:e2e:bg-scrim-slider --prefix ../other', 'ask'],
  ['npm run test:e2e:cross-tab-links --prefix ../other', 'ask'],
  ['npm run test:e2e:notes-tab --prefix ../other', 'ask'],
  ['npm run test:e2e:per-vault-tabs --prefix ../other', 'ask'],
  ['npm run test:e2e:readme-screenshots --prefix ../other', 'ask'],
  ['npm run test:e2e:shell-relayout-regression --prefix ../other', 'ask'],
  ['npm run test:e2e:sky-9022-m6-sidebars --prefix ../other', 'ask'],
  ['npm run test:e2e:story-tab-subview --prefix ../other', 'ask'],
  ['npm run test:e2e:suggestions --prefix ../other', 'ask'],
  ['npm run test:e2e:tab-shell --prefix ../other', 'ask'],
  ['npm run test:e2e:auto-linker --prefix ../other', 'ask'],
  ['npm run test:e2e:global-search --prefix ../other', 'ask'],
  ['npm run test:e2e:word-count --prefix ../other', 'ask'],
  ['npm run test:e2e:wiki-links --prefix ../other', 'ask'],
  ['npm run test:e2e:accessibility-fixes-sky1362 --prefix ../other', 'ask'],
  ['npm run test:e2e:theme-export-import --prefix ../other', 'ask'],
  ['npm run test:e2e:wallpaper-picker --prefix ../other', 'ask'],
  ['npm run test:e2e:beta-read --prefix ../other', 'ask'],
  ['npm run test:e2e:custom-template-lifecycle --prefix ../other', 'ask'],
  ['npm run test:e2e:brainstorm-wave33 --prefix ../other', 'ask'],
  ['npm run test:e2e:note-template-picker-oncreated --prefix ../other', 'ask'],
  ['npm run test:e2e:icons --prefix ../other', 'ask'],
  ['npm run test:e2e:keyboard-shortcuts --prefix ../other', 'ask'],
  ['npm run test:e2e:panel-system-wave2f --prefix ../other', 'ask'],
  ['npm run test:e2e:proposal-card-hover --prefix ../other', 'ask'],
  ['npm run test:e2e:provider-settings --prefix ../other', 'ask'],
  ['npm run test:e2e:settings-category-subnav --prefix ../other', 'ask'],
  ['npm run test:e2e:v1-vault-migration --prefix ../other', 'ask'],
  ['npm run test:e2e:voice-io --prefix ../other', 'ask'],
  ['npm run test:e2e:voice-real-binary --prefix ../other', 'ask'],
  ['npm run test:e2e:kokoro --prefix ../other', 'ask'],
  ['npm run test:e2e:inline-scene-rename --prefix ../other', 'ask'],
  ['npm run test:e2e:note-templates --prefix ../other', 'ask'],
  ['npm run test:e2e:scene-editor-empty-states --prefix ../other', 'ask'],
  ['npm run test:e2e:scene-quit-flush --prefix ../other', 'ask'],
  ['npm run test:e2e:split-pane-tab-strips --prefix ../other', 'ask'],
  ['npm run test:e2e:notes-split-pane-tab-strips --prefix ../other', 'ask'],
  ['npm run test:e2e:notes-board-canvas --prefix ../other', 'ask'],
  ['npm run test:e2e:board-vault-mutations --prefix ../other', 'ask'],
  ['npm run test:e2e:board-search-links-minimap --prefix ../other', 'ask'],
  ['npm run test:e2e:sky214-entity-screenshots --prefix ../other', 'ask'],
  ['npm run test:e2e:scene-save-perf --prefix ../other', 'ask'],
  ['npm run test:e2e:brainstorm-scene-append --prefix ../other', 'ask'],
  ['npm run test:e2e:m18-notes-right-panel --prefix ../other', 'ask'],
  ['npm run test:e2e:m19-scene-crafter-prose-invariant --prefix ../other', 'ask'],
  ['npm run test:e2e:m25-timeline-right-panel-archive --prefix ../other', 'ask'],
  ['npm run test:e2e:relationships-subway-a11y --prefix ../other', 'ask'],
  ['npm run test:e2e:perf-ui-runtime --prefix ../other', 'ask'],
  ['npm run lint:dead-wiring --prefix ../other', 'ask'],
  ['npm run test:oracle-sweeps --prefix ../other', 'ask'],
  ['npm run test --userconfig /tmp/npmrc', 'ask'],
  ['npm run build --userconfig /tmp/npmrc', 'ask'],
  ['npm run lint --userconfig /tmp/npmrc', 'ask'],
  ['npm run typecheck --userconfig /tmp/npmrc', 'ask'],
  ['git commit -m x', 'ask'],
  ['git commit --no-verify', 'ask'],
  ['git commit -n', 'ask'],
  ['git commit --no-gpg-sign', 'ask'],
  ['git add file', 'ask'],
  ['git add .', 'ask'],
  ['git add --force /etc/shadow', 'ask'],
  ['gh pr create --draft --title x', 'ask'],
  ['gh pr create --title x', 'ask'],
  ['npm test --watch', 'ask'],
  ['npm run test -- --grep x', 'ask'],
  ['npm --prefix ../other test', 'ask'],
  ['npm --userconfig /tmp/npmrc run test', 'ask'],
  ['npm --prefix ../other run build', 'ask'],
  ['gh pr create --draft --no-draft --title x', 'ask'],
  ['git commit -m x --no-verify --no-gpg-sign', 'ask'],
  ['git add -f -- file', 'ask'],
  ['git status -sb', 'allow'],
  ['git diff --stat', 'allow'],
  ['git log -1', 'allow'],
  ['git diff --output-indicator-new=+', 'allow'],
  ['git log --oneline', 'allow'],
  ['gh pr view 1775', 'allow'],
  ['npm run build:installer', 'allow'],
  ['npm run lint:dead-wiring', 'allow'],
  ['npm run test:e2e', 'allow'],
  ['npx tsc --pretty false', 'allow'],
  ['git switch -c claude/other', 'allow'],
  ['printenvprobe', 'deny'],
  ['env', 'deny'],
  ['env probe-arg', 'deny'],
  ['cat probe.envprobe', 'deny'],
  ['echo probeTOKENprobe', 'deny'],
  ['echo probeSECRETprobe', 'deny'],
  ['echo probeKEYprobe', 'deny'],
  ['echo probePATprobe', 'deny'],
  ['npm ci', 'deny'],
  ['npm ci --ignore-scripts=falseprobe', 'deny'],
  ['npm installprobe', 'deny'],
  ['npm i', 'deny'],
  ['npm i probe-arg', 'deny'],
  ['npm in', 'deny'],
  ['npm in probe-arg', 'deny'],
  ['npm ins', 'deny'],
  ['npm ins probe-arg', 'deny'],
  ['npm inst', 'deny'],
  ['npm inst probe-arg', 'deny'],
  ['npm insta', 'deny'],
  ['npm insta probe-arg', 'deny'],
  ['npm instal', 'deny'],
  ['npm instal probe-arg', 'deny'],
  ['npm isntall', 'deny'],
  ['npm isntall probe-arg', 'deny'],
  ['npm add', 'deny'],
  ['npm add probe-arg', 'deny'],
  ['npm it', 'deny'],
  ['npm it probe-arg', 'deny'],
  ['npm install-test', 'deny'],
  ['npm install-test probe-arg', 'deny'],
  ['npm clean-install', 'deny'],
  ['npm clean-install probe-arg', 'deny'],
  ['npm ic', 'deny'],
  ['npm ic probe-arg', 'deny'],
  ['npm install-clean', 'deny'],
  ['npm install-clean probe-arg', 'deny'],
  ['npm isntall-clean', 'deny'],
  ['npm isntall-clean probe-arg', 'deny'],
  ['npm cit', 'deny'],
  ['npm cit probe-arg', 'deny'],
  ['npm clean-install-test', 'deny'],
  ['npm clean-install-test probe-arg', 'deny'],
  ['npm install-ci-test', 'deny'],
  ['npm install-ci-test probe-arg', 'deny'],
  ['git -C probe-arg', 'deny'],
  ['bash -c probe-arg', 'deny'],
  ['sh -c probe-arg', 'deny'],
  ['gh api probe-arg', 'deny'],
  ['probe--draft=falseprobe', 'deny'],
  ['probe--draft=Falseprobe', 'deny'],
  ['probe--draft=FALSEprobe', 'deny'],
  ['probe--draft=fprobe', 'deny'],
  ['probe--draft=Fprobe', 'deny'],
  ['probe--draft=0probe', 'deny'],
  ['probe--draft falseprobe', 'deny'],
  ['probe--draft Falseprobe', 'deny'],
  ['probe--draft FALSEprobe', 'deny'],
  ['probe--draft fprobe', 'deny'],
  ['probe--draft Fprobe', 'deny'],
  ['probe--draft 0probe', 'deny'],
  ['gh pr createprobe-d=falseprobe', 'deny'],
  ['gh pr createprobe-d=Falseprobe', 'deny'],
  ['gh pr createprobe-d=FALSEprobe', 'deny'],
  ['gh pr createprobe-d=fprobe', 'deny'],
  ['gh pr createprobe-d=Fprobe', 'deny'],
  ['gh pr createprobe-d=0probe', 'deny'],
  ['gh pr createprobe-d falseprobe', 'deny'],
  ['gh pr createprobe-d Falseprobe', 'deny'],
  ['gh pr createprobe-d FALSEprobe', 'deny'],
  ['gh pr createprobe-d fprobe', 'deny'],
  ['gh pr createprobe-d Fprobe', 'deny'],
  ['gh pr createprobe-d 0probe', 'deny'],
  ['gh pr mergeprobe', 'deny'],
  ['gh pr readyprobe', 'deny'],
  ['git diffprobe--output=probe', 'deny'],
  ['git diffprobe--output probe', 'deny'],
  ['git logprobe--output=probe', 'deny'],
  ['git logprobe--output probe', 'deny'],
  ['git push', 'deny'],
  ['git push mainprobe', 'deny'],
  ['git push probe mainprobe', 'deny'],
  ['git push origin HEADprobe', 'deny'],
  ['git push -u origin HEADprobe', 'deny'],
  ['git push HEADprobe', 'deny'],
  ['git push probe:mainprobe', 'deny'],
  ['git push probe:refs/heads/mainprobe', 'deny'],
  ['git push proberefs/heads/mainprobe', 'deny'],
  ['git push probe+mainprobe', 'deny'],
  ['git push probeHEAD:mainprobe', 'deny'],
  ['git push probemasterprobe', 'deny'],
  ['git push proberefs/heads/masterprobe', 'deny'],
  ['git push probe:masterprobe', 'deny'],
  ['git push --forceprobe', 'deny'],
  ['git push -fprobe', 'deny'],
  ['git push probe --forceprobe', 'deny'],
  ['git push probe -fprobe', 'deny'],
  ['git push probe +probe', 'deny'],
  ['git reset --hardprobe', 'deny'],
  ['git commit --amendprobe', 'deny'],
  ['git commit probe --amendprobe', 'deny'],
];

const DOC_MATCH_CASES: ReadonlyArray<readonly [string, string, boolean]> = [
  ['ls *', 'ls', true],
  ['ls *', 'ls -la', true],
  ['ls *', 'lsof', false],
  ['ls*', 'lsof', true],
  ['npm run build', 'npm run build', true],
  ['npm run build', 'npm run build --watch', false],
  ['gh pr create --draft *', 'gh pr create --draft', true],
  ['gh pr create --draft *', 'gh pr create --draft --title x', true],
  ['gh pr create --draft *', 'gh pr create --draft=no', false],
  ['gh pr create --draft', 'gh pr create --draft', true],
  ['gh pr create --draft', 'gh pr create --draft=no', false],
  ['gh pr create --draft', 'gh pr create --draft --no-draft', false],
];

describe('claude settings bash permissions', () => {
  it.each(DOC_MATCH_CASES)('%s vs %s', (pattern, command, expected) => {
    expect(matchesBash(pattern, command)).toBe(expected);
  });

  it('keeps bare draft create and drops flag-undoable space-star allows', () => {
    expect(allowPatterns).toContain('gh pr create --draft');
    expect(allowPatterns).not.toContain('gh pr create --draft *');
    expect(allowPatterns).not.toContain('git add *');
    expect(allowPatterns).not.toContain('git commit *');
    expect(allowPatterns).not.toContain('npm test *');
    expect(allowPatterns.some((pattern) => pattern.startsWith('npm run ') && pattern.endsWith(' *'))).toBe(
      false,
    );
    expect(denyPatterns).toContain('*--draft=false*');
    expect(denyPatterns).toContain('*--draft false*');
    expect(denyPatterns).toContain('gh pr create*-d=false*');
    const denyText = denyPatterns.join('\n');
    expect(denyText).not.toContain('--draft=no');
    expect(denyText).not.toContain('--draft=off');
    expect(denyText).not.toContain('--draft=N');
    expect(denyText).not.toContain('--no-draft');
  });

  it('asks or denies every flag-override case', () => {
    expect(FLAG_OVERRIDE_CASES).toHaveLength(14);
    const allowed = FLAG_OVERRIDE_CASES.filter((command) => outcome(command) === 'allow');
    expect(allowed).toEqual([]);
  });

  it('asks for draft value spellings instead of denying them', () => {
    const got = DRAFT_VALUE_CASES.map((command) => [command, outcome(command)]);
    expect(got).toEqual(DRAFT_VALUE_CASES.map((command) => [command, 'ask']));
  });

  it('still allows the must-run commands', () => {
    expect(MUST_RUN).toHaveLength(20);
    const got = MUST_RUN.map((command) => [command, outcome(command)]);
    expect(got).toEqual(MUST_RUN.map((command) => [command, 'allow']));
  });

  it.each(PROBE_CORPUS)('%s -> %s', (command, expected) => {
    expect(outcome(command)).toBe(expected);
  });

  it('prints the 309-command summary', () => {
    expect(PROBE_CORPUS).toHaveLength(309);
    const counts: Record<Outcome, number> = { deny: 0, ask: 0, allow: 0 };
    for (const [command] of PROBE_CORPUS) {
      const got = outcome(command);
      counts[got] += 1;
    }
    const flagCommands = new Set<string>(FLAG_OVERRIDE_CASES);
    const draftCommands = new Set<string>(DRAFT_VALUE_CASES);
    const mustCommands = new Set<string>(MUST_RUN);
    for (const [command] of PROBE_CORPUS) {
      flagCommands.delete(command);
      draftCommands.delete(command);
      mustCommands.delete(command);
    }
    expect(flagCommands.size).toBe(0);
    expect(draftCommands.size).toBe(0);
    expect(mustCommands.size).toBe(0);
    console.log(
      `SUMMARY cases=${PROBE_CORPUS.length} deny=${counts.deny} ask=${counts.ask} allow=${counts.allow}`,
    );
  });
});
