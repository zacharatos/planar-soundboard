# Changelog

All notable changes to this module. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).
The release workflow uses the section matching the tag as the GitHub release notes, so keep the `## [x.y.z]` headings exact.

## [1.3.1]

### Changed
- CI and release workflows use `actions/checkout@v5` and `actions/setup-node@v5`; CI runs with read-only repository permissions. Nothing changes in Foundry.

## [1.3.0]

Less load on the server's upload during play: players' connections stay smoother.

### Added
- **Automatic preload.** The cue the GO pointer sits on is preloaded on every client (5 s after the previous cue fired, so it doesn't compete with that cue's sounds). A soundscape's pads and scatter sounds are preloaded 5 s after it starts. A player who joins or reloads gets the active pads and the global pads.
- **Heavy-file warning.** The Preload button now names files that are uncompressed (`.wav`, `.flac`, `.aiff`) or larger than 8 MB, the ones that make everyone's connection lag while players download them.

### Changed
- **Preload loads one file at a time on each client** and skips files that client already loaded, instead of firing every download at once. It goes over the module socket now; only a GM can ask.

### Fixed
- **Narration ducking no longer restarts a fade every second** on every player's browser. It fades again only when the target volume changes (e.g. the track's volume is moved) or the sound drifted away after our fade ended, at most three times per sound.
- **Combat automation runs on the active GM only.** With two GM tabs open, Begin Combat ran twice and could make the end of combat return to the combat music.
- Soundscapes are no longer copied and re-normalised on every lookup; they're cached until the setting changes (the panel refreshes faster with many scapes).

## [1.2.0]

First release from the GitHub repository.

### Added
- Greek interface (`lang/el.json`). The soundboard follows Foundry's language setting.
- Install and update through a manifest URL (Add-on Modules → Install Module).

### Changed
- All interface text moved into `lang/en.json` and `lang/el.json`; nothing is hard-coded in the scripts any more.
- Example names in the interface (filter hints, placeholders, empty states) no longer refer to a particular setting.
- Script files renamed to `.mjs`.
- Compatibility declared as Foundry V14, the version it is tested on.

## [1.1.1]

### Fixed
- The Cues tab could not be opened: the tab buttons used an action name Foundry reserves for its own tabs.

## [1.1.0]

### Added
- Planar Filters: eight live effects (Muffled, Underwater, Cavern, Vast Hall, Ethereal, Memory, Deafened, Sending) for everyone or chosen players, and a filter per soundscape.
- Cue lists: GO (Alt+G), step back, auto-follow, `@Cue[…]` and `@Scape[…]` journal buttons, and a *Run macro* action.
- Drag and drop sound files from your computer onto pads and editor sections; they are uploaded to the server.
- Fade lengths in 0.1 s steps; 0.25 s and 0.5 s in the toolbar.

### Fixed
- The mixer no longer stops refreshing after clicking a volume slider without dragging it.

## [1.0.0]

### Added
- Soundscapes with music, ambience loops, scatter sounds and pads on the Music, Ambient and Interface channels.
- Crossfades and dips between soundscapes; layers and sticky layers.
- Narrate (ducking) and Muffle.
- Scene-linked soundscapes and a combat soundscape with automatic return.
- Global pads, Alt+1…9 hotkeys, preload on all clients, JSON export and import.
- Macro API (`PlanarSoundboard`).
