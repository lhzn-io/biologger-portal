Ocean currents and track comparison
===================================

A deployment can carry several reconstructions of the same tag data. They differ in how the
track is placed and in whether the ocean current was added. A track is either dead-reckoned
from the start fix, or pinned (stretched and turned so that it ends on the end fix). The
biologger-sim documentation explains the method
(`Tracks and ocean currents <../sim/tracks.html>`_). This page explains what the portal shows.
Code links point to lhzn-io/biologger-portal on GitHub at the commit used to build this guide.

How the current enters a track
------------------------------

Dead reckoning moves the animal through the water, but the water also moves. biologger-sim
adds the model current to each step of the swim. It samples the current at the animal's depth
and time every 60 s, in passes:

- Pass 1 samples along the through-water dead-reckoned track.
- Each later pass samples along the track that the previous pass placed.
- The passes stop when the placed track moves less than ``convergence_m`` (50 m) between
  passes, or when ``max_passes`` is reached (30 by default).

The simulator documentation gives the full method
(`Where the current is sampled <../sim/tracks.html#where-the-current-is-sampled>`_).

Each pass adds the current before it places the track on the fixes. A pinned track therefore
ends on the end fix with or without the current. For pinned tracks, the current changes the
shape of the path and how much stretching and turning the pinning needs, but not where the
track ends.

forcingkit, the service that serves the ocean model, chooses the model. It uses NECOFS (FVCOM,
UMass Dartmouth) on the Northeast shelf, and HYCOM where NECOFS has no coverage. NECOFS
resolves the shelf break with triangles about 1.5 km on a side, and with finer triangles along
the slope and the canyons. The Rutgers DOPPIO model, shown beside NECOFS in some reviews, has
cells of about 7 km and is not used for the tracks. Neither model is a measurement. Neither
model resolves well a canyon that is only a few kilometers wide. Credit NECOFS/UMASSD (and
DOPPIO, Rutgers, when it is shown) wherever the portal shows a current.

The current on a track page
---------------------------

When a track was exported with the current correction, its track page adds:

- **Ocean current at the animal (m/s)**, a chart below the other charts. It shows the speed of
  the model current used to correct the track, and the current's eastward and northward
  components. The chart's summary gives the median and 95th percentile speed. Stretches where
  the model had no value (on land, below the model's seafloor, or outside its grid) are shaded,
  and the track used still water there. The chart's note names the ocean model that was used
  (for example NECOFS or HYCOM). (:src:`web/src/viewer/Charts.tsx`)
- **Ocean current speed**, a track coloring in the scene controls. The track is drawn from pale
  green at zero to dark green at the top of the scale, averaged over each drawn stretch, and
  gray where the model had no value. The top of the scale is the 98th percentile of the stretch
  means, rounded up to a step of 0.05, 0.1, 0.25, 0.5 or 1 m/s so that the legend has at most
  five ticks. The legend, "Ocean current (m/s)", names the model and the averaging time.
  (``currentScale`` and ``currentColor`` in :src:`web/src/viewer/current.ts`)
- The readout at the playhead, "Ocean current (model)", gives the speed of the current and the
  direction in which it flows.

All three show the model current at the model's resolution, not a measurement. A track without
the correction shows none of them, and its controls say so.

Comparing reconstructions
-------------------------

A deployment with more than one track links to ``/deployments/<id>/compare`` ("Compare the N
tracks"). The page has three parts (:src:`web/src/routes/ComparePage.tsx`, with the numbers
from :src:`web/src/viewer/compare.ts`).

**The table**, one row per track. Tracks with a pipeline record are shown. Older exports,
labeled "earlier export, no pipeline record", are listed but hidden until you tick them. When no
track has a pipeline record, all tracks are shown. Click a row to put the animal on that track.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Column
     - Meaning
   * - Track
     - Its label from the pipeline record (placement, and current model if any), its color,
       and its run ID, linked to the track page
   * - Current
     - The ocean model, and the share of the record where it had no value
   * - Current drift at end
     - How far the current alone moved the track by the end of the record, and the bearing of
       that drift
   * - Miss before pinning
     - Distance from the dead-reckoned track (with the current, when applied) to the end fix
       at the fix's time (``end_fix_miss_before_placement``)
   * - Pinning
     - The stretch (scale) and turn (degrees) that pinning applies to bring the track onto the
       end fix
   * - Below seafloor
     - Share of the samples over the fused DEM (digital elevation model) that lie more than
       10 m below the DEM surface, and the deepest of them. A reconstruction that puts dives
       inside the seabed is wrong there.
   * - Simulator
     - The biologger-sim commit that made the track, marked if the tree was dirty

**The 3D view.** The selected track carries the animal. Every other visible track is drawn in
its own color, with an outlined dot at the same moment, so the gap between reconstructions shows
as they play. The colors are:

- Dead-reckoned tracks: deep pink with the current, light pink without.
- Pinned tracks: orange with the current, pale amber without.
- Fix-to-fix interpolations: green.
- Older exports: violet or gray.

Controls for play, speed and vertical exaggeration, and a time slider, sit under the view.

**Along the tracks**, two charts on the shared timeline:

- The animal's depth against the seafloor under each track. Where a track's seafloor line
  rises above the depth line, that track has the animal inside the seabed.
- Each track's distance from the selected one over time.

You can collect the table and each chart, with their numbers as text (see "Collect, then ask
your AI").

Reading the comparison
----------------------

- The **miss before pinning** of the dead-reckoned tracks is the accumulated error of the tag
  alone. If the current-corrected miss is smaller, the current may explain part of it, but see
  the last point.
- Pinned tracks end on the end fix by construction, with or without the current. Compare their
  **pinning** instead. A scale near 1 and a small turn mean that the reconstruction needed
  little forcing to meet the fix.
- The **below seafloor** share is an independent check, because no reconstruction uses the
  seafloor in its fit.
- biologger-sim samples the current in passes, each along the track the previous pass placed,
  until the placed track stops moving. Check the ``current_correction`` step in the track's
  pipeline record. If ``converged`` is false, the passes ran out before the track settled, and
  the current was sampled up to the last pass's shift (``pass_shift_max_m``) away from the drawn
  track. Keep that distance in mind before crediting a smaller miss to the current. The
  simulator's documentation describes the passes and gives the RED001 figures
  (`Where the current is sampled <../sim/tracks.html#where-the-current-is-sampled>`_).
