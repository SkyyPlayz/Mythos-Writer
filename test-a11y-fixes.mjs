import { _electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testAccessibilityFixes() {
  const electronApp = await _electron.launch({
    args: [
      path.join(__dirname, 'out/main/main.js'),
    ],
  });

  const window = await electronApp.firstWindow();
  
  // Wait longer for the app to fully initialize
  console.log('Waiting for app to load...');
  await new Promise(r => setTimeout(r, 2000));
  
  // Take a screenshot to debug what's on screen
  await window.screenshot({ path: 'app-screenshot.png' });
  console.log('Screenshot saved to app-screenshot.png');

  // Try to find any of the expected test IDs
  const hasOverlay = await window.locator('[data-testid="gs-overlay"]').count();
  const hasScreen = await window.locator('[data-testid^="screen-"]').count();
  console.log(`Found overlay: ${hasOverlay}, screens: ${hasScreen}`);

  // If overlay is there, proceed with tests
  if (hasOverlay > 0) {
    console.log('✓ Onboarding wizard loaded');

    // Test F-12: Verify Back button in step1b has aria-hidden span for arrow
    await window.click('[data-testid="card-template"]');
    await new Promise(r => setTimeout(r, 500));
    
    console.log('✓ Navigated to template picker (step1b)');

    // Check that the Back button exists and has the aria-hidden span
    const backButtonAriaHidden = await window.locator('button.btn-back span[aria-hidden="true"]').count();
    console.log(`✓ Back button aria-hidden spans found: ${backButtonAriaHidden}`);

    if (backButtonAriaHidden > 0) {
      console.log('✓ F-12 PASS: Back button has aria-hidden span for arrow character');
    } else {
      console.log('✗ F-12 FAIL: Back button does not have aria-hidden span');
    }

    // Test F-14: Verify focus is restored when returning from template-picker
    await window.click('[data-testid="gs-back-step1b"]');
    await new Promise(r => setTimeout(r, 500));
    
    console.log('✓ Returned from template picker to step1');

    // Check if focus was restored to the "From Template" card
    const focusedElement = await window.evaluate(() => {
      return document.activeElement?.getAttribute('data-testid');
    });
    
    console.log(`✓ Focused element after back: ${focusedElement}`);
    
    if (focusedElement === 'card-template') {
      console.log('✓ F-14 PASS: Focus restored to "From Template" card');
    } else {
      console.log('✗ F-14 FAIL: Focus not restored to the trigger card (found: ' + focusedElement + ')');
    }

    // Test: Check all Back buttons in wizard have aria-hidden
    await window.click('[data-testid="card-blank"]');
    await new Promise(r => setTimeout(r, 500));
    
    const step2BackAriaHidden = await window.locator('[data-testid="gs-back-step2"] span[aria-hidden="true"]').count();
    console.log(`✓ Step2 Back button aria-hidden spans: ${step2BackAriaHidden}`);
    
    if (step2BackAriaHidden > 0) {
      console.log('✓ All Back buttons use aria-hidden for arrow glyphs');
    }
  } else {
    console.log('⚠ Could not find onboarding wizard. App may still be initializing.');
  }

  // Clean up
  await electronApp.close();
  console.log('\n✓ Test completed');
}

testAccessibilityFixes().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
