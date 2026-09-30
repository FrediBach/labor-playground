import { expect, test } from '@playwright/test'

test('IC examples simulate in the browser and changing a timing capacitor changes the clock', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const examples = page.getByRole('combobox', { name: 'Load example' })
  for (const id of ['555-astable', '555-monostable', 'quad-buffer']) {
    await examples.selectOption(id)
    await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(page.locator('.diagnostic, .error-copy')).toHaveCount(0)
    if (id === 'quad-buffer') {
      await page.locator('[data-part="R2"]').focus()
      const resistance = page.getByRole('spinbutton', { name: 'Resistance', exact: true })
      await resistance.fill('200')
      await resistance.press('Tab')
      await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
      const output = page.getByRole('region', { name: 'Oscilloscope' }).getByRole('button', { name: 'CH2', exact: true }).locator('..').locator('.measurement')
      const peakToPeak = parseFloat(await output.innerText())
      expect(peakToPeak).toBeGreaterThan(9.9)
      expect(peakToPeak).toBeLessThan(10.1)
    }
    await page.locator('[data-part="U1"]').focus()
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('EDUCATIONAL MODEL')
    const notification = page.getByRole('button', { name: 'Dismiss notification', exact: true })
    if (await notification.isVisible()) await notification.click()
    if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: testInfo.outputPath(`${id}.png`), fullPage: true })
    }
  }

  await examples.selectOption('555-astable')
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  await page.locator('.scope-measurements > summary').click()
  const frequency = page.getByRole('table', { name: 'Channel measurements' }).getByRole('row', { name: /^Frequency/ }).getByRole('cell').nth(1)
  const original = parseFloat(await frequency.innerText())
  expect(original).toBeGreaterThan(460)
  expect(original).toBeLessThan(500)
  await page.locator('[data-part="C1"]').focus()
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: '220', exact: true }).click()
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  const slower = parseFloat(await frequency.innerText())
  expect(slower / original).toBeCloseTo(100 / 220, 2)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  expect(parseFloat(await frequency.innerText())).toBeCloseTo(original, 1)

  // RESET is an input, so an unwired reset must not receive a hidden pull-up.
  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  await page.locator('[data-wire="W4"]').focus()
  await page.getByRole('button', { name: /^Remove wire/ }).click()
  await expect(page.getByRole('button', { name: 'Simulate', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('no DC path')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
