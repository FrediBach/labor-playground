import { expect, test } from '@playwright/test'

test('physical Pico transfer uses the current editor source and releases USB after saving', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { commands: [] as string[], closed: false, reboots: 0, requests: 0 }
    Object.assign(window, { serialFixture: state })
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { async requestPort() {
      state.requests++
      let controller: ReadableStreamDefaultController<Uint8Array>, code = '', raw = false
      const reply = (text: string) => controller.enqueue(new TextEncoder().encode(text))
      return {
        readable: new ReadableStream({ start(value) { controller = value } }),
        writable: new WritableStream({ write(bytes) {
          const value = new TextDecoder().decode(bytes)
          if (value === '\x02\r\x01') { raw = true; reply('raw REPL; CTRL-B to exit\r\n>') }
          else if (value === '\x02') { raw = false; reply('>>> ') }
          else if (value === '\x04' && !raw) { state.reboots++; reply('MPY: soft reboot\r\n') }
          else if (value === '\x04' && !code) reply('MPY: soft reboot\r\nraw REPL; CTRL-B to exit\r\n>')
          else if (value === '\x04') { state.commands.push(code); reply(`OK${code.includes('print(sys.platform)') ? 'rp2\r\n' : ''}\x04\x04>`); code = '' }
          else if (!value.includes('\x03')) code += value
        } }),
        async open() {}, async close() { state.closed = true },
      }
    } } })
  })
  await page.goto('/')
  await page.getByLabel('Load example').selectOption('pico-console')
  const panel = page.getByLabel('Physical Pico transfer')
  await expect(panel.getByText(/replaces main.py/)).toBeVisible()
  const source = 'print("USB fixture 🌍")\n'
  const editor = page.getByRole('textbox', { name: 'Pico main.py editor' })
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(source)
  await panel.getByLabel('Run after upload').uncheck()
  await panel.getByRole('button', { name: 'Send to Pico', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('main.py saved. It will run on the next reset.')
  const state = await page.evaluate(() => (window as unknown as { serialFixture: { commands: string[]; closed: boolean; reboots: number; requests: number } }).serialFixture)
  expect(state.closed).toBe(true)
  expect(state.reboots).toBe(0)
  expect(state.requests).toBe(1)
  const bytes = state.commands.filter(code => code.includes('.write(')).flatMap(code => [...code.matchAll(/\\x([0-9a-f]{2})/g)].map(match => parseInt(match[1], 16)))
  expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe(source)
  await expect(page.getByLabel('Pico serial console')).toContainText('Use print()')
  await panel.getByLabel('Run after upload').check()
  await panel.getByRole('button', { name: 'Send to Pico', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('Pico restarted to run it.')
})

test('unsupported browsers explain requirements; dismissing the picker can be retried', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined }))
  await page.goto('/')
  await page.getByLabel('Load example').selectOption('pico-console')
  const panel = page.getByLabel('Physical Pico transfer')
  await expect(panel.getByRole('button', { name: 'Send to Pico' })).toBeDisabled()
  await expect(panel.getByText(/Web Serial is unavailable/)).toBeVisible()
  await page.evaluate(() => Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort() { return Promise.reject(new DOMException('No port selected', 'NotFoundError')) } } }))
  // Changing the checkbox rerenders feature detection after installing the fixture.
  await panel.getByLabel('Run after upload').uncheck()
  await panel.getByRole('button', { name: 'Send to Pico' }).click()
  await expect(panel.getByRole('status')).toHaveText('No Pico selected.')
  await expect(panel.getByRole('button', { name: 'Send to Pico' })).toBeEnabled()
})
