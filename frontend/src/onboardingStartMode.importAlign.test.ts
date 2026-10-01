/**
 * Critic r6 soft — renderer and main must persist the same import start-mode
 * value (`'import'`). RED if either side drifts back to `'import-obsidian'`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(process.cwd(), '..');
const CANONICAL = 'import';

describe('onboardingStartMode import alignment (Critic r6)', () => {
  it('renderer + main persist the same import start-mode (RED if either drifts)', () => {
    const flowSrc = readFileSync(
      resolve(ROOT, 'frontend/src/useCreateMythosVaultFlow.tsx'),
      'utf-8',
    );
    const mainSrc = readFileSync(resolve(ROOT, 'electron-main/src/main.ts'), 'utf-8');
    const ipcSrc = readFileSync(resolve(ROOT, 'electron-main/src/ipc.ts'), 'utf-8');
    const globalSrc = readFileSync(resolve(ROOT, 'frontend/src/global.d.ts'), 'utf-8');

    // Renderer writer (Welcome / create-mythos-vault flow).
    expect(flowSrc).toMatch(
      /mode === 'import' \|\| mode === 'restore' \? 'import'/,
    );
    expect(flowSrc).toContain(`onboardingStartMode: startMode`);
    expect(flowSrc).not.toContain('import-obsidian');

    // Main ONBOARDING_IMPORT_COMMIT writer.
    expect(mainSrc).toContain(`onboardingStartMode: '${CANONICAL}'`);
    expect(mainSrc).not.toMatch(/onboardingStartMode:\s*'import-obsidian'/);
    expect(mainSrc).toMatch(/startMode === 'import'/);
    expect(mainSrc).not.toMatch(/startMode === 'import-obsidian'/);

    // Shared type unions — both sides list `'import'`, not `'import-obsidian'`.
    expect(ipcSrc).toMatch(/onboardingStartMode\?:[^;]*'import'/);
    expect(ipcSrc).not.toContain("'import-obsidian'");
    expect(globalSrc).toMatch(/onboardingStartMode\?:[^;]*'import'/);
    expect(globalSrc).not.toContain("'import-obsidian'");
  });
});
