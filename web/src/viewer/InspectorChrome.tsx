/**
 * The physics inspector's header, on top of the inset: which frame it is drawn in (and the toggle), the gravity
 * toggle, the (i) explainer, and closing it.
 */
import { useRef, type RefObject } from "react";
import type { InspectorFrame } from "./inspector";
import { ACCEL_SCALE, ARROW_COLORS, INSET } from "./inspectorView";

const seg = "px-1.5 py-px";

export default function InspectorChrome({
  frame,
  onFrame,
  gravity,
  onGravity,
  hasAccel,
  onClose,
}: {
  frame: InspectorFrame;
  onFrame: (f: InspectorFrame) => void;
  gravity: boolean;
  onGravity: (on: boolean) => void;
  /** The track bundle has the acceleration columns. */
  hasAccel: boolean;
  onClose: () => void;
}) {
  const info = useRef<HTMLDialogElement>(null);
  return (
    <>
      <div
        className="absolute flex items-center gap-1.5 rounded-t border border-b-0 border-line bg-panel/95 px-1.5 py-1 text-[10px] text-muted"
        style={{ right: INSET.right, bottom: INSET.bottom + INSET.size, width: INSET.size }}
      >
        <span className="text-ink">Physics</span>
        <span className="flex overflow-hidden rounded border border-line" role="group" aria-label="Inspector frame">
          {(
            [
              ["heading", "Heading up", "Level, turned with the animal: its heading always points the same way in the inset"],
              ["north", "North up", "The compass frame: north stays fixed (N on the ring) and the body turns"],
            ] as const
          ).map(([f, label, title]) => (
            <button
              key={f}
              type="button"
              title={title}
              aria-pressed={frame === f}
              className={`${seg} ${frame === f ? "bg-accent/25 text-ink" : "hover:text-ink"}`}
              onClick={() => onFrame(f)}
            >
              {label}
            </button>
          ))}
        </span>
        {hasAccel && (
          <label className="flex items-center gap-0.5" title="Draw gravity as the tag sees it">
            <input type="checkbox" className="h-3 w-3" checked={gravity} onChange={(e) => onGravity(e.target.checked)} />g
          </label>
        )}
        <span className="ml-auto flex gap-1">
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
        <h3 className="font-semibold">Frame</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Heading up</b> (default): level, and turned with the animal, so its heading always points the same way
            in the inset. Pitch and roll stay on the body. North is marked N on the ring; it swings round as the
            animal turns, and so does the current.
          </li>
          <li>
            <b>North up</b>: the compass frame. North stays fixed and the body turns with its heading.
          </li>
          <li>
            Neither is the fish's own (body-fixed) frame: there the body and the through-water arrow would never
            move. Both frames are level: up in the inset is up in the water.
          </li>
        </ul>
        <h3 className="font-semibold">Attitude</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Roll</b>: positive with the right side down. <b>Pitch</b>: positive nose up. Both come from the tag's
            static (gravity) acceleration.
          </li>
          <li>
            <b>Yaw</b>: the heading, degrees clockwise from magnetic north, from the tilt-compensated magnetometer.
            No magnetic declination is applied.
          </li>
          <li>
            Past 80 degrees of pitch the heading is a gimbal singularity: roll turns to noise and the heading jumps
            freely. The body is still drawn from pitch and roll, but the arrows that depend on the heading turn gray,
            and yaw reads undefined.
          </li>
        </ul>
        <h3 className="font-semibold">Vectors</h3>
        <ul className="space-y-1">
          <li>
            <Swatch k="water" />
            <b>Through water</b>: the speed dead reckoning used (often a constant), along the heading, horizontal.
          </li>
          <li>
            <Swatch k="current" />
            <b>Current</b>: the ocean model's current at the animal's depth, as applied to the track.
          </li>
          <li>
            <Swatch k="ground" />
            <b>Over ground</b>: their sum, the velocity dead reckoning integrated. The ring is 1 m/s at the arrow
            scale chosen under Controls (one body length per 1 m/s by default).
          </li>
          <li>
            <Swatch k="dynamic" />
            <b>Dynamic acceleration</b>: the tag's acceleration minus its gravity estimate, from the body axes into
            the frame shown. The track bundle is sampled at 1 Hz, while tail beats run at about 16 to 25 Hz in the
            raw data: this is a snapshot of a fast signal, aliased, not a trend. Read its size, not its rhythm.
          </li>
          <li>
            <Swatch k="gravity" />
            <b>Gravity</b> (the g toggle): the tag's static (low-passed) acceleration, which points along gravity.
            It points straight down when the drawn attitude matches the accelerometer.
          </li>
          <li>
            Accelerations are drawn at {ACCEL_SCALE} body lengths per 1 m/s{"²"} (gravity is about 2 body
            lengths), whatever the velocity scale, and labeled in m/s², converted from g for runs that report g. Acceleration arrows need a track exported with them.
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
