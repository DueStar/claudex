/**
 * Feedback from inside the app (electron/feedback.cjs): the row it builds, where it
 * sends it (our Supabase only, with the public key), and the part of the page it pictures.
 */
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { composeFeedback, feedbackText, createFeedbackSender, clampRect, registerFeedbackIpc } = require('../electron/feedback.cjs')

const app = { version: '9.9.9', os: 'Windows 10.0.26200' }
const config = { supabaseUrl: 'https://abc.supabase.co/', publishableKey: 'sb_publishable_x' }

describe('composeFeedback', () => {
  it('builds the row: the text, where it came from, the window', () => {
    const r = composeFeedback({ text: '  도감에 정렬 추가해 주세요\n둘째 줄 ', context: { view: 'dex', element: 'div.dex-grid > button', text: '이상해씨', width: 1200, height: 760, lang: 'ko' } }, app)
    expect(r).toEqual({
      source: 'app',
      body: '도감에 정렬 추가해 주세요\n둘째 줄',
      lang: 'ko',
      context: { view: 'dex', element: 'div.dex-grid > button', text: '이상해씨', window: '1200×760' },
      app_version: '9.9.9',
      system: 'Windows 10.0.26200',
    })
  })

  it('nothing written means no row', () => {
    expect(composeFeedback({ text: '   ' }, app)).toBeNull()
  })

  it('drops what it does not know and cuts what is too long', () => {
    const r = composeFeedback({ text: 'x'.repeat(5000), context: { view: 'http://evil', lang: 'fr', element: 'e'.repeat(500) } }, app)
    expect(r.body.length).toBe(2000)
    expect(r.lang).toBeNull()
    expect(r.context.view).toBeUndefined()
    expect(r.context.element.length).toBe(161)
  })

  it('reads as plain text for the clipboard', () => {
    const t = feedbackText(composeFeedback({ text: 'hi', context: { view: 'box' } }, app))
    expect(t).toBe('hi\n\n---\nFrom: app 9.9.9\nScreen: box\nSystem: Windows 10.0.26200')
  })
})

describe('createFeedbackSender', () => {
  const okRes = { ok: true, status: 201 }
  it('adds one row to our feedback table with the public key, and nothing else', async () => {
    const fetchImpl = vi.fn(async () => okRes)
    const send = createFeedbackSender({ config, fetchImpl })
    await expect(send({ source: 'app', body: 'hi' }, null)).resolves.toEqual({ ok: true, attached: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as any[]
    expect(url).toBe('https://abc.supabase.co/rest/v1/feedback')
    expect(init.method).toBe('POST')
    expect(init.headers.apikey).toBe('sb_publishable_x')
    expect(init.headers.Prefer).toBe('return=minimal')
    expect(JSON.parse(init.body)).toEqual({ source: 'app', body: 'hi', image_path: null })
  })

  it('a picture goes to the private bucket first and the row points at it', async () => {
    const fetchImpl = vi.fn(async () => okRes)
    const send = createFeedbackSender({ config, fetchImpl, randomId: () => 'id1' })
    await expect(send({ source: 'app', body: 'hi' }, Buffer.from([1, 2, 3]))).resolves.toEqual({ ok: true, attached: true })
    const [imgUrl, imgInit] = fetchImpl.mock.calls[0] as any[]
    expect(imgUrl).toMatch(/^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/feedback\/\d{4}-\d\d-\d\d\/id1\.jpg$/)
    expect(imgInit.headers['Content-Type']).toBe('image/jpeg')
    expect(JSON.parse((fetchImpl.mock.calls[1] as any[])[1].body).image_path).toMatch(/^feedback\/\d{4}-\d\d-\d\d\/id1\.jpg$/)
  })

  it('a picture that does not go through leaves the text to go on its own', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes('/storage/') ? { ok: false, status: 400 } : okRes))
    const send = createFeedbackSender({ config, fetchImpl })
    await expect(send({ source: 'app', body: 'hi' }, Buffer.from([1]))).resolves.toEqual({ ok: true, attached: false })
    expect(JSON.parse((fetchImpl.mock.calls[1] as any[])[1].body).image_path).toBeNull()
  })

  it('says why it did not go: refused, offline, or no Supabase set up', async () => {
    await expect(createFeedbackSender({ config, fetchImpl: async () => ({ ok: false, status: 400 }) })({ body: 'x' })).resolves.toEqual({ ok: false, reason: 'refused' })
    await expect(createFeedbackSender({ config, fetchImpl: async () => { throw new Error('net') } })({ body: 'x' })).resolves.toEqual({ ok: false, reason: 'offline' })
    await expect(createFeedbackSender({ config: {}, fetchImpl: vi.fn() })({ body: 'x' })).resolves.toEqual({ ok: false, reason: 'not-set-up' })
  })
})

