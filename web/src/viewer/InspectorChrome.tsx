/**
 * The physics inspector's header, on top of the inset: one ribbon with snapping the camera behind or to the right,
 * a second pane at right angles, double size, gravity and the slip vectors, and in its corner the (i) explainer and
 * closing it.
 */
import { useRef, type RefObject } from "react";
import type { InspectorCamera } from "./inspector";
import { ACCEL_SCALE, ARROW_COLORS, AXIS_LEN, INSET, insetBox } from "./inspectorView";

const seg = "px-1.5 py-px";

/** The snapped cameras; any drag on the inset leaves them (the camera is then free). */
const SNAPS: [Exclude<InspectorCamera, "free">, string, string][] = [
  ["behind", "Behind", "Snap behind the animal, along its heading: roll reads directly"],
  ["side", "Side", "Snap to the animal's right: pitch reads directly"],
];

export default function InspectorChrome({
  gravity,
  onGravity,
  hasAccel,
  camera,
  onCamera,
  pair,
  onPair,
  large,
  onLarge,
  slip,
  onSlip,
  onClose,
}: {
  gravity: boolean;
  onGravity: (on: boolean) => void;
  /** The track bundle has the acceleration columns. */
  hasAccel: boolean;
  camera: InspectorCamera;
  onCamera: (c: InspectorCamera) => void;
  pair: boolean;
  onPair: (on: boolean) => void;
  large: boolean;
  onLarge: (on: boolean) => void;
  slip: boolean;
  onSlip: (on: boolean) => void;
  onClose: () => void;
}) {
  const info = useRef<HTMLDialogElement>(null);
  const box = insetBox({ pair, large });
  return (
    <>
      {/* One ribbon of controls that wraps to a second line only when the inset is too narrow for it. */}
      <div
        role="toolbar"
        aria-label="Physics inspector controls"
        className="absolute flex flex-wrap items-center gap-x-1 gap-y-1 rounded-t border border-b-0 border-line bg-panel/95 py-1 pr-9 pl-1.5 text-[10px] text-muted"
        style={{ right: INSET.right, bottom: INSET.bottom + box.height, width: box.width }}
      >
        <span className="flex shrink-0 overflow-hidden rounded border border-line" role="group" aria-label="Snap the camera">
          {SNAPS.map(([c, label, title]) => (
            <button
              key={c}
              type="button"
              title={title}
              aria-pressed={camera === c}
              className={`${seg} ${camera === c ? "bg-accent/25 text-ink" : "hover:text-ink"}`}
              onClick={() => onCamera(c)}
            >
              {label}
            </button>
          ))}
        </span>
        <button
          type="button"
          title="A second pane, looking from 90 degrees to the right of the first: from behind, that is from the right"
          aria-pressed={pair}
          className={`shrink-0 rounded border border-line ${seg} ${pair ? "bg-accent/25 text-ink" : "hover:text-ink"}`}
          onClick={() => onPair(!pair)}
        >
          Both
        </button>
        <button
          type="button"
          title="Double the inset's size"
          aria-pressed={large}
          className={`shrink-0 rounded border border-line ${seg} ${large ? "bg-accent/25 text-ink" : "hover:text-ink"}`}
          onClick={() => onLarge(!large)}
        >
          2x
        </button>
        {hasAccel && (
          <label className="flex shrink-0 items-center gap-0.5" title="Draw gravity as the tag sees it">
            <input type="checkbox" className="h-3 w-3" checked={gravity} onChange={(e) => onGravity(e.target.checked)} />g
          </label>
        )}
        <label className="flex shrink-0 items-center gap-0.5" title="Draw the body axis and the path, with the angles between them">
          <input type="checkbox" className="h-3 w-3" checked={slip} onChange={(e) => onSlip(e.target.checked)} />
          slip
        </label>
        {/* Pinned to the corner, out of the flow, so they never take a line of their own. */}
        <span className="absolute top-1 right-1.5 flex gap-1">
          <button
            type="button"
            aria-label="About the physics inspector"
            className="h-4 w-4 rounded-full border border-line font-serif text-[10px] leading-none italic hover:text-ink"
            onClick={() => info.current?.showModal()}
          >
            i
          </button>
          <button type="button" aria-label="Close the physics inspector" className="leading-none hover:text-ink" onClick={onClose}>
            {"×"}
          </button>
        </span>
      </div>
      <InspectorInfo ref={info} />
    </>
  );
}

