# Publishing

Two separate steps. Step 1 gives anyone a working install link. Step 2 adds the module to Foundry's official package list, and is optional.

The module `id` (`planar-soundboard`) is permanent once published: it is the folder name on every user's server and the key for their saved soundscapes. As of 2026-10-04 no package with this id exists on foundryvtt.com.

## 1. Publish on GitHub

1. Create an empty repository `zacharatos/planar-soundboard` on GitHub (public, no README, so nothing conflicts).
2. In this folder:
   ```
   git init -b main
   git add .
   git commit -m "Planar Soundboard 1.2.0"
   git remote add origin git@github.com:zacharatos/planar-soundboard.git
   git push -u origin main
   ```
3. CI (`.github/workflows/ci.yml`) runs `npm test` and a package dry run on every push.
4. Make the first release. `CHANGELOG.md` already has a `## [1.2.0]` section, so:
   ```
   git tag v1.2.0
   git push origin v1.2.0
   ```
   `release.yml` runs the tests, builds `module.zip` and a stamped `module.json`, and attaches both to a GitHub release, using the changelog section as the notes.
5. Check that this URL downloads a JSON file:
   `https://github.com/zacharatos/planar-soundboard/releases/latest/download/module.json`

That URL is what people paste into Foundry's **Install Module → Manifest URL** box. It always points at the newest release, so installs and updates need no further work.

The workflow overwrites `version`, `url`, `manifest`, `download`, `bugs`, `readme`, `changelog` and `license` in the released `module.json` from the tag and repo name, so you never edit those by hand for a release.

### Moving your own server to the manifest install

Your server has the module from a zip, without a manifest URL, so Foundry can't update it. Once v1.2.0 is released:

1. In the world, **Export** from the soundboard panel (a backup; nothing should be lost, but it's cheap).
2. In Setup → **Add-on Modules**, delete *Planar Soundboard*. This removes the module folder only; your soundscapes and cue lists live in the world's settings and stay.
3. **Install Module**, paste the manifest URL above, install, launch the world. Everything is where you left it.

From then on, **Check for Updates** in Add-on Modules picks up new releases.

### Releasing later versions

1. Change the code, run `npm test`, try it in Foundry (`docs/DEVELOPMENT.md`, manual checklist).
2. Add `## [1.3.0]` at the top of `CHANGELOG.md`.
3. Commit, `git tag v1.3.0`, `git push origin main v1.3.0`.

For a version that needs a different Foundry code path, branch (for example `v15`) and use the same tag flow; set `compatibility` in `module.json` on that branch.

## 2. The official Foundry listing

Listing makes the module appear in Foundry's in-app **Install Module** search for everyone. As published by Foundry:

- You need an active Foundry VTT license on your foundryvtt.com account.
- Submit through the Package Submission Form: <https://foundryvtt.com/creators/submit/>. Modules get a **manual review and approval**.
- You must own or have rights to everything you ship. This module ships no audio, art or publisher text, which keeps review simple. See Foundry's [licensing guide](https://foundryvtt.com/article/licensing-guide/).
- On the form you give the package id (`planar-soundboard`), the title, a description, and the *latest* manifest URL from step 1. Check the form itself for the current list of fields.

### Foundry's AI content policy (read before submitting)

The code in this repo was written with AI assistance. Foundry's [AI Content Policy](https://foundryvtt.com/article/ai-policy) (revised 18 March 2026) applies to packages on the official listing. In short:

- You must be able to **understand, explain, modify and maintain** every part of the code.
- **User-facing prepared text must be human-authored.** That means `lang/en.json`: the labels, hints, tooltips and messages.
- The **package description on foundryvtt.com** must be written by you, not an AI.
- AI translation of human-written text is allowed if a speaker of the language reviews it: `lang/el.json`.
- Documentation and tests may be AI-assisted.
- A package that doesn't meet the policy gets a "Contains AI Content" tag, and the policy also allows archiving or removing non-compliant packages.

Re-read the current policy before you submit; it has changed before. It does not restrict publishing on GitHub (step 1).

Practical to-do before submitting:

1. Read through every file in `scripts/` until you could explain and fix each one. `docs/DEVELOPMENT.md` has the map.
2. Rewrite `lang/en.json` in your own words. Keep the keys and the `{placeholders}`; `npm test` tells you if you broke either. Then redo `lang/el.json` from your English (yourself, or translated and reviewed by you).
3. Rewrite the `description` in `module.json`, and write the listing text on foundryvtt.com yourself.
4. Run the manual checklist in `docs/DEVELOPMENT.md` on the Foundry version you list as `verified`.
5. Keep your commit history; don't squash it away.

### After approval: releasing versions to the listing

Once the package exists on foundryvtt.com, each new version must also be announced there. Do it by hand on your package page, or automate it:

1. On your package's page on foundryvtt.com, copy the **Package Release Token** (starts with `fvttp_`, shown above the *Save Package* button).
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**, name `FOUNDRY_PACKAGE_TOKEN`.
3. From then on, pushing a tag also runs `tools/release-api.mjs`, which posts the version, the version-specific manifest URL (`…/releases/download/vX.Y.Z/module.json`), the release notes link and the compatibility range to the [Package Release API](https://foundryvtt.com/article/package-release-api/).

Test it without publishing:

```
FOUNDRY_PACKAGE_TOKEN=fvttp_... node tools/release-api.mjs --version 1.2.0 --repo zacharatos/planar-soundboard --dry-run
```

Two releases of the same package within 60 seconds get a `429 Too Many Requests`; wait and retry.

## Checklist

- [ ] `npm test` passes
- [ ] Tried in Foundry v14 (manual checklist)
- [ ] Repo pushed, tag `v1.2.0` pushed, release has `module.json` and `module.zip`
- [ ] Manifest URL installs the module in a fresh world
- [ ] Own server moved to the manifest install
- [ ] (Listing) You can maintain the code; `lang/en.json` and the description are your own words; `lang/el.json` reviewed
- [ ] (Listing) Submitted at foundryvtt.com/creators/submit
