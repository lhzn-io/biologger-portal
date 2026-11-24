/**
 * The physics inspector's header, on top of the inset: one ribbon with snapping the camera behind or to the right,
 * a second pane at right angles, double size, gravity and the slip vectors, and in its corner the (i) explainer and
 * closing it.
 */
import { useRef, type RefObject } from "react";
import { GuideLink } from "../components/GuideLink";
import type { InspectorCamera } from "./inspector";
import { ACCEL_SCALE, ARROW_COLORS, INSET, insetBox } from "./inspectorView";

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

/**
 * The (i) explainer: what the inset draws and which part of the track each item comes from. It assumes no
 * reconstruction method (tracks come from several), and is laid out in two columns so it fits without scrolling.
 */
function InspectorInfo({ ref }: { ref: RefObject<HTMLDialogElement | null> }) {
  const section = "break-inside-avoid space-y-1 pb-3";
  return (
    <dialog
      ref={ref}
      className="m-auto max-h-[92vh] w-[min(56rem,94vw)] max-w-none overflow-y-auto rounded border border-line bg-panel p-0 text-sm text-ink backdrop:bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close(); // a click on the backdrop closes it
      }}
    >
      <div className="p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Physics inspector</h2>
          <button type="button" className="text-muted hover:text-ink" onClick={() => ref.current?.close()} aria-label="Close">
            {"×"}
          </button>
        </div>
        <div className="gap-6 md:columns-2">
          <div className={section}>
            <h3 className="font-semibold">Orientation</h3>
            <p>The inset turns with the animal; N on the ring marks north. Up is up.</p>
          </div>
          <div className={section}>
            <h3 className="font-semibold">Attitude</h3>
            <p>
              <b>r</b> roll, right side down positive. <b>p</b> pitch, nose up positive. From the tag&apos;s
              accelerometer.
            </p>
            <p>
              <b>y</b> yaw: the track&apos;s heading, clockwise from north. The body is drawn at it.
            </p>
            <p>
              <b>hdg</b>, <b>pin</b>: on a track turned and scaled to end at its end fix, the heading on the map, and
              that turn and scale.
            </p>
            <p>Past 80° of pitch the heading is undefined: arrows that need it turn gray.</p>
          </div>
          <div className={section}>
            <h3 className="font-semibold">Camera</h3>
            <p>
              <b>Side</b> (default) and <b>Behind</b> follow the animal: pitch and roll read against the ring.
            </p>
            <p>
              <b>Drag</b> to turn the view, wheel to zoom, <b>double-click</b> for Side. <b>Both</b>: a second pane
              at 90°.
            </p>
            <p>
              <b>2x</b> doubles the inset. Brighter parts of the body are nearer you.
            </p>
          </div>
          <div className={section}>
            <h3 className="font-semibold">Vectors (m/s; accelerations m/s²)</h3>
            <p>
              <Swatch k="water" />
              <b>swim</b>: the track&apos;s speed through the water, drawn along the yaw, level. Measured, modeled or
              set, by method.
            </p>
            <p>
              <Swatch k="current" />
              <b>current</b>: the current the track applied. <Swatch k="ground" />
              <b>ground</b>: swim plus current.
            </p>
            <p>
              <Swatch k="vertical" />
              <b>vert</b>: from the depth record, up positive. Measured; a few cm/s of sensor jitter.
            </p>
            <p>
              <Swatch k="dynamic" />
              <b>dynamic</b>: the accelerometer minus gravity, one sample a second of a faster signal: read its size,
              not its rhythm.
            </p>
            <p>
              <Swatch k="gravity" />
              <b>gravity</b> (g): the tag&apos;s static acceleration; straight down when the attitude is right.
            </p>
            <p>
              Ring: 1 m/s. Accelerations: {ACCEL_SCALE} body lengths per m/s².
            </p>
          </div>
          <div className={section}>
            <h3 className="font-semibold">Slip</h3>
            <p>
              <Swatch k="axis" />
              <b>axis</b>: where the head points. <Swatch k="path" />
              <b>path</b>: ground plus vert.
            </p>
            <p>
              <b>attack</b>: nose above the path, positive. <b>slip</b>: path to the animal&apos;s right, positive. In
              body axes, so roll mixes them.
            </p>
          </div>
        </div>
        <p className="text-muted">
          <GuideLink to="viewer.html#physics-inspector">More in the guide</GuideLink>
        </p>
      </div>
    </dialog>
  );
}
