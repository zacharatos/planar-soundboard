# Development

## Layout

```
module.json            manifest (id = planar-soundboard; the id is permanent once published)
scripts/
  main.mjs             hooks (init, ready, scenes, combat), keybindings, @Cue/@Scape enricher, macro API
  store.mjs            data: soundscape shape and normalisers, world settings, lookups, file uploads
  engine.mjs           playback: crossfades through Playlist updates, layers, scatter timers, pads,
                       narrate ducking, the filter state the GM broadcasts, scene and combat automation
  filters.mjs          each client: puts filter nodes into the effect pipeline of every playing Sound
  fxgraph.mjs          the eight filter presets as Web Audio graphs (no Foundry globals)
  cues.mjs             cue lists: data, GO / back / auto-follow runner, action execution
  panel.mjs            the GM panel (ApplicationV2)
  editor.mjs           soundscape editor
  cue-editor.mjs       cue list editor
  i18n.mjs             t(), info(), warn(), error(); keys under PLANAR_SOUNDBOARD.*
styles/soundboard.css  styles, scoped to .ps-app
lang/en.json el.json   interface strings
tests/                 node:test; helpers/foundry-stub.mjs stands in for Foundry
tools/                 stamp-manifest, package, release-api, check-syntax
.github/workflows/     ci.yml, release.yml
docs/                  this file, PUBLISHING.md, README screenshots
```

There is no build step: Foundry loads `scripts/main.mjs` directly.

## Run the checks

```
npm test
```

This runs a syntax check on every `.mjs` file, then:

- `manifest.test.mjs`: manifest fields, referenced files exist, `en.json` and `el.json` have the same keys and placeholders, every key used in the code exists, no hard-coded notifications.
- `soundscapes.test.mjs`: switching, crossfades in one update, shared sounds kept, layers and sticky layers, combat and scene automation, pads, narrate, silence, panel and editor rendering.
- `features.test.mjs`: filters (targets, hold, per-scape), cue lists (GO, auto-follow, back, firing by name), uploads, the journal enricher, the cue tab and cue editor.
- `performance.test.mjs`: preload over the socket (dedupe, GM-only, addressed), what a joining player gets, cue preload paths, the heavy-file check, the soundscape cache, ducking without repeated fades, combat automation on the active GM only.
- `tools.test.mjs`: the release tooling.

The rendering tests use the real `lang/en.json` and fail if any key is missing.

These tests do not start Foundry or play audio. Anything that touches sound, the Web Audio filters, sockets or the file picker has to be tried by hand (below).

To refresh the README screenshots: `node tests/helpers/shots.mjs <folder>` writes four HTML pages with sample data; open them in a browser at the sizes in the script and screenshot them into `docs/images/`.

## Try it in Foundry

Put (or symlink) the repo into your user data as `Data/modules/planar-soundboard/` and restart the world:

```
ln -s /path/to/repo /path/to/FoundryData/Data/modules/planar-soundboard
```

Reload the browser tab (F5) after each change; there is no hot reload. For the filters and anything players hear, keep a second browser (or a private window) logged in as a player.

### Manual test checklist

Soundscapes
- New soundscape with a track, two ambience loops, a scatter layer and two pads; Save & play: everything starts, ambience loops.
- Switch to a second scape that shares one ambience track: music crossfades, the shared track keeps playing (only its volume changes), the rest fades out.
- Toolbar fade *Cut* and *0.25 s*: switches are instant / short. A scape with *Dip*: old sound fades out fully before the new one fades in.
- Shift-click a sticky scape (rain): it layers on top; switching the base keeps it; Shift-click again removes it.
- Start a track by hand from the Playlists sidebar, then switch scape: it fades out (with *Switching takes over…* on).
- Linked scene: activate it, the scape starts. Begin Combat: combat scape; end the encounter: the previous scape and layers come back.

Pads and scatter
- Pad with Duck: music dips under it and comes back. Loop pad: second click stops it; right-click stops any pad.
- Alt+1…9 fire the pads in the order the badges show.
- Scatter layer at 5–10 s: one-shots arrive at random times on the player's client too.
- Drag two audio files from the desktop onto a pad bank: two pads, files in `Data/soundboard-uploads/<scape>/`. A `.txt` file is refused.

