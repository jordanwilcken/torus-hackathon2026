import { expect, type Locator, type Page } from '@playwright/test';

type WorkspaceTool = 'Run CPU work' | 'Compare scheduling';
const optionalTools: WorkspaceTool[] = ['Run CPU work', 'Compare scheduling'];

export function moreTools(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Demo flow', exact: true, includeHidden: true })
    .locator('summary').filter({ hasText: /^More tools$/ });
}

/** Open optional tools through the same disclosure a keyboard, mouse or touch user sees. */
export async function openWorkspaceTool(page: Page, tool: WorkspaceTool): Promise<void> {
  const link = page.getByRole('link', { name: tool, exact: true });
  if (!await link.isVisible()) await moreTools(page).click();
  await link.click();
}

export async function expectWorkspaceNavigation(page: Page): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Demo flow', exact: true, includeHidden: true });
  await expect(navigation.getByRole('link', { name: 'Live fleet', exact: true, includeHidden: true })).toBeVisible();
  await expect(moreTools(page)).toBeVisible();
  for (const name of optionalTools) {
    await expect(navigation.getByRole('link', { name, exact: true, includeHidden: true })).toBeHidden();
  }
  // The desktop modal keeps its background inert. Verify optional navigation before opening it.
  if (await page.locator('dialog:modal').count()) return;
  await moreTools(page).click();
  for (const name of optionalTools) {
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await moreTools(page).click();
}
