import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/simulation-harness.html')
  await expect(page.getByTestId('status')).toHaveText('stale')
})

test('an equivalent document object does not cancel a manual capture', async ({ page }) => {
  await page.getByRole('button', { name: 'Capture', exact: true }).click()
  await expect(page.getByTestId('status')).toHaveText('calculating')
  await page.getByRole('button', { name: 'Equivalent document' }).click()
  await page.getByRole('button', { name: 'Complete' }).click()
  await expect(page.getByTestId('status')).toHaveText('ready')
  await expect(page.getByTestId('capture')).not.toHaveText('none')
})

test('a late result after an Auto-off edit cannot make the new document ready', async ({ page }) => {
  await page.getByRole('button', { name: 'Capture', exact: true }).click()
  await expect(page.getByTestId('status')).toHaveText('calculating')
  await page.getByRole('button', { name: 'Edit document' }).click()
  await expect(page.getByTestId('status')).toHaveText('stale')
  await page.getByRole('button', { name: 'Complete' }).click()
  await expect(page.getByTestId('status')).toHaveText('stale')
  await expect(page.getByTestId('capture')).toHaveText('none')
})

test('Auto-off keeps the latest solver error visible and Capture recovers', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle auto' }).click()
  await expect(page.getByTestId('status')).toHaveText('calculating')
  await page.getByRole('button', { name: 'Fail', exact: true }).click()
  await expect(page.getByTestId('status')).toHaveText('error')
  await page.getByRole('button', { name: 'Toggle auto' }).click()
  await expect(page.getByTestId('status')).toHaveText('error')
  await expect(page.getByTestId('error')).toContainText('Controlled solver failure')
  await page.getByRole('button', { name: 'Capture', exact: true }).click()
  await expect(page.getByTestId('status')).toHaveText('calculating')
  await page.getByRole('button', { name: 'Complete' }).click()
  await expect(page.getByTestId('status')).toHaveText('ready')
})

test('turning Auto off during a run does not leave a calculating state', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle auto' }).click()
  await expect(page.getByTestId('status')).toHaveText('calculating')
  await page.getByRole('button', { name: 'Toggle auto' }).click()
  await expect(page.getByTestId('status')).toHaveText('stale')
  await page.getByRole('button', { name: 'Complete' }).click()
  await expect(page.getByTestId('status')).toHaveText('stale')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByTestId('status')).toHaveText('calculating')
  await page.getByRole('button', { name: 'Complete' }).click()
  await expect(page.getByTestId('status')).toHaveText('ready')
})