Filters (listen on the player's client)
- Each of the eight presets for **Everyone**: audible, no clicks or silence when turning on and off.
- Memory for one player only: that player hears it, the GM and other players do not.
- Deafened: ringing, then recovers by itself. Muffle button and Alt+M toggle *Muffled* for everyone.
- A scape with a filter: on while active, off after switching away.
- A player joining while a filter is on gets it within a few seconds.

Narrate and cues
- Narrate (Alt+N) dips music and ambience for players and restores them.
- Cue list: GO fires cues in order; auto-follow fires the next one; step back works; ▶ fires a cue without moving the pointer.
- Copy a cue's journal link, paste it into a journal page: the GM sees a ▶ button that fires it; a player sees nothing. `@Scape[name]` crossfades.
- *Run macro* action runs the macro.

Other
- Preload with a player connected: their network tab shows the files loading **one after another**, not all at once. A scape with a `.wav` or a file over 8 MB: a warning names the heavy files.
- Put the cue pointer on a cue (click it, or fire the one before): within ~5 s the player's network tab shows that cue's files loading. Firing it then plays without a download.
- Switch to a scape with pads and scatter: ~5 s later the player's network tab loads the pad and scatter files; pressing a pad then plays at once.
- A player reloads while a scape is active: a few seconds after they're back, their network tab loads the active pads and the global pads.
- Narrate on for a minute with music playing: in the player's console, no repeated volume fades (the music stays steady at the ducked level). Change the track's volume in the panel while narrating: it re-ducks to the new level.
- Two GM tabs open, Begin Combat: the combat scape starts once, and ending combat returns to the previous scape (not to the combat scape).
- Export, delete a scape, Import: it comes back. Cue lists come back too.
- Switch Foundry's language to Ελληνικά: the panel, editors, settings and keybindings are in Greek.
- Log in as a player: no Soundboard button; `PlanarSoundboard.open()` says it's GM-only.

## Changing things

- **New user-facing text**: add the key to `lang/en.json` and `lang/el.json` and use `t("Group.Key")` (or `info` / `warn` / `error` for notifications). The tests fail if a key is missing in either file.
- **Action names in templates** (`data-action="…"`): don't use names Foundry's ApplicationV2 handles itself, such as `tab`, `close`, `toggleControls`. 1.1.0 lost the Cues tab that way.
- **Data shape**: soundscapes and cue lists are arrays in world settings (`soundscapes`, `cueLists`), passed through `normScape` / `normCueList` on every read, so new fields need a default there. If a shape changes in a way defaults can't cover, write a migration: people have scapes built with older versions.
- **Playback** goes through Playlist documents (`executePlan` in `engine.mjs`): set `playing`, `fade` and `volume` in one `Playlist#update` so Foundry syncs and fades it on every client. One-shots use `AudioHelper.play(…, true)`.
- **Filters** are inserted with `Sound#applyEffects`. Something else may replace the pipeline, so `filters.mjs` re-checks every 500 ms while a filter is on.
- **Preload** goes over the module socket (`preloadPaths` in `engine.mjs`): the GM sends a list of files, each client loads them with `AudioHelper.preloadSound` (local only) one at a time and skips files it already has. Automatic preloads: the next cue on the GO pointer, a scape's pads and scatter 5 s after it starts, and the active pads for a player who joins. Never preload on a timer: every player downloads every file from the server, and on a home server that shares the house upload, bursts are what make everyone's connection lag.
- **Soundscapes** are read through a cache rebuilt when the `soundscapes` setting changes (`invalidateScapes` in its `onChange`); `getAllScapes` / `findScape` return copies, so callers may change what they get.
- **Ducking** remembers the volume it aimed for on each sound and fades again only when that target changes or the sound drifted away after our fade finished (at most 3 corrections per sound).

## Versions

Follow [SemVer](https://semver.org/). Update `CHANGELOG.md` first, then tag. Compatibility lives in `module.json` (`minimum`, `verified`); raise `verified` only after testing on that Foundry version.
