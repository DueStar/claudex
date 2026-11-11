/**
 * Icons — small line icons (16px grid, currentColor) and spawn's Poké Ball
 * (an original drawing, tools/build-icons.py: the same ball as the app icon).
 */

import React, { useState } from 'react'
import { ballUrl } from '../pokedexStore'

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
/** A clock: today's log */
export const TodayIcon: React.FC<P> = (p) => (
  <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.6" /></Svg>
)
/** A trophy: 랭킹 */
export const RankIcon: React.FC<P> = (p) => (
  <Svg {...p}>
    <path d="M4.5 2.5h7v3.2a3.5 3.5 0 0 1-7 0z" />
    <path d="M4.5 3.8H3.2a1.4 1.4 0 0 0 0 2.8h1.5M11.5 3.8h1.3a1.4 1.4 0 0 1 0 2.8h-1.5" />
    <path d="M8 9.2v2.3M5.5 13.5h5M6.3 11.5h3.4" />
  </Svg>
)
/** A line: minimize the window */
export const MinimizeIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M3.5 8h9" /></Svg>
)
/** A window with its left column: show or hide the side panel */
export const SidePanelIcon: React.FC<P> = (p) => (
  <Svg {...p}><rect x="2.5" y="3" width="11" height="10" rx="2" /><path d="M6.5 3v10" /></Svg>
)
/** Two opposed arrows: swap the Pokémon working a session */
export const SwapIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" /></Svg>
)
/** An open box: a helper session, worked by a Pokémon out of the box while the party is all out */
export const HelperIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M2 5.2 8 2.8l6 2.4v6.2L8 13.8l-6-2.4z" /><path d="M2 5.2 8 7.6l6-2.4M8 7.6v6.2" /></Svg>
)
/** × : close */
export const CloseIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>
)
/** A paper plane: send the instruction */
export const SendIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5z" /></Svg>
)
export const SearchIcon: React.FC<P> = (p) => (
  <Svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></Svg>
)
export const PlusIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>
)
/** A gear with six teeth: 설정 (the old circle-and-rays read as a sun) */
export const GearIcon: React.FC<P> = (p) => (
  <Svg {...p}><path d="M6.32 3.40L6.63 1.54L9.37 1.54L9.68 3.40L11.15 4.25L12.90 3.58L14.28 5.96L12.83 7.15L12.83 8.85L14.28 10.04L12.90 12.42L11.15 11.75L9.68 12.60L9.37 14.46L6.63 14.46L6.32 12.60L4.85 11.75L3.10 12.42L1.72 10.04L3.17 8.85L3.17 7.15L1.72 5.96L3.10 3.58L4.85 4.25Z" /><circle cx="8" cy="8" r="2.1" /></Svg>
)

/** A Poké Ball picture: the games' artwork shipped with the app, spawn's own drawing if it is missing */
export const PokeBall: React.FC<{ size?: number; className?: string; ball?: string | null; title?: string }> = ({ size = 16, className, ball, title }) => {
  const [failed, setFailed] = useState(false)
  return (
    <img
      className={`pokeball${className ? ` ${className}` : ''}`}
      src={failed ? '/sprites/spawn-ball.png' : ballUrl(ball ?? 'poke-ball')}
      width={size}
      height={size}
      alt={title ?? ''}
      title={title}
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
