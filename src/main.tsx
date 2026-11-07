import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { captureOfficeToken } from './officeToken'

// The page link carries the server token in its fragment (#token=...): keep it
// and take it out of the address bar before the first render and the WebSocket
// that presents it (src/officeToken.ts)
captureOfficeToken()

// Three pages, one bundle: the app (the widget window), the catch
// notification (?toast) and the design QA page (?qa)
const params = new URLSearchParams(window.location.search)
const isToast = params.has('toast')
const isQa = params.has('qa')
if (isQa) document.documentElement.classList.add('qa-mode')
else if (isToast) document.documentElement.classList.add('toast-mode')
else if (params.has('widget')) document.documentElement.classList.add('widget-mode')

// Each page loads only its own code: a catch notification opens a window per
// catch and needs neither the terminal nor the Pokédex
const Page = lazy(() => (isQa ? import('./QaPage') : isToast ? import('./Toast') : import('./Widget')))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}><Page /></Suspense>
  </React.StrictMode>,
)
