Release notes
=============

What changed in each version of the portal, newest first. The version is shown at the top right of every page
(``server`` on the hub; in the published viewer, hover over the snapshot time). Code for each release is tagged
in the repository: `releases on GitHub <https://github.com/lhzn-io/biologger-portal/releases>`_.

.. _v0.2.0:

0.2.0 (2026-11-19)
------------------

Physics inspector
^^^^^^^^^^^^^^^^^

The inset beside the 3D view (Physics, at its top right) now reads attitude directly.

- **Side** (the default) looks from the animal's right, so pitch reads against the level ring; **Behind** looks
  along its heading, so roll does. **Both** adds a second pane at right angles: Behind with Side, or Side with the
  front.
- **Drag** on the inset to turn the view about the animal; the wheel zooms. A drag turns Side or Behind off; a
  **double-click** returns to Side. The inset always turns with the animal, and N on the ring marks north.
- **slip** draws the body's long axis and the direction of travel, with the angle of attack and the sideslip
  between them.
- A new violet **vert** arrow is the vertical speed from the depth record, up positive. Dead reckoning's set speed
  (1 m/s on most tracks) is horizontal only, so this is the measured vertical part of the motion.
- Arrows are thin lines with their values beside the tips. The legend is shorter (swim, current, ground, vert,
  dynamic, gravity), the readout is roll, pitch and yaw (``r p y``), and tracks pinned to their end fix add the
  heading on the map. The (i) button explains every label.
- **2x** doubles the inset.

Track page
^^^^^^^^^^

- **Double-click the track** in the 3D view to move the time, and the animal, to that point.
- In **Studio** and full screen, a **timeline strip** at the bottom left shows the series you pick (depth, pitch,
  roll, VeDBA, ODBA, speeds, dynamic acceleration) over the whole track, with night shaded and the fixes marked.
  Click or drag on it to move the time; the arrow keys step (Shift for larger steps).
- **Roll by depth** shows how much of the time the animal spent in each depth band, beside each row.
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
