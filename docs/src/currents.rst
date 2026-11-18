Ocean currents and track comparison
===================================

A deployment can carry several reconstructions of the same tag data. They differ in how the
track is placed (dead-reckoned from the start fix, or pinned to the end fix) and in whether
the ocean current was added. The biologger-sim documentation explains the method ("Tracks and
ocean currents"); this page explains what the portal shows of it.

The current on a track page
---------------------------

When a track was exported with the current correction, its track page adds:

- **Ocean current at the animal (m/s)**, a chart under the others: the speed of the model
  current the track was corrected with, and its eastward and northward components, with the
  median and 95th percentile speed in the chart's summary. Stretches where the model had no value (on land, below the
  model's seafloor, or outside its grid) are shaded; the track used still water there. The
  chart's note names the ocean model actually used (for example NECOFS or HYCOM).
- **Ocean current speed**, a track coloring in the scene controls: the track is drawn pale
  green at zero to dark green at the track's 98th percentile (rounded up), averaged over each
  drawn stretch, and gray where the model had no value. The legend shows the scale and the
  model.
- The readout at the playhead gives the current's speed and the direction it flows toward.

These are the model's current, not a measurement, at the model's resolution. A track without
the correction shows none of these, and its controls say so.

Comparing reconstructions
-------------------------

A deployment with more than one track links to ``/deployments/<id>/compare`` ("Compare the N
tracks"). The page has three parts.

**The table**, one row per track. Tracks with a pipeline record are shown; older exports are
listed but hidden until ticked. Click a row to put the animal on that track.

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
     - Distance from the end of the dead-reckoned track to the end fix
   * - Pinning
     - Fix pinning's stretch (scale) and turn (degrees) to bring the track onto the end fix
   * - Below seafloor
     - Share of samples more than 10 m below the fused DEM under the track, and the deepest.
       A reconstruction that puts dives inside the seabed is wrong there.
   * - Simulator
     - The biologger-sim commit that made the track, marked if the tree was dirty

**The 3D view.** The selected track carries the animal; every other visible track is drawn in
its own color with an outlined dot at the same moment, so the gap between reconstructions shows
as they play. Pinks are dead-reckoned and ambers pinned, the stronger shade with the current.
Play, speed, vertical exaggeration and a time slider sit under the view.

**Along the tracks**, two charts on the shared timeline:

- The animal's depth against the seafloor under each track. Where a track's seafloor line
  rises above the depth line, that track has the animal inside the seabed.
- Each track's distance from the selected one over time.

Each panel can be collected (see "Collect, then ask your AI") with its numbers as text.

Reading the comparison
----------------------

- The **miss before pinning** of the dead-reckoned tracks is the accumulated error of the tag
  alone. If the current-corrected miss is smaller, the current explains part of it.
- Pinned tracks end on the end fix by construction, with or without the current. Compare their
  **pinning** instead: a scale near 1 and a small turn mean the reconstruction needed little
  forcing to meet the fix.
- The **below seafloor** share is an independent check that no reconstruction is fitted to.
- The current is sampled once, along the dead-reckoned track, before pinning. A large
  **current drift at end** or a large pinning turn means the final track runs kilometers from
  where its current was sampled (for RED001, a median of 11.6 km). Read such a track as "with
  the model current along the dead-reckoned path", not as the current the animal met.
