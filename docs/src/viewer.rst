Reading the viewer
==================

The viewer's pages keep their text short and link here. This page explains what each part shows and
how it is made. The method behind the tracks is in the biologger-sim documentation
(`Tracks and ocean currents <../sim/tracks.html>`_).

Track pages
-----------

A track page shows one reconstruction of a deployment: the readout at the cursor, the 3D view, and
the charts along the track (:src:`web/src/routes/TrackPage.tsx`).

**What a track is.** Only the start and end fixes are measured positions. Every position between them
is reconstructed by the track model named in the header (``dead_reckoning``, ``fix_pinned`` or
``fix_interpolation``), not observed. The seafloor depths in the readout and the charts are read from
the fused DEM (digital elevation model) at the reconstructed position, so they are only as good as
the position.

**The header** gives the track model, the sample count and rate, and the run ID. It adds:

- "uncommitted simulator changes" when the exporting biologger-sim checkout had uncommitted changes
  (``sim_git_dirty``), so the commit alone does not reproduce the track;
- "replacing <run>" when the link named an older run that a re-export has replaced (links resolve by
  run name);
- a warning when the current correction did not converge (see
  `How the current enters a track <currents.html#how-the-current-enters-a-track>`_).

**Playback.** Speed is seconds of track per second of playback (1x is real time). Type a speed from
0.1 to 86400 and press Enter, or step with the buttons or the up and down arrow keys. The camera
setting applies while the track plays: Chase follows from behind and turns with the animal; Orbit
stays on the animal at the angle you set (drag, or click the view and use A and D to turn, W and S to
tilt, Q and E to zoom).

**Terrain.** The first view of a track can take up to a minute while the hub fetches its
topobathymetry; later views are cached.

Tags without a magnetometer
---------------------------

A tag that recorded no magnetometer has no heading, so biologger-sim cannot dead-reckon it, with or
without the ocean current. It places the track by interpolating between the start and end fixes
(``fix_interpolation``), and the deployment page shows no comparison. On its track page the heading
in the readout is the bearing between the fixes, labeled "fix bearing; no magnetometer".

Charts
------

The charts share the track's timeline: click or drag across any chart to move the cursor. The (i)
button on a chart gives a one-line reading; the details are below.

Roll angle
~~~~~~~~~~

How far the fish is tipped onto its side: 0 is upright, above zero right side down (+90 on its right
side), below zero left side down. For each drawn interval, each side gets its own median line and
10 to 90 percent range, counting only rolls past 20 degrees (nearer upright counts to neither side).
A single signed median of both sides would fall between two humps and read as upright, so the sides
are kept apart. A side's line is faint where it holds under 25 percent of the interval. Hover for
each side's share of the interval. The summary gives the share of the whole record spent right side
down and left side down. Roll is the accelerometer's static (gravity) roll, smoothed over about 2 to
3 s by the simulator: posture, not tailbeat.

Cumulative roll
~~~~~~~~~~~~~~~

The running total of roll, in turns. A fish that spins climbs past the whole-turn rules; one that
rocks stays in a band. A turn counts when the total passes 360 degrees (plus 30 degrees for the first
turn in a direction). The rug marks each turn, pink right side down and blue the other way.

Roll cannot be trusted where pitch is beyond 65 degrees (roll is undefined near vertical), where it
jumps more than 135 degrees in one sample, or across a gap. The total holds through each such
stretch, then resumes by the shortest rotation to the next good sample, so no turn is counted inside
one; the turns registered inside are set aside. The dashed line and gray band mark these bridges.
What the fish did inside a bridge is unknown, and the change across it can be wrong by up to half a
turn near vertical (more across a gap). Any such error carries into the rest of the line as an
offset, so read the level after a bridge as uncertain, and the rocking and climbing within good
stretches as sound.

When the export has no native-rate roll columns, the viewer unwraps the bundle's roll itself. That roll
is smoothed over about 2 to 3 s, so turns faster than about 0.3 revolutions per second are smoothed
away and spinning is under-reported. Exports with the native-rate columns are unwrapped by the
exporter at the tag's rate.

Roll by depth
~~~~~~~~~~~~~

Roll per depth band, with day and night on their own rows (day is the sun above the horizon at the
fish's position). Left side down is drawn to the left, right side down to the right. The center
gives the share of the band's time within 20 degrees of upright (shaded). For each side: the dot is
the median, the bar the middle half of the rolls past 20 degrees, and the figure the share of the
band's time on that side. Bars are fainter for small shares, and rows paler with under 10 minutes of
data; bands with under a minute are left out. On the right, the time in each row as a share of all
the time summarized, so each row's statistics can be weighed by how much data they stand on.

The ocean current chart is described with the other current displays
(`The current on a track page <currents.html#the-current-on-a-track-page>`_).

Current direction
-----------------

On a track with the current correction, arrows show where the water flows
(:src:`web/src/viewer/currentArrows.ts`):

- **Along the track** in the 3D view, as fine vectors: the head sits on the track and the shaft reaches back
  toward where the water comes from. Length grows linearly with speed up to full length at 0.5 m/s, on every
  track alike, and never falls below about a third of full length, so weak flow still shows its direction. Each arrow
  is the vector mean of the applied current over a stretch of track distance. The arrows show at every zoom,
  spaced along the track so neighbors do not overlap (sparse in a whole-scene view, denser as the view comes
  closer), and keep about the same size on screen. Where the track doubles back, arrows from different passes can
  sit close together.
  Stretches where the model had no value for more than half the samples get no arrow.
- **On the current chart**, a row of arrows along the top: the hourly mean direction, north up, colored by the
  hourly mean speed; hover for the values. The chart thins them to fit its width.

Arrow colors come from the standard currents ramp that the lab's other current displays use (cmocean "tempo"
hues; a fixed log scale from 0.02 to 3.1 m/s, so a color means the same speed on every track and product). The
ramp has a table for light backgrounds and a twin for dark ones; the arrows take the one that contrasts with what
is behind them: the dark twin over shallow (pale) seafloor and on a light page, the light table over deep (dark)
seafloor and on a dark page.

The arrows are on by default on every track with the current correction, and can be turned off under Controls
("Current arrows"); the setting is kept in the page's link. They are meant to be read against the track's ODBA
coloring: heading into the arrows at high ODBA is swimming against the current, low ODBA with the track bending
along them is coasting. Keep in mind that on runs whose through-water speed comes from ODBA (``odba_scaled``),
ODBA and the corrected track are not independent; the animal's heading against the arrows is the more independent
comparison. Like the rest of the current, the arrows show the model's current at the animal's depth, not a
measurement.

Hover readout
-------------

Resting the pointer on the track in the 3D view shows that sample's values: time, depth and height above the
seafloor, heading and pitch, ODBA, the through-water speed dead reckoning used, the applied current, and the
model's vertical current where the model gives one (:src:`web/src/viewer/hover.ts`). On a current arrow it shows what the arrow stands for: the mean current over its
stretch of track, the stretch's length and time span, and how much of it had no model value. Double-click the
track to move the cursor there. The readout hides while dragging the view; turn it off under Controls ("Hover
readout"), a setting kept in the page's link.

Physics inspector
-----------------

The Physics button opens an inset with the animal at the cursor time and the velocities and
accelerations its track gives (:src:`web/src/viewer/InspectorChrome.tsx`). Tracks come from different
methods, so some of the values depend on the method: the swim speed through the water is measured,
modeled or set, depending on the track model.

If the track takes the swim along the heading, sideslip comes only from the current and from climbing
while rolled. The inset's own (i) panel lists every symbol and arrow.
