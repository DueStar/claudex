/**
 * IncidentLayer — everything incident mode draws over the room.
 *
 * Rendered as siblings inside .room-container (a fragment, not a wrapper)
 * so each piece keeps its own z-index against furniture and agents:
 *   - the "days since last incident" sign (every mode; number is live)
 *   - a red room tint that pulses (incident only), after a short dark red
 *     alarm burst as the incident starts
 *   - a beacon above the door with a sweeping light cone (incident only)
 *   - the status screen on the wall TV (incident only)
 *   - optional slots that draw nothing until their art exists
 *     (incident board, pizza tower)
 *
 * All positions are % of the room, matching the hotspots in rooms.ts and
 * the fixtures baked into the room PNGs.
 */

import MAP from '../pokemon/map.generated.json'
import React, { useEffect, useSyncExternalStore } from 'react'
import { useIncident, daysSinceLastIncident, shouldPlayAlarm } from '../incident'
import {
  incidentAssetUrl, probeIncidentAssets, subscribeIncidentAssets, type IncidentAssetName,
} from '../incidentAssets'

/** Live asset URL for a slot (re-renders when a probe confirms the real art). */
function useIncidentAsset(name: IncidentAssetName): string | null {
  return useSyncExternalStore(subscribeIncidentAssets, () => incidentAssetUrl(name), () => incidentAssetUrl(name))
}

// Where the fixtures sit in the room art (% of the room)
// Anchors come from the map build (tools/build-map.py)
const DOOR_BEACON = MAP.anchors.doorBeacon // above the lab door
const TV_SCREEN   = MAP.anchors.tv         // the PC kiosk screen
const DAYS_SIGN   = MAP.anchors.daysSign   // the wooden sign left of the lab
const KANBAN      = MAP.anchors.kanban     // the bulletin board
const COUNTER     = MAP.anchors.counter    // under the berry tree

const DaysSinceSign: React.FC<{ days: number; incident: boolean }> = ({ days, incident }) => {
  const src = useIncidentAsset('daysSign')
  if (!src) return null
  const n = incident ? 0 : days
  const size = n >= 100 ? ' three' : n >= 10 ? ' two' : ''
  return (
    <div
      className={`days-sign${incident ? ' incident' : ''}`}
      style={{ left: `${DAYS_SIGN.x}%`, top: `${DAYS_SIGN.y}%` }}
      title={incident ? 'Days since last incident: 0 (it is happening now)' : `Days since last incident: ${days}`}
    >
      <img src={src} alt="Days since last incident" draggable={false} />
      <span className={`days-sign-digits${size}`}>{n}</span>
    </div>
  )
}

const IncidentLayer: React.FC = () => {
  const incident = useIncident()
  const active = incident.variant === 'incident'

  const beacon = useIncidentAsset('beacon')
  const beaconLit = useIncidentAsset('beaconLit')
  const screen = useIncidentAsset('statusScreen')
  const board = useIncidentAsset('incidentBoard')

  // Pizza arrives in tiers as the incident drags on
  const minutes = active && incident.startedAt ? (Date.now() - incident.startedAt) / 60_000 : 0
  const pizzaSlot: IncidentAssetName = minutes < 10 ? 'pizzaTower0' : minutes < 30 ? 'pizzaTower1' : 'pizzaTower2'
  const pizza = useIncidentAsset(pizzaSlot)

  // Why: one probe per slot per page load — resolves the real art when it lands in public/
  useEffect(() => { void probeIncidentAssets() }, [])

  const days = daysSinceLastIncident()

  return (
    <>
      <DaysSinceSign days={days} incident={active} />

      {active && (
        <>
          {/* Red room tint — above everything incl. agents, below the boss effect */}
          <div className="room-tint" aria-hidden="true" />
          {/* Alarm burst: three slow dark red flashes as prod goes down (keyed so each incident gets its own) */}
          {shouldPlayAlarm(incident, Date.now()) && (
            <div key={incident.startedAt} className="room-alarm" aria-hidden="true" />
          )}

          {/* Beacon over the door: CSS light cone sweep + two alternating frames */}
          <div className="incident-beacon-sweep" style={{ left: `${DOOR_BEACON.x}%`, top: `${DOOR_BEACON.y}%` }} aria-hidden="true" />
          <div className="incident-beacon" style={{ left: `${DOOR_BEACON.x}%`, top: `${DOOR_BEACON.y}%` }} title="Incident beacon">
            {beacon && <img className="frame-a" src={beacon} alt="" draggable={false} />}
            {beaconLit && <img className="frame-b" src={beaconLit} alt="" draggable={false} />}
          </div>

          {/* Status page on the wall TV */}
          {screen && (
            <div className="incident-tv" style={{ left: `${TV_SCREEN.x}%`, top: `${TV_SCREEN.y}%` }} title="Status page: ROLLBACK">
              <img src={screen} alt="Rollback in progress" draggable={false} />
              <span className="incident-tv-label">ROLLBACK</span>
            </div>
          )}

          {/* Slots that stay empty until the real art is drawn */}
          {board && (
            <img className="incident-board" src={board} alt="Incident timeline" draggable={false}
              style={{ left: `${KANBAN.x}%`, top: `${KANBAN.y}%` }} />
          )}
          {pizza && (
            <img className="incident-pizza" src={pizza} alt="Incident pizza" draggable={false}
              style={{ left: `${COUNTER.x}%`, top: `${COUNTER.y}%` }} />
          )}
        </>
      )}
    </>
  )
}

export default IncidentLayer
