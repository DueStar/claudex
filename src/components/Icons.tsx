/**
 * Icons — small line icons (16px grid, currentColor) and Claudex's Poké Ball
 * (an original drawing, tools/build-icons.py: the same ball as the app icon).
 */

import React from 'react'

type P = { size?: number; className?: string }
const Svg: React.FC<P & { children: React.ReactNode }> = ({ size = 16, className, children }) => (
  <svg className={`ico${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 16 16" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

/** A folder: open a session somewhere else */
export const FolderIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" /></Svg>
)
/** Stacked cards: pick one of the earlier sessions */
export const SessionsIcon: React.FC<P> = (p) => (
  <Svg {...p}>
    <rect x="2" y="5.5" width="12" height="8" rx="1.5" />
    <path d="M3.5 3.5h9M5 1.8h6" />
    <path d="M5 9.5h4" />
  </Svg>
)
/** >_ */
export const TerminalIcon: React.FC<P> = (p) => (
  <Svg {...p}><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.8" /><path d="M4.5 6.5 6.5 8l-2 1.5M8 10h3" /></Svg>
)
/** The Pokédex: an open book */
export const DexIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M8 4.2C6.6 3.2 4.6 3 2.5 3.3v9.2c2.1-.3 4.1-.1 5.5.9 1.4-1 3.4-1.2 5.5-.9V3.3C11.4 3 9.4 3.2 8 4.2zM8 4.2v9.2" /></Svg>
)
/** The PC box: a grid of slots */
export const BoxIcon: React.FC<P> = (p) => (
  <Svg {...p}><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" /></Svg>
)
/** Widget: a narrow floating panel */
export const WidgetModeIcon: React.FC<P> = (p) => (
  <Svg {...p}><rect x="2" y="2.5" width="12" height="11" rx="1.8" strokeDasharray="2 1.6" /><rect x="8.5" y="4.5" width="4" height="7" rx="1" fill="currentColor" stroke="none" /></Svg>
)
/** Window: an app window */
export const WindowModeIcon: React.FC<P> = (p) => (
  <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.8" /><path d="M2 6h12M6 6v7" /></Svg>
)
/** Fullscreen: four corners */
export const FullscreenIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></Svg>
)
export const PlusIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>
)

/** Claudex's Poké Ball, the same picture as the app icon */
export const PokeBall: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
  <img
    className={`pokeball${className ? ` ${className}` : ''}`}
    src="/sprites/claudex-ball.png"
    width={size}
    height={size}
    alt=""
    draggable={false}
  />
)
