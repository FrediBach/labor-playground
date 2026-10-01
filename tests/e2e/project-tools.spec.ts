import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

declare global {
  interface Window { testDisk: { content: string | null; writes: number; fail: boolean; cancel: boolean } }
}
async function mockFolder(page: Page) {
  await page.addInitScript(() => {
    window.testDisk = { content: null, writes: 0, fail: false, cancel: false }
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
      if (window.testDisk.cancel) throw new DOMException('Cancelled', 'AbortError')
      return {
        name: 'Test project',
        getFileHandle: async (_name: string, options?: { create: boolean }) => {
          if (window.testDisk.content === null && !options?.create) throw new DOMException('Missing', 'NotFoundError')
          return {
            getFile: async () => new File([window.testDisk.content ?? ''], 'circuit.json'),
            createWritable: async () => {
              if (window.testDisk.fail) throw new DOMException('Access denied', 'NotAllowedError')
              let pending = ''
              return { write: async (text: string) => { pending = text }, close: async () => { window.testDisk.content = pending; window.testDisk.writes++ }, abort: async () => {} }
            },
          }
        },
      }
    } })
  })
}

test('guide searches topics, contains shortcuts, and preserves typing and dialog focus', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('?')
  const guide = page.getByRole('dialog')
  await expect(guide).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search guide' }).fill('folder')
  await expect(guide.getByRole('heading', { name: 'Sync a local folder' })).toBeVisible()
  await expect(guide.getByRole('heading', { name: 'Place, move, and connect' })).toBeHidden()
  await page.getByRole('searchbox').fill('no-such-topic')
  await expect(guide.getByText('No matching topics.', { exact: false })).toBeVisible()
  await page.getByRole('searchbox').fill('')
  await guide.getByRole('button', { name: 'Shortcuts', exact: true }).click()
  await expect(guide.getByRole('button', { name: 'Shortcuts', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(guide.getByText('Cmd/Ctrl + S', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/labor-help-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/labor-help-mobile.png' })
  const bounds = await guide.boundingBox()
  expect(bounds!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(guide).toBeHidden()
})

test('shortcuts switch tools and tabs without changing text input', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('w')
  await expect(page.getByRole('button', { name: 'Wire tool', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Alt+Digit4')
  await expect(page.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Alt+Digit1')
  const search = page.getByRole('textbox', { name: 'Find a component' })
  await search.fill('wire')
  await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('folder sync saves, loads external edits, resolves conflicts, and recovers from denied writes', async ({ page }) => {
  await mockFolder(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect folder' }).click()
  expect(await page.evaluate(() => window.testDisk.writes)).toBe(0)
  await page.keyboard.press('Control+s')
  await expect(page.locator('.folder-toolbar')).toContainText('Synced circuit.json')
  await page.evaluate(() => { const doc = JSON.parse(window.testDisk.content!); doc.title = 'External edit'; window.testDisk.content = JSON.stringify(doc) })
  await page.getByRole('button', { name: 'Sync now', exact: true }).click()
  await expect(page.locator('.project-title')).toContainText('External edit')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.evaluate(() => { const doc = JSON.parse(window.testDisk.content!); doc.title = 'Concurrent edit'; window.testDisk.content = JSON.stringify(doc) })
  await page.getByRole('button', { name: 'Sync now', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Keep workbench' })).toBeVisible()
  expect(await page.evaluate(() => window.testDisk.writes)).toBe(1)
  await page.evaluate(() => { window.testDisk.fail = true })
  await page.getByRole('button', { name: 'Keep workbench' }).click()
  await expect(page.locator('.folder-toolbar')).toContainText('Sync failed: Access denied')
  await page.evaluate(() => { window.testDisk.fail = false })
  await page.getByRole('button', { name: 'Keep workbench' }).click()
  await expect(page.getByRole('button', { name: 'Keep workbench' })).toBeHidden()
  expect(await page.evaluate(() => window.testDisk.writes)).toBe(2)
  await page.evaluate(() => { window.testDisk.content = null })
  await page.getByRole('button', { name: 'Sync now', exact: true }).click()
  await expect(page.locator('.folder-toolbar')).toContainText('was removed')
  await page.getByRole('button', { name: 'Keep workbench' }).click()
  await expect(page.getByRole('button', { name: 'Keep workbench' })).toBeHidden()
  expect(await page.evaluate(() => window.testDisk.writes)).toBe(3)
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Connect folder' })).toBeEnabled()
  expect(await page.evaluate(() => window.testDisk.content)).toBeTruthy()
})

test('existing folder requires a choice, invalid files stay untouched, and cancellation is quiet', async ({ page }) => {
  await mockFolder(page)
  await page.goto('/')
  await page.evaluate(() => { window.testDisk.cancel = true })
  await page.getByRole('button', { name: 'Connect folder' }).click()
  await expect(page.getByRole('button', { name: 'Connect folder' })).toBeEnabled()
  await page.evaluate(() => { window.testDisk.cancel = false; window.testDisk.content = '{bad json' })
  await page.getByRole('button', { name: 'Connect folder' }).click()
  await expect(page.locator('.folder-toolbar')).toContainText('Sync failed')
  expect(await page.evaluate(() => window.testDisk.writes)).toBe(0)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))).not.toBeNull()
  await page.evaluate(() => { const doc = JSON.parse(localStorage.getItem('labor-playground.document.v1')!); doc.title = 'Existing project'; window.testDisk.content = JSON.stringify(doc) })
  await page.getByRole('button', { name: 'Connect folder' }).click()
  await expect(page.getByRole('button', { name: 'Load folder version' })).toBeVisible()
  await page.getByRole('button', { name: 'Load folder version' }).click()
  await expect(page.locator('.project-title')).toContainText('Existing project')
  expect(await page.evaluate(() => window.testDisk.writes)).toBe(0)
})


test('unsupported browsers retain file export and disabled folder controls', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }) })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Connect folder' })).toBeDisabled()
  await expect(page.locator('.folder-toolbar')).toContainText('Folder access is unavailable')
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  expect((await download).suggestedFilename()).toMatch(/\.json$/)
})