describe('clampRect', () => {
  it('keeps the picture inside the page in whole pixels', () => {
    expect(clampRect({ x: -20, y: 10.4, width: 300, height: 200 }, { width: 200, height: 100 })).toEqual({ x: 0, y: 10, width: 200, height: 90 })
    expect(clampRect({ x: 500, y: 500, width: 10, height: 10 }, { width: 200, height: 100 })).toEqual({ x: 199, y: 99, width: 1, height: 1 })
    expect(clampRect(null, { width: 200, height: 100 })).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('registerFeedbackIpc', () => {
  function setup() {
    const handlers: Record<string, (...a: any[]) => any> = {}
    const ipcMain = { handle: (ch: string, fn: any) => { handlers[ch] = fn } }
    const guard = (fn: any) => (event: any, arg: any) => fn(arg, event)
    const clipboard = { writeText: vi.fn() }
    const send = vi.fn(async (_row: any, jpeg: any) => ({ ok: true, attached: !!jpeg }))
    registerFeedbackIpc({ ipcMain, guard, clipboard, appInfo: () => app, send })
    const image = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AA', getSize: () => ({ width: 400, height: 100 }), toJPEG: () => Buffer.from([9]) }
    const sender = { capturePage: vi.fn(async () => image), getOwnerBrowserWindow: () => ({ getContentSize: () => [800, 600] }) }
    return { handlers, clipboard, send, sender }
  }

  it('pictures the spot, then sends the row with the picture when ticked', async () => {
    const { handlers, send, sender } = setup()
    await expect(handlers['feedback:capture']({ sender }, { x: 700, y: 10, width: 400, height: 100 })).resolves.toBe('data:image/png;base64,AA')
    expect(sender.capturePage).toHaveBeenCalledWith({ x: 700, y: 10, width: 100, height: 100 })
    await expect(handlers['feedback:send']({ sender }, { text: 'tab closes', attach: true, context: { view: 'terminal' } })).resolves.toEqual({ ok: true, attached: true })
    expect(send.mock.calls[0][0].body).toBe('tab closes')
    expect(send.mock.calls[0][1]).toEqual(Buffer.from([9]))
  })

  it('without the picture ticked, only the text goes', async () => {
    const { handlers, send, sender } = setup()
    await handlers['feedback:capture']({ sender }, { x: 0, y: 0, width: 10, height: 10 })
    await expect(handlers['feedback:send']({ sender }, { text: 'x', attach: false })).resolves.toEqual({ ok: true, attached: false })
    expect(send.mock.calls[0][1]).toBeNull()
  })

  it('an empty note sends nothing; copy puts the text on the clipboard', async () => {
    const { handlers, send, clipboard, sender } = setup()
    await expect(handlers['feedback:send']({ sender }, { text: '' })).resolves.toEqual({ ok: false, reason: 'empty' })
    expect(send).not.toHaveBeenCalled()
    expect(handlers['feedback:copy']({ sender }, { text: 'nice' })).toEqual({ ok: true })
    expect(clipboard.writeText.mock.calls[0][0]).toMatch(/^nice\n\n---\nFrom: app 9\.9\.9/)
  })
})
