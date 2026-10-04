import { expect, test } from '@playwright/test'
import { examples } from '../../src/lib/circuit'

test('Pico application state follows scrubbing, expands values and clears on edits', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const circuit = structuredClone(examples.find(example => example.id === 'pico-console')!.document)
  circuit.pico!.source = `import time
count = 1
settings = {"gain": 2, "enabled": True}
samples = [10, 20]
time.sleep_ms(30)
count = 2
settings["gain"] = 4
samples.append(30)
time.sleep_ms(30)
del count
finished = True
time.sleep_ms(50)
`
  await page.addInitScript(document => localStorage.setItem('labor-playground.document.v1', JSON.stringify(document)), circuit)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  const inspector = page.getByRole('region', { name: 'Pico application state', exact: true })
  await expect(inspector).toBeVisible()
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await expect(page.getByLabel('Simulation status')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
  // The recording begins before main.py has assigned its globals; never show future values.
  await expect(inspector.locator('[data-variable="count"]')).toHaveCount(0)
  await expect(inspector.getByRole('button', { name: 'Previous variable change' })).toBeDisabled()
  await inspector.getByRole('button', { name: 'Next variable change' }).click()
  await expect(inspector.getByTestId('pico-variable-count')).toHaveText('1')
  await page.getByLabel('Recording time milliseconds').fill('20')
  await expect(inspector.locator('[data-variable="count"]')).toContainText('1')
  await inspector.getByRole('button', { name: 'Next variable change' }).click()
  await expect(inspector.getByTestId('pico-variable-count')).toHaveText('2')
  await expect(inspector.locator('[data-variable="count"]')).toHaveAttribute('data-changed', 'true')
  await expect(inspector.locator('[data-variable="count"]')).toContainText('Changed')
  await page.getByLabel('Recording time milliseconds').fill('50')
  await expect(inspector.locator('[data-variable="count"]')).toContainText('2')
  // From between changes, Previous first visits the current snapshot, then the prior one.
  await inspector.getByRole('button', { name: 'Previous variable change' }).click()
  await expect(inspector.getByTestId('pico-variable-count')).toHaveText('2')
  expect(Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeLessThan(50)
  await inspector.getByRole('button', { name: 'Previous variable change' }).click()
  await expect(inspector.getByTestId('pico-variable-count')).toHaveText('1')
  await page.getByLabel('Recording time milliseconds').fill('20')
  await expect(inspector.locator('[data-variable="count"]')).toContainText('1')
  await inspector.getByRole('button', { name: 'Expand settings', exact: true }).click()
  await expect(inspector).toContainText('gain')
  await inspector.screenshot({ path: testInfo.outputPath('pico-state-desktop.png') })
  await page.getByRole('button', { name: 'Recording end', exact: true }).click()
  await expect(inspector.locator('[data-variable="finished"]')).toContainText('True')
  await expect(inspector.locator('[data-variable="count"]')).not.toContainText('2')
  await expect(inspector.locator('[data-variable="count"]')).toContainText('Removed')
  await expect(inspector.getByRole('button', { name: 'Next variable change' })).toBeDisabled()
  await page.getByLabel('Filter Pico variables').fill('finished')
  await expect(inspector.locator('[data-variable="settings"]')).toHaveCount(0)
  await expect(inspector.locator('[data-variable="finished"]')).toBeVisible()
  await page.getByLabel('Filter Pico variables').fill('')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await inspector.screenshot({ path: testInfo.outputPath('pico-state-mobile.png') })
  await page.getByRole('tab', { name: 'Pico Code', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Pico main.py editor', exact: true })
  await editor.focus()
  await editor.press('Control+End')
  await page.keyboard.insertText('\n# edited source')
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  await expect(inspector.locator('[data-variable="finished"]')).toHaveCount(0)
  await expect(page.getByLabel('Recording timeline')).toBeDisabled()
  expect(errors).toEqual([])
})
