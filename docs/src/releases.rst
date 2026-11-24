Release notes
=============

What changed in each version of the portal, newest first. Every page shows the version at the top
right and links it to these notes. On the hub, it reads ``server`` followed by the version number
(for example ``server 0.2.0``), which is the version that the hub's server reports. On the published
viewer, the top right shows the snapshot time instead; hover over it to see the version. Code for
each release is tagged in the repository
(`releases on GitHub <https://github.com/lhzn-io/biologger-portal/releases>`_).

.. _v0.3.0:

0.3.0 (2026-11-24)
------------------

Tracks
^^^^^^

- **Links survive re-exports.** A link to a track names the run, and a re-export of that run keeps the link
  working: it opens the published run of that name, else a shared one, else the newest. A link to a run that a
  re-export replaced opens the new run and says which one it replaced.
- **Current correction that did not converge is marked.** The track page says so, with the pass count and the
  last pass's shift, and the compare page adds "(not converged)" to the track's label and its copied table text.
  No shared track is in that state today.

Pages and guide
^^^^^^^^^^^^^^^

- **Shorter page text.** Each page keeps a line or two and links to this guide for the rest; every chart's (i)
  note links to its section.
- **New guide pages**: :doc:`viewer` (track pages, charts, the physics inspector) and :doc:`hub` (the editor
  pages). The currents page describes how the current is sampled in passes along the placed track.
- The physics inspector's (i) panel is shorter and assumes no particular track method.

.. _v0.2.0:

0.2.0 (2026-11-19)
------------------

Physics inspector
^^^^^^^^^^^^^^^^^

The inset beside the 3D view (Physics, at its top right) now reads attitude directly.

- **Side** (the default) looks from the animal's right, so pitch reads against the level ring. **Behind**
  looks along the animal's heading, so roll reads against the ring. **Both** adds a second pane at right
  angles, pairing Behind with Side, or Side with the front.
- **Drag** on the inset to turn the view about the animal, and use the wheel to zoom. A drag turns Side or
  Behind off, and a **double-click** returns to Side. The inset always turns with the animal, and N on the
  ring marks north.
- **slip** draws the body's long axis and the direction of travel, with the angle of attack and the sideslip
  between them.
- A new violet **vert** arrow shows the vertical speed from the depth record, up positive. Dead reckoning's
  set speed (1 m/s on most tracks) is horizontal only, so this arrow is the measured vertical part of the
  motion.
- Arrows are thin lines with their values beside the tips. The legend is shorter (swim, current, ground,
  vert, dynamic, gravity), and the readout is roll, pitch and yaw (``r p y``). Tracks pinned to their end
  fix add the heading on the map. The (i) button explains every label.
- **2x** doubles the inset.

Track page
^^^^^^^^^^

- **Double-click the track** in the 3D view to move the time, and the animal, to that point.
- In **Studio** and full screen, a **timeline strip** at the bottom left shows the series you pick (depth, pitch,
  roll, VeDBA, ODBA, speeds, dynamic acceleration) over the whole track, with night shaded and the fixes marked.
  Click or drag on it to move the time; the arrow keys step (Shift for larger steps).
- **Roll by depth** shows, beside each row, how much of the time the animal spent in that depth band.
- Numbers use one style: whole meters and degrees, speeds to 0.01 m/s, accelerations to 0.1 m/s². Distances from
  the start fix are in meters, and the heading reads 0 to 360 degrees.

.. _v0.1.0:

0.1.0 (2026-11-18)
------------------

The first release shared with the team.

- **Deployments**: the catalog with its map, each deployment's files and validation, and the metadata sheet.
- **Track viewer**: each reconstructed track on a map and in 3D over fused bathymetry, with the animal drawn by its
  species model; playback with chase and orbit cameras, studio and full screen; charts of depth, attitude, ODBA,
  roll by time and depth, and the applied ocean current, which you can click or scrub to move the view.
- **Compare** a deployment's reconstructions (dead reckoning, pinned to the end fix, with and without the ocean
  current) side by side.
- **Physics inspector**: the animal's attitude with its velocities and accelerations.
- **Collect, then ask your AI**: gather views and copy them with a prompt into the assistant you use.
- The **published viewer** for the team, and these guides at ``/docs``.
