Ocean currents and track comparison
===================================

A deployment can carry several reconstructions of the same tag data. They differ in how the
track is placed (dead-reckoned from the start fix, or pinned to the end fix) and in whether
the ocean current was added. The biologger-sim documentation explains the method
(`Tracks and ocean currents <../sim/tracks.html>`_); this page explains what the portal shows of
it. Code links point to lhzn-io/biologger-portal on GitHub at the commit this guide was built
from.

How the current enters a track
------------------------------

Dead reckoning moves the animal through the water; the water moves too. biologger-sim samples
the model current once a minute along the dead-reckoned track, at the animal's depth, and adds
it to each step of the swim. That happens before the track is placed on the fixes. A pinned
track therefore ends on the end fix with or without the current: for pinned tracks the current
changes the shape of the path and how much stretching and turning the pinning needs, not where
it ends.

The ocean model is chosen by forcingkit, the service that serves it: NECOFS (FVCOM, UMass
Dartmouth) on the Northeast shelf, HYCOM where NECOFS has no coverage. NECOFS resolves the
shelf break with triangles about 1.5 km on a side, finer along the slope and the canyons; the
Rutgers DOPPIO model, shown beside it in some reviews, has cells of about 7 km and is not used
for the tracks. Neither model is a measurement, and neither resolves a canyon a few kilometers
wide well. Credit NECOFS/UMASSD (and DOPPIO, Rutgers, when it is shown) wherever a current is
shown.

The current on a track page
---------------------------

When a track was exported with the current correction, its track page adds:

- **Ocean current at the animal (m/s)**, a chart under the others: the speed of the model
  current the track was corrected with, and its eastward and northward components, with the
  median and 95th percentile speed in the chart's summary. Stretches where the model had no
  value (on land, below the model's seafloor, or outside its grid) are shaded; the track used
  still water there. The chart's note names the ocean model actually used (for example NECOFS
  or HYCOM). (:src:`web/src/viewer/Charts.tsx`)
- **Ocean current speed**, a track coloring in the scene controls: the track is drawn pale
  green at zero to dark green at the scale's top, averaged over each drawn stretch, and gray
  where the model had no value. The top is the 98th percentile of the stretch means, rounded up
  to a step of 0.05, 0.1, 0.25, 0.5 or 1 m/s so that the legend has at most five ticks. The
  legend, "Ocean current (m/s)", names the model and the averaging time.
  (``currentScale`` and ``currentColor`` in :src:`web/src/viewer/current.ts`)
- The readout at the playhead, "Ocean current (model)", gives the current's speed and the
  direction it flows toward.

These are the model's current, not a measurement, at the model's resolution. A track without
the correction shows none of these, and its controls say so.

Comparing reconstructions
-------------------------

A deployment with more than one track links to ``/deployments/<id>/compare`` ("Compare the N
tracks"). The page has three parts (:src:`web/src/routes/ComparePage.tsx`, with the numbers
from :src:`web/src/viewer/compare.ts`).

**The table**, one row per track. Tracks with a pipeline record are shown; older exports,
labeled "earlier export, no pipeline record", are listed but hidden until ticked (when no track
has a pipeline record, all are shown). Click a row to put the animal on that track.

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
     - How far the current alone moved the track by its end, and toward which bearing
   * - Miss before pinning
     - Distance from the dead-reckoned track (with the current, when applied) to the end fix
       at the fix's time (``end_fix_miss_before_placement``)
   * - Pinning
     - Fix pinning's stretch (scale) and turn (degrees) to bring the track onto the end fix
   * - Below seafloor
     - Share of the samples over the fused DEM that lie more than 10 m below it, and the
       deepest. A reconstruction that puts dives inside the seabed is wrong there.
   * - Simulator
     - The biologger-sim commit that made the track, marked if the tree was dirty

**The 3D view.** The selected track carries the animal; every other visible track is drawn in
its own color with an outlined dot at the same moment, so the gap between reconstructions shows
as they play. Dead-reckoned tracks are pink (deep pink with the current, light pink without),
pinned tracks orange with the current and pale amber without, fix-to-fix interpolations green,
and older exports violet or gray. Play, speed, vertical exaggeration and a time slider sit under
the view.

**Along the tracks**, two charts on the shared timeline:

- The animal's depth against the seafloor under each track. Where a track's seafloor line
  rises above the depth line, that track has the animal inside the seabed.
- Each track's distance from the selected one over time.

The table and each chart can be collected (see "Collect, then ask your AI") with their numbers
as text.

Reading the comparison
----------------------

- The **miss before pinning** of the dead-reckoned tracks is the accumulated error of the tag
  alone. If the current-corrected miss is smaller, the current may explain part of it, but see
  the last point.
- Pinned tracks end on the end fix by construction, with or without the current. Compare their
  **pinning** instead: a scale near 1 and a small turn mean the reconstruction needed little
  forcing to meet the fix.
- The **below seafloor** share is an independent check that no reconstruction is fitted to.
- The current is sampled once, along the dead-reckoned track, before pinning. A large
  **current drift at end** or a large pinning turn means the final track runs kilometers from
  where its current was sampled. For RED001 (biologger-sim 87b294f), pinning turns the
  current-corrected track by 57 degrees and the pinned track runs a median of 11.6 km from where
  its current was sampled; the NECOFS current re-sampled along the pinned track gives 1.8 to
  2.1 km of drift (depending on the grid read) instead of the 6.7 km that was applied. Read such a track as "with the model current
  along the dead-reckoned path", not as the current the animal met, and do not credit a smaller
  miss to the current until the correction is iterated (place, re-sample, place again). The
  simulator's documentation gives the figures, their source and the script that recomputes
  them (`Known limit: where the current is sampled <../sim/tracks.html#known-limit-where-the-current-is-sampled>`_).
