import fs from 'fs';
import path from 'path';

const WIZARD_FILE = './frontend/src/OnboardingWizard.tsx';

console.log('=== SKY-1362 Code Verification ===\n');

const content = fs.readFileSync(WIZARD_FILE, 'utf-8');

// F-12 Check: Verify all Back buttons have aria-hidden spans
console.log('F-12: Back button arrows wrapped in aria-hidden spans');
const ariaHiddenMatches = content.match(/<span aria-hidden="true">&#x2190;<\/span>/g);
if (ariaHiddenMatches && ariaHiddenMatches.length >= 2) {
  console.log(`✓ PASS: Found ${ariaHiddenMatches.length} aria-hidden arrow spans\n`);
} else {
  console.log(`✗ FAIL: Expected 2+ aria-hidden arrow spans, found ${ariaHiddenMatches?.length || 0}\n`);
}

// F-14 Check: Verify focus restoration code is in place
console.log('F-14: Focus restoration when returning from template-picker');

// Check for templateCardTriggerRef initialization
const hasRefInit = content.includes('const templateCardTriggerRef = useRef<HTMLElement | null>(null);');
console.log(`  - useRef initialized: ${hasRefInit ? '✓' : '✗'}`);

// Check for storing focus before navigation
const storesCurrentFocus = content.includes('templateCardTriggerRef.current = document.activeElement as HTMLElement;');
console.log(`  - Stores activeElement before nav: ${storesCurrentFocus ? '✓' : '✗'}`);

// Check for focus restoration in back button (updated pattern to match actual code)
const restoresFocus = content.includes('(el ?? trigger).focus()') || 
                      content.includes('templateCardTriggerRef.current?.focus()');
console.log(`  - Restores focus on back: ${restoresFocus ? '✓' : '✗'}`);

// Check for requestAnimationFrame usage
const usesRAF = content.includes('requestAnimationFrame(() => {') && 
                content.includes('templateCardTriggerRef.current');
console.log(`  - Uses requestAnimationFrame: ${usesRAF ? '✓' : '✗'}`);

if (hasRefInit && storesCurrentFocus && restoresFocus && usesRAF) {
  console.log('\n✓ PASS: Focus restoration code is in place\n');
} else {
  console.log('\n✗ FAIL: Focus restoration code incomplete\n');
}

// Additional verification: Check that ALL back buttons use aria-hidden
console.log('All Back buttons verification:');
const backButtonPattern = /<button[^>]*btn-back[^>]*>[\s\S]*?<\/button>/g;
const backButtons = content.match(backButtonPattern) || [];
console.log(`  - Found ${backButtons.length} back buttons in wizard`);

let allHaveAriaHidden = true;
backButtons.forEach((btn, idx) => {
  const hasAriaHidden = btn.includes('aria-hidden="true"');
  console.log(`    Back button ${idx + 1}: ${hasAriaHidden ? '✓' : '✗'}`);
  if (!hasAriaHidden) allHaveAriaHidden = false;
});

if (allHaveAriaHidden && backButtons.length >= 2) {
  console.log('\n✓ PASS: All back buttons have aria-hidden spans');
} else {
  console.log('\n✗ FAIL: Not all back buttons have aria-hidden spans');
}

// Summary
console.log('\n=== SUMMARY ===');
const allChecksPassed = ariaHiddenMatches && ariaHiddenMatches.length >= 2 && 
                        hasRefInit && storesCurrentFocus && restoresFocus && usesRAF &&
                        allHaveAriaHidden && backButtons.length >= 2;
if (allChecksPassed) {
  console.log('✓ All acceptance criteria verified in code');
} else {
  console.log('✗ Some checks failed');
}
