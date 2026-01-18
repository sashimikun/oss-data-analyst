import { test, expect } from '@playwright/test';

test('verify github agent functionality', async ({ page }) => {
  // 1. Navigate to the app
  await page.goto('http://localhost:3000');

  // 2. Type the query
  const query = "How many open issues does agent-browser have?";
  await page.fill('textarea[name="message"]', query);

  // 3. Submit the query
  await page.click('button[aria-label="Submit"]');

  // 4. Wait for the response
  // The agent takes some time to run tools. We'll wait for a reasonable amount of time
  // and check for the final narrative or intermediate steps.
  // We look for the specific number we verified earlier (51) or the text "open issues".

  // Wait for the response to contain "51" or "open issues"
  // We increase timeout because the agent might take a while to explore and query.
  await expect(page.locator('body')).toContainText('51', { timeout: 60000 });
  await expect(page.locator('body')).toContainText('open issues', { timeout: 60000 });

  // Optional: Take a screenshot
  await page.screenshot({ path: 'verification-result.png' });
});