function Swatch({ k }: { k: keyof typeof ARROW_COLORS }) {
  return <span style={{ color: ARROW_COLORS[k] }}>{"■"} </span>;
}

/** The (i) explainer: frames, axes, each vector, pinning and the sample rate. */
function InspectorInfo({ ref }: { ref: RefObject<HTMLDialogElement | null> }) {
  return (
    <dialog
      ref={ref}
      className="m-auto max-h-[85vh] max-w-xl overflow-y-auto rounded border border-line bg-panel p-0 text-sm text-ink backdrop:bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close(); // a click on the backdrop closes it
      }}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Physics inspector</h2>
          <button type="button" className="text-muted hover:text-ink" onClick={() => ref.current?.close()} aria-label="Close">
            {"×"}
          </button>
        </div>
        <p>
          The animal at the cursor time, at its attitude, with the vectors acting on it. It follows playback, between
          samples too.
        </p>
        <h3 className="font-semibold">Orientation</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Level, and turned with the animal: its heading always points the same way in the inset, while pitch
            and roll stay on the body. North is marked N on the ring; it swings round as the animal turns, and so
            does the current. Compass directions read best on the map and in the 3D view.
          </li>
          <li>
            Not the fish&apos;s own (body-fixed) frame: there the body and the swim arrow would never move. Up in the
            inset is up in the water.
          </li>
        </ul>
        <h3 className="font-semibold">Attitude</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>r</b>, <b>Roll</b>: positive with the right side down. <b>p</b>, <b>Pitch</b>: positive nose up. Both come from the tag's
            static (gravity) acceleration.
          </li>
          <li>
            <b>y</b>, <b>Yaw</b>: the tag&apos;s heading, degrees clockwise from magnetic north, from the tilt-compensated
            magnetometer, as dead reckoning used it. No magnetic declination is applied. The body and its arrows are
            drawn at this heading, and N is relative to it.
          </li>
          <li>
            <b>hdg</b>, <b>Heading</b> (second line, pinned tracks only): the direction the animal moves along on the map. To
            end on the end fix, a pinned track&apos;s dead-reckoned path is turned and scaled about the start fix by
            one angle and one factor, shown beside it as <b>pin</b>, so this is the yaw plus that turn. A large turn means the
            magnetometer and the fixes disagree.
          </li>
          <li>
            Past 80 degrees of pitch the heading is a gimbal singularity: roll turns to noise and the heading jumps
            freely. The body is still drawn from pitch and roll, but the arrows that depend on the heading turn gray,
            and yaw reads --.
          </li>
        </ul>
        <h3 className="font-semibold">Vectors</h3>
        <ul className="space-y-1">
          <li>
            <Swatch k="water" />
            <b>swim</b>: the animal&apos;s velocity through the water, as dead reckoning assumed it: a set speed (often
            a constant, such as 1.00 m/s), along the heading, horizontal. It is an assumption, not a measurement, and
            not a force: at a steady speed thrust balances drag and the net acceleration is zero.
          </li>
          <li>
            <Swatch k="current" />
            <b>current</b>: the ocean model's current at the animal's depth, as applied to the track.
          </li>
          <li>
            <Swatch k="ground" />
            <b>ground</b>, over the ground: their sum, the velocity dead reckoning integrated. The ring is 1 m/s at the arrow
            scale chosen under Controls (one body length per 1 m/s by default).
          </li>
          <li>
            <Swatch k="vertical" />
            <b>vert</b>: the vertical speed, from the change in the depth record between samples, up positive. Dead
            reckoning&apos;s set speed is horizontal only, so this is the other component of the velocity, and it is
            measured, not assumed. At 1 Hz it is a raw difference, so pressure-sensor noise shows as a jitter of a few
            cm/s.
          </li>
          <li>
            <Swatch k="dynamic" />
            <b>dynamic</b> acceleration: the tag's acceleration minus its gravity estimate, from the body axes into
            the frame shown. The track bundle is sampled at 1 Hz, while tail beats run at about 16 to 25 Hz in the
            raw data: this is a snapshot of a fast signal, aliased, not a trend. Read its size, not its rhythm. Always
            drawn, and always labeled, even when short. Do not expect it to match the change in the
            over-ground arrow: dead reckoning never integrates it (a double integral drifts within seconds) and swims
            at a set speed, so bursts and glides the tag feels are missing from the track.
          </li>
          <li>
            <Swatch k="gravity" />
            <b>gravity</b> (the g toggle): the tag's static (low-passed) acceleration, which points along gravity.
            It points straight down when the drawn attitude matches the accelerometer.
          </li>
          <li>
            Accelerations are drawn at {ACCEL_SCALE} body lengths per 1 m/s{"²"} (gravity is about 2 body
            lengths), whatever the velocity scale, and labeled in m/s², converted from g for runs that report g.
            Acceleration arrows need a track exported with them.
          </li>
          <li>
            Each number sits just past its arrow&apos;s tip, in the legend&apos;s units, and is pushed clear of the
            body when the arrow is short.
          </li>
        </ul>
        <h3 className="font-semibold">Camera</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Side</b> (default) looks from the animal&apos;s right, nose to the right, just above the level ring,
            so the ring reads as the horizon and pitch is the body&apos;s tilt against it. <b>Behind</b> looks along
            the heading from behind, so roll reads the same way. Both follow the animal as it turns.
          </li>
          <li>
            <b>Drag</b> anywhere on the inset to turn the view about the animal (it keeps its angle to the animal as
            it turns); the wheel zooms. A drag turns the Side or Behind button off. <b>Double-click</b> returns to
            Side.
          </li>
          <li>
            <b>Both</b> adds a second pane looking from 90 degrees to the right of the first: from Behind, that is
            Side; from Side, the front. The two turn together.
          </li>
          <li>
            The lens is narrow and far out, so the near end of the body is not drawn larger than the far end, and the
            body fades with distance: its brighter end is the one nearer you.
          </li>
          <li>
            <b>2x</b> doubles the inset. A pane too large for the 3D view is not drawn: use Studio or full screen.
          </li>
        </ul>
        <h3 className="font-semibold">Slip</h3>
        <ul className="space-y-1">
          <li>
            <Swatch k="axis" />
            <b>axis</b>, the body axis: where the head points, from heading, pitch and roll.
          </li>
          <li>
            <Swatch k="path" />
            <b>path</b>: the direction of travel, over the ground plus the vertical speed from the depth record. Both
            are drawn {AXIS_LEN} body lengths long: they show directions, not speeds.
          </li>
          <li>
            <b>Attack</b>: the angle between them in the body&apos;s vertical plane, positive with the nose above the
            path. <b>Slip</b> (sideslip): in the body&apos;s horizontal plane, positive with the path toward the
            animal&apos;s right. Both are taken in the body&apos;s own axes, so a rolled animal swaps some of one for
            the other.
          </li>
          <li>
            Dead reckoning swims along the heading, so sideslip here comes from the current alone, and the attack
            angle compares the tag&apos;s pitch with the climb or dive the depth record shows. The horizontal speed is
            the one dead reckoning used (often a constant), so a wrong speed tilts the path: read the attack angle
            with that in mind. The Omniverse viewer&apos;s debug vectors show the same two directions.
          </li>
        </ul>
        <h3 className="font-semibold">Fix pinning</h3>
        <p>
          A fix-pinned track is scaled and turned as a whole so that it ends at the end fix. The turn absorbs the
          local magnetic declination and any heading bias of the tag. The inset draws the velocities as dead reckoning
          combined them, before pinning, and its note gives the scale and turn; the yaw readout shows both headings,
          before and after the turn.
        </p>
      </div>
    </dialog>
  );
}
