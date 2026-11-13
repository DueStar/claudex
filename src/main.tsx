// First: the page's saved choices under the old name (claudex-…) carry over before anything reads them
import './storageMigration'
import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { captureServerToken } from './serverToken'
import { isMac } from './platform'
import { terminalFontsReady } from './fontsReady'
import { registerSmokeGlobals } from './termMetrics'

// The page link carries the server token in its fragment (#token=...): keep it
// and take it out of the address bar before the first render and the WebSocket
// that presents it (src/serverToken.ts)
captureServerToken()

// Three pages, one bundle: the app (the widget window), the catch
// notification (?toast) and the design QA page (?qa)
const params = new URLSearchParams(window.location.search)
const isToast = params.has('toast')
const isQa = params.has('qa')
if (isQa) document.documentElement.classList.add('qa-mode')
else if (isToast) document.documentElement.classList.add('toast-mode')
else if (params.has('widget')) document.documentElement.classList.add('widget-mode')
// A Mac: the native traffic lights instead of the page's own window buttons (.is-mac rules)
if (isMac()) document.documentElement.classList.add('is-mac')
// The Mac CI's smoke launch (electron/smoke.cjs) reads the terminal's font from the page; only then
if (params.has('smoke')) registerSmokeGlobals()

// Each page loads only its own code: a catch notification opens a window per
// catch and needs neither the terminal nor the Pokédex. One import() per page:
// in a single ternary the build attaches only one page's CSS to all three, and
// the notification window showed without its styles (1.3.18).
// The app's page opens terminals: it waits for the bundled terminal faces as
// its code loads, so xterm measures its cell with them (src/fontsReady.ts)
const Page = isQa ? lazy(() => import('./QaPage')) : isToast ? lazy(() => import('./Toast'))
  : lazy(() => Promise.all([import('./Widget'), terminalFontsReady()]).then(([page]) => page))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}><Page /></Suspense>
  </React.StrictMode>,
)
