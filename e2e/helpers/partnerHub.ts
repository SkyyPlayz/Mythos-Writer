import { expect, type Page } from '@playwright/test';

/** PLAN-058 L7 (09:01): compact partner hub collapses coach tips until opened. */
export async function openPartnerWriterTips(page: Page): Promise<void> {
  const tips = page.getByTestId('ahp-writer-tips');
  if (await tips.isVisible({ timeout: 500 }).catch(() => false)) return;
  await page.getByTestId('ahp-open-writer-tips').click();
  await expect(tips).toBeVisible({ timeout: 8_000 });
}
