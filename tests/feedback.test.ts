/**
 * Feedback from inside the app (electron/feedback.cjs): the issue it fills in,
 * the only address it opens, and the part of the page it pictures.
 */
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { composeIssue, issueUrl, clampRect, registerFeedbackIpc } = require('../electron/feedback.cjs')

const app = { version: '9.9.9', os: 'Windows 10.0.26200' }

describe('composeIssue', () => {
  it('fills in the title and a table of where it came from', () => {
    const i = composeIssue({ kind: 'add', text: '도감에 정렬 추가해 주세요\n둘째 줄', context: { view: 'dex', element: 'div.dex-grid > button', text: '이상해씨', width: 1200, height: 760, lang: 'ko' } }, app)
    expect(i.title).toBe('[feedback] Please add: 도감에 정렬 추가해 주세요')
    expect(i.body.startsWith('도감에 정렬 추가해 주세요\n둘째 줄\n')).toBe(true)
    expect(i.body).toContain('| From | app |')
    expect(i.body).toContain('| Screen | dex |')
    expect(i.body).toContain('| Element | `div.dex-grid > button` |')
    expect(i.body).toContain('| Window | 1200×760 |')
    expect(i.body).toContain('| App version | 9.9.9 |')
  })

  it('nothing written means no issue', () => {
    expect(composeIssue({ kind: 'fix', text: '   ' }, app)).toBeNull()
  })

  it('drops what it does not know and cuts what is too long', () => {
    const i = composeIssue({ kind: 'nope', text: 'x'.repeat(5000), context: { view: 'http://evil', lang: 'fr', text: 'a|b'.repeat(100) } }, app)
    expect(i.title.startsWith('[feedback] Please fix: ')).toBe(true)
    expect(i.body).not.toContain('evil')
    expect(i.body).toContain('| Language | ? |')
    expect(i.body).toContain('a\\|b')
    expect(i.body.split('\n')[0].length).toBe(2000)
  })

  it('a picture on the clipboard leaves a hidden hint to paste it', () => {
    expect(composeIssue({ text: 'hi', context: { attach: true } }, app).body).toContain('<!-- The picture')
    expect(composeIssue({ text: 'hi', context: {} }, app).body).not.toContain('<!--')
  })
})

describe('issueUrl', () => {
  it('is always a new issue on our repo', () => {
    const url = issueUrl(composeIssue({ text: 'hello & bye' }, app))
    expect(url.startsWith('https://github.com/DueStar/spawn/issues/new?labels=feedback&title=')).toBe(true)
    expect(new URL(url).searchParams.get('body')).toContain('hello & bye')
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
    const shell = { openExternal: vi.fn() }
    const clipboard = { writeImage: vi.fn(), writeText: vi.fn() }
    registerFeedbackIpc({ ipcMain, guard, shell, clipboard, appInfo: () => app })
    const image = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AA' }
    const sender = { capturePage: vi.fn(async () => image), getOwnerBrowserWindow: () => ({ getContentSize: () => [800, 600] }) }
    return { handlers, shell, clipboard, sender, image }
  }

  it('pictures the spot, then sends it to the clipboard and opens the issue', async () => {
    const { handlers, shell, clipboard, sender, image } = setup()
    await expect(handlers['feedback:capture']({ sender }, { x: 700, y: 10, width: 400, height: 100 })).resolves.toBe('data:image/png;base64,AA')
    expect(sender.capturePage).toHaveBeenCalledWith({ x: 700, y: 10, width: 100, height: 100 })
    expect(handlers['feedback:send']({ sender }, { kind: 'fix', text: 'tab closes', attach: true })).toEqual({ ok: true, attached: true })
    expect(clipboard.writeImage).toHaveBeenCalledWith(image)
    expect(shell.openExternal.mock.calls[0][0]).toMatch(/^https:\/\/github\.com\/DueStar\/spawn\/issues\/new\?/)
  })

  it('without the picture ticked, the clipboard is left alone', () => {
    const { handlers, clipboard, sender } = setup()
    expect(handlers['feedback:send']({ sender }, { text: 'x', attach: false })).toEqual({ ok: true, attached: false })
    expect(clipboard.writeImage).not.toHaveBeenCalled()
  })

  it('an empty note opens nothing; copy puts the text on the clipboard', () => {
    const { handlers, shell, clipboard, sender } = setup()
    expect(handlers['feedback:send']({ sender }, { text: '' })).toEqual({ ok: false, reason: 'empty' })
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(handlers['feedback:copy']({ sender }, { kind: 'like', text: 'nice' })).toEqual({ ok: true })
    expect(clipboard.writeText.mock.calls[0][0]).toMatch(/^\[feedback\] What I liked: nice\n\nnice/)
  })
})
