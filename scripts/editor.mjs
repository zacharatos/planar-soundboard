// Planar Soundboard — soundscape editor.

import {
  CHANNELS, channelLabel, esc, resolve, soundName, findScape, upsertScape, normScape, normAmbience, normScatter,
  normPad, ensureLibrarySound, docFromDrop, FilePickerCls, getScapes, uploadAudioFiles, dragHasFiles
} from "./store.mjs";
import * as engine from "./engine.mjs";
import { PRESETS } from "./fxgraph.mjs";
import { t, warn } from "./i18n.mjs";

const { ApplicationV2 } = foundry.applications.api;
const OPEN = new Set();

const ICONS = [
  "fa-solid fa-music", "fa-solid fa-dungeon", "fa-solid fa-skull", "fa-solid fa-city", "fa-solid fa-beer-mug-empty",
  "fa-solid fa-dragon", "fa-solid fa-khanda", "fa-solid fa-fire", "fa-solid fa-cloud-rain", "fa-solid fa-wind",
  "fa-solid fa-water", "fa-solid fa-tree", "fa-solid fa-mountain", "fa-solid fa-moon", "fa-solid fa-ghost",
  "fa-solid fa-dice-d20", "fa-solid fa-coins", "fa-solid fa-door-open", "fa-solid fa-bell", "fa-solid fa-bolt",
  "fa-solid fa-hand-sparkles", "fa-solid fa-gears", "fa-solid fa-crown", "fa-solid fa-heart-crack", "fa-solid fa-eye"
];

let preview = null;
function stopPreview() { try { preview?.stop({ fade: 300 }); } catch { /* gone */ } preview = null; }

export class ScapeEditor extends ApplicationV2 {
  static instances() { return [...OPEN]; }

  constructor({ scapeId, draft = null, ...options } = {}) {
    super({ id: `planar-soundboard-editor-${scapeId}`, ...options });
    this.scapeId = scapeId;
    this.scape = normScape(draft ?? findScape(scapeId) ?? { id: scapeId });
    this.isNew = !findScape(scapeId);
    this.dirty = !!draft;
  }

  static DEFAULT_OPTIONS = {
    classes: ["planar-soundboard", "ps-app", "ps-editor"],
    tag: "div",
    window: { title: "PLANAR_SOUNDBOARD.Editor.WindowTitle", icon: "fa-solid fa-pen-ruler", resizable: true },
    position: { width: 760, height: 760 },
    actions: {
      save: function () { return this._save(false); },
      saveActivate: function () { return this._save(true); },
      cancel: function () { return this.close(); },
      add: function (ev, el) { return this._add(el.dataset.list); },
      removeItem: function (ev, el) { return this._removeItem(el.dataset.list, Number(el.dataset.index)); },
      removeSource: function (ev, el) { return this._removeSource(el.dataset.list, Number(el.dataset.index), Number(el.dataset.sidx)); },
      pickAudio: function (ev, el) { return this._pickAudio(el.dataset.target, el.dataset.list, Number(el.dataset.index)); },
      pickImage: function () { return this._pickImage(); },
      audition: function (ev, el) { return this._audition(t); },
      stopPreview: () => stopPreview(),
      setIcon: function (ev, el) { this.scape.icon = el.dataset.icon; this.dirty = true; this.render(); }
    }
  };

  get title() {
    return this.scape.isGlobal ? t("Editor.GlobalTitle") : t("Editor.Title", { name: this.scape.name });
  }

  _onFirstRender() { OPEN.add(this); }
  async close(options) { OPEN.delete(this); stopPreview(); return super.close(options); }

  /* ---------------------------------------- */
  /*  Rendering                               */
  /* ---------------------------------------- */

  async _prepareContext() { return {}; }

  async _renderHTML() {
    const sc = this.scape;
    if (sc.isGlobal) {
      return `<div class="ps-editor-body ps-scroll">
        <p class="ps-hint">${t("Editor.GlobalHint")}</p>
        ${this._padsSection()}
      </div>${this._footer(false)}`;
    }
    return `<div class="ps-editor-body ps-scroll">
      ${this._generalSection()}
      ${this._musicSection()}
      ${this._ambienceSection()}
      ${this._scatterSection()}
      ${this._padsSection()}
    </div>${this._footer(true)}`;
  }

  _footer(canActivate) {
    return `<footer class="ps-footer">
      <button type="button" data-action="stopPreview" data-tooltip="${t("Editor.StopPreview")}"><i class="fa-solid fa-ear-deaf"></i></button>
      <span class="ps-flex"></span>
      <button type="button" data-action="cancel">${t("Common.Cancel")}</button>
      ${canActivate ? `<button type="button" data-action="saveActivate"><i class="fa-solid fa-play"></i> ${t("Editor.SaveAndPlay")}</button>` : ""}
      <button type="button" class="ps-primary" data-action="save"><i class="fa-solid fa-floppy-disk"></i> ${t("Common.Save")}</button>
    </footer>`;
  }

  _channelSelect(field, value) {
    return `<select data-field="${field}">${Object.keys(CHANNELS).map(k =>
      `<option value="${k}" ${k === value ? "selected" : ""}>${channelLabel(k)}</option>`).join("")}</select>`;
  }

  _vol(field, value, label = "") {
    return `<label class="ps-volfield">${label}
      <input type="range" min="0" max="1" step="0.01" data-field="${field}" value="${value}">
      <span class="ps-pct">${Math.round(value * 100)}%</span></label>`;
  }

  _soundOptions(selectedUuid, placeholder = t("Editor.ChooseTrack")) {
    const groups = game.playlists.contents.filter(p => p.sounds.size).sort((a, b) => a.name.localeCompare(b.name)).map(p =>
      `<optgroup label="${esc(p.name)}">${p.sounds.contents.map(s =>
        `<option value="${s.uuid}" ${s.uuid === selectedUuid ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</optgroup>`);
    return `<option value="">${placeholder}</option>${groups.join("")}`;
  }

  _generalSection() {
    const sc = this.scape;
    const scenes = [`<option value="">${t("Common.None")}</option>`, ...game.scenes.contents.map(s =>
      `<option value="${s.id}" ${s.id === sc.sceneId ? "selected" : ""}>${esc(s.name)}</option>`)].join("");
    const combat = [`<option value="">${t("Editor.UsePanelDefault")}</option>`, ...getScapes().filter(s => s.id !== sc.id).map(s =>
      `<option value="${s.id}" ${s.id === sc.combatScapeId ? "selected" : ""}>${esc(s.name)}</option>`)].join("");
    const groups = [...new Set(getScapes().map(s => s.group).filter(Boolean))];
    return `<section class="ps-sec">
      <h3><i class="fa-solid fa-sliders"></i> ${t("Editor.General")}</h3>
      <div class="ps-form">
        <label>${t("Editor.Name")} <input type="text" data-field="name" value="${esc(sc.name)}" data-rerender-title></label>
        <label>${t("Editor.Group")} <input type="text" data-field="group" value="${esc(sc.group)}" list="ps-groups" placeholder="${t("Editor.GroupPlaceholder")}">
          <datalist id="ps-groups">${groups.map(g => `<option value="${esc(g)}">`).join("")}</datalist></label>
        <label>${t("Editor.Colour")} <input type="color" data-field="color" value="${esc(sc.color)}"></label>
        <label>${t("Editor.CardImage")} <span class="ps-inline"><input type="text" data-field="img" value="${esc(sc.img)}" placeholder="${t("Editor.Optional")}">
          <button type="button" data-action="pickImage"><i class="fa-solid fa-image"></i></button></span></label>
        <label>${t("Editor.FadeSeconds")} <input type="number" min="0" step="0.1" data-field="fadeMs" data-dtype="seconds"
          value="${sc.fadeMs == null ? "" : sc.fadeMs / 1000}" placeholder="${t("Common.Default")}"></label>
        <label>${t("Editor.Transition")} <select data-field="transition">
          <option value="crossfade" ${sc.transition === "crossfade" ? "selected" : ""}>${t("Editor.Crossfade")}</option>
          <option value="dip" ${sc.transition === "dip" ? "selected" : ""}>${t("Editor.Dip")}</option></select></label>
        <label>${t("Editor.FilterWhileActive")} <select data-field="filter.preset" data-rerender>
          <option value="">${t("Common.None")}</option>${Object.keys(PRESETS).map(k =>
            `<option value="${k}" ${k === sc.filter.preset ? "selected" : ""}>${t(`Filters.${k}.Label`)} — ${t(`Filters.${k}.Hint`)}</option>`).join("")}</select></label>
        ${sc.filter.preset ? this._vol("filter.intensity", sc.filter.intensity, t("Editor.FilterStrength")) : "<span></span>"}
        <label>${t("Editor.LinkedScene")} <select data-field="sceneId">${scenes}</select></label>
        <label>${t("Editor.CombatSwitch")} <select data-field="combatScapeId">${combat}</select></label>
        <label class="ps-check"><input type="checkbox" data-field="sticky" ${sc.sticky ? "checked" : ""}>
          ${t("Editor.Sticky")}</label>
        <label class="ps-wide">${t("Editor.Notes")} <input type="text" data-field="notes" value="${esc(sc.notes)}" placeholder="${t("Editor.NotesPlaceholder")}"></label>
      </div>
      <div class="ps-icons">${ICONS.map(i => `<a class="${i === sc.icon ? "on" : ""}" data-action="setIcon" data-icon="${i}"><i class="${i}"></i></a>`).join("")}
        <input type="text" data-field="icon" value="${esc(sc.icon)}" data-tooltip="${t("Editor.IconHint")}"></div>
    </section>`;
  }

  _musicSection() {
    const m = this.scape.music;
    const modes = ["none", "keep", "playlist", "track"];
    let body = "";
    if (m.mode === "playlist") {
      const pl = resolve(m.playlistUuid);
      const opts = [`<option value="">${t("Editor.ChoosePlaylist")}</option>`, ...game.playlists.contents.map(p =>
        `<option value="${p.uuid}" ${p.uuid === m.playlistUuid ? "selected" : ""}>${esc(p.name)} (${p.sounds.size})</option>`)].join("");
      const modeKey = pl ? Object.entries(CONST.PLAYLIST_MODES).find(([, v]) => v === pl.mode)?.[0] : null;
      const modeName = modeKey ? t(`PlaylistModes.${modeKey}`) : "";
      body = `<div class="ps-form">
        <label class="ps-wide">${t("Editor.Playlist")} <select data-field="music.playlistUuid" data-rerender>${opts}</select></label>
        ${pl ? `<p class="ps-hint ps-wide">${t("Editor.PlaylistModeHint", { mode: esc(modeName) })}</p>` : ""}
        <label>${t("Editor.Channel")} ${this._channelSelect("music.channel", m.channel)}</label>
        <label class="ps-check"><input type="checkbox" data-field="music.overrideVolume" data-rerender ${m.overrideVolume ? "checked" : ""}> ${t("Editor.OverrideVolume")}</label>
        ${m.overrideVolume ? this._vol("music.volume", m.volume, t("Editor.Volume")) : ""}
      </div>`;
    } else if (m.mode === "track") {
      const s = resolve(m.soundUuid);
      body = `<div class="ps-form">
        <label class="ps-wide">${t("Editor.Track")} <span class="ps-inline"><select data-field="music.soundUuid" data-rerender>${this._soundOptions(m.soundUuid)}</select>
          <button type="button" data-action="pickAudio" data-target="music" data-tooltip="${t("Editor.PickFile")}"><i class="fa-solid fa-folder-open"></i></button>
          ${s ? `<button type="button" data-action="audition" data-src="${esc(s.path)}" data-tooltip="${t("Editor.Preview")}"><i class="fa-solid fa-headphones"></i></button>` : ""}
        </span></label>
        <label>${t("Editor.Channel")} ${this._channelSelect("music.channel", m.channel)}</label>
        <label class="ps-check"><input type="checkbox" data-field="music.loop" ${m.loop ? "checked" : ""}> ${t("Editor.Loop")}</label>
        ${this._vol("music.volume", m.volume, t("Editor.Volume"))}
      </div>`;
    }
    return `<section class="ps-sec" data-drop="music">
      <h3><i class="fa-solid fa-music"></i> ${t("Editor.Music")} <small>${t("Editor.MusicDrop")}</small></h3>
      <div class="ps-seg">${modes.map(k =>
        `<label><input type="radio" name="music-mode" data-field="music.mode" data-rerender value="${k}" ${m.mode === k ? "checked" : ""}> ${t(`Editor.MusicModes.${k}`)}</label>`).join("")}</div>
      ${body}
    </section>`;
  }

  _ambienceSection() {
    const rows = this.scape.ambience.map((a, i) => {
      const s = resolve(a.soundUuid);
      return `<div class="ps-item ${s ? "" : "missing"}">
        <div class="ps-item-name"><i class="fa-solid fa-wind"></i> ${s ? esc(s.name) : `<em>${t("Editor.MissingSound")}</em>`} <small>${esc(s?.parent?.name ?? "")}</small></div>
        ${this._channelSelect(`ambience.${i}.channel`, a.channel)}
        ${this._vol(`ambience.${i}.volume`, a.volume)}
        ${s ? `<a data-action="audition" data-src="${esc(s.path)}" data-tooltip="${t("Editor.Preview")}"><i class="fa-solid fa-headphones"></i></a>` : "<span></span>"}
        <a data-action="removeItem" data-list="ambience" data-index="${i}" data-tooltip="${t("Common.Remove")}"><i class="fa-solid fa-xmark"></i></a>
      </div>`;
    }).join("");
    return `<section class="ps-sec" data-drop="ambience">
      <h3><i class="fa-solid fa-wind"></i> ${t("Editor.Ambience")} <small>${t("Editor.AmbienceSub")}</small></h3>
      ${rows || `<p class="ps-dim">${t("Editor.AmbienceEmpty")}</p>`}
      <div class="ps-row">
        <select class="ps-adder" data-add="ambience">${this._soundOptions("", t("Editor.AddTrack"))}</select>
        <button type="button" data-action="pickAudio" data-target="ambience"><i class="fa-solid fa-folder-open"></i> ${t("Editor.File")}</button>
      </div>
    </section>`;
  }

  _sources(list, i, sources) {
    return `<div class="ps-sources" data-drop="${list}-sources" data-index="${i}">
      ${sources.map((src, k) => `<span class="ps-src" data-tooltip="${esc(src)}">
        <a data-action="audition" data-src="${esc(src)}"><i class="fa-solid fa-headphones"></i></a> ${esc(soundName(src))}
        <a data-action="removeSource" data-list="${list}" data-index="${i}" data-sidx="${k}"><i class="fa-solid fa-xmark"></i></a></span>`).join("")}
      <button type="button" class="ps-mini" data-action="pickAudio" data-target="${list}-sources" data-list="${list}" data-index="${i}">
        <i class="fa-solid fa-plus"></i> ${t("Editor.SourceFile")}</button>
      ${sources.length > 1 ? `<small class="ps-dim">${t("Editor.RandomVariant")}</small>` : ""}
    </div>`;
  }

  _scatterSection() {
    const rows = this.scape.scatter.map((l, i) => `<div class="ps-block">
      <div class="ps-form">
        <label>${t("Editor.Name")} <input type="text" data-field="scatter.${i}.name" value="${esc(l.name)}"></label>
        <label>${t("Editor.Channel")} ${this._channelSelect(`scatter.${i}.channel`, l.channel)}</label>
        <label>${t("Editor.Every")} <span class="ps-inline"><input type="number" min="1" data-field="scatter.${i}.minDelay" value="${l.minDelay}">
          ${t("Editor.To")} <input type="number" min="1" data-field="scatter.${i}.maxDelay" value="${l.maxDelay}"></span></label>
        <label>${t("Editor.Volume")} <span class="ps-inline"><input type="number" min="0" max="1" step="0.05" data-field="scatter.${i}.volMin" value="${l.volMin}">
          ${t("Editor.To")} <input type="number" min="0" max="1" step="0.05" data-field="scatter.${i}.volMax" value="${l.volMax}"></span></label>
      </div>
      ${this._sources("scatter", i, l.sources)}
      <a class="ps-remove" data-action="removeItem" data-list="scatter" data-index="${i}" data-tooltip="${t("Editor.RemoveLayer")}"><i class="fa-solid fa-trash"></i></a>
    </div>`).join("");
    return `<section class="ps-sec" data-drop="scatter">
      <h3><i class="fa-solid fa-shuffle"></i> ${t("Editor.Scatter")} <small>${t("Editor.ScatterSub")}</small></h3>
      ${rows || `<p class="ps-dim">${t("Editor.ScatterEmpty")}</p>`}
      <button type="button" data-action="add" data-list="scatter"><i class="fa-solid fa-plus"></i> ${t("Editor.ScatterAdd")}</button>
    </section>`;
  }

  _padsSection() {
    const rows = this.scape.pads.map((p, i) => `<div class="ps-block">
      <div class="ps-form">
        <label>${t("Editor.Name")} <input type="text" data-field="pads.${i}.name" value="${esc(p.name)}"></label>
        <label>${t("Editor.Icon")} <span class="ps-inline"><i class="${esc(p.icon)}"></i><input type="text" data-field="pads.${i}.icon" value="${esc(p.icon)}"></span></label>
        <label>${t("Editor.Colour")} <input type="color" data-field="pads.${i}.color" value="${esc(p.color || "#c9a24a")}"></label>
        <label>${t("Editor.Channel")} ${this._channelSelect(`pads.${i}.channel`, p.channel)}</label>
        ${this._vol(`pads.${i}.volume`, p.volume, t("Editor.Volume"))}
        <label class="ps-check"><input type="checkbox" data-field="pads.${i}.duck" ${p.duck ? "checked" : ""}> ${t("Editor.Duck")}</label>
        <label class="ps-check"><input type="checkbox" data-field="pads.${i}.loop" ${p.loop ? "checked" : ""}> ${t("Editor.PadLoop")}</label>
      </div>
      ${this._sources("pads", i, p.sources)}
      <a class="ps-remove" data-action="removeItem" data-list="pads" data-index="${i}" data-tooltip="${t("Editor.RemovePad")}"><i class="fa-solid fa-trash"></i></a>
    </div>`).join("");
    return `<section class="ps-sec" data-drop="pads">
      <h3><i class="fa-solid fa-table-cells"></i> ${t("Editor.Pads")} <small>${t("Editor.PadsSub")}</small></h3>
      ${rows || `<p class="ps-dim">${t("Editor.PadsEmpty")}</p>`}
      <button type="button" data-action="add" data-list="pads"><i class="fa-solid fa-plus"></i> ${t("Editor.PadAdd")}</button>
    </section>`;
  }

  _replaceHTML(result, content) {
    const scroll = content.querySelector(".ps-scroll")?.scrollTop ?? 0;
    content.innerHTML = result;
    const el = content.querySelector(".ps-scroll");
    if (el) el.scrollTop = scroll;
  }

  /* ---------------------------------------- */
  /*  Events                                  */
  /* ---------------------------------------- */

  _onRender() {
    const html = this.element;
    for (const el of html.querySelectorAll("[data-field]")) {
      el.addEventListener("change", ev => this._onField(ev));
      if (el.type === "range") el.addEventListener("input", () => {
        const pct = el.parentElement.querySelector(".ps-pct");
        if (pct) pct.textContent = `${Math.round(el.value * 100)}%`;
      });
    }
    for (const sel of html.querySelectorAll("[data-add]")) {
      sel.addEventListener("change", () => {
        if (!sel.value) return;
        this._addAmbience(resolve(sel.value));
      });
    }
    for (const zone of html.querySelectorAll("[data-drop]")) {
      zone.addEventListener("dragover", ev => { ev.preventDefault(); zone.classList.add("ps-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("ps-over"));
      zone.addEventListener("drop", ev => {
        ev.preventDefault(); ev.stopPropagation();
        zone.classList.remove("ps-over");
        if (dragHasFiles(ev)) return this._onFileDrop(zone.dataset.drop, Number(zone.dataset.index), ev.dataTransfer.files);
        this._onDrop(zone.dataset.drop, Number(zone.dataset.index), docFromDrop(ev));
      });
    }
  }

  _onField(ev) {
    const el = ev.currentTarget;
    let value;
    if (el.type === "checkbox") value = el.checked;
    else if (el.type === "radio") { if (!el.checked) return; value = el.value; }
    else if (el.type === "number" || el.type === "range") {
      value = el.value === "" ? null : Number(el.value);
      if (el.dataset.dtype === "seconds" && value != null) value = Math.round(value * 1000);
    } else value = el.value;
    foundry.utils.setProperty(this.scape, el.dataset.field, value);
    this.dirty = true;
    if ("rerender" in el.dataset) this.render();
    if ("rerenderTitle" in el.dataset && this.window?.title) this.window.title.textContent = this.title;
  }

  _add(list) {
    if (list === "scatter") this.scape.scatter.push(normScatter({ name: t("Defaults.ScatterN", { n: this.scape.scatter.length + 1 }) }));
    if (list === "pads") this.scape.pads.push(normPad({ name: t("Defaults.PadN", { n: this.scape.pads.length + 1 }) }));
    this.dirty = true;
    this.render();
  }

  _addAmbience(doc) {
    if (!doc) return;
    const sounds = doc.documentName === "Playlist" ? doc.sounds.contents : [doc];
    for (const s of sounds) {
      if (this.scape.ambience.some(a => a.soundUuid === s.uuid)) continue;
      this.scape.ambience.push(normAmbience({ soundUuid: s.uuid, volume: s.volume ?? 0.5 }));
    }
    this.dirty = true;
    this.render();
  }

  _removeItem(list, i) {
    this.scape[list].splice(i, 1);
    this.dirty = true;
    this.render();
  }

  _removeSource(list, i, k) {
    this.scape[list][i]?.sources.splice(k, 1);
    this.dirty = true;
    this.render();
  }

  _onDrop(zone, index, doc) {
    if (!doc) return warn("Notify.DropPlaylist");
    const isPl = doc.documentName === "Playlist";
    const paths = isPl ? doc.sounds.contents.map(s => s.path).filter(Boolean) : [doc.path].filter(Boolean);
    const sc = this.scape;
    switch (zone) {
      case "music":
        if (isPl) Object.assign(sc.music, { mode: "playlist", playlistUuid: doc.uuid });
        else Object.assign(sc.music, { mode: "track", soundUuid: doc.uuid, volume: doc.volume ?? sc.music.volume });
        break;
      case "ambience": return this._addAmbience(doc);
      case "pads":
        sc.pads.push(normPad({ name: doc.name, sources: paths }));
        break;
      case "scatter":
        sc.scatter.push(normScatter({ name: doc.name, sources: paths }));
        break;
      case "pads-sources":
      case "scatter-sources": {
        const item = sc[zone.split("-")[0]][index];
        if (item) item.sources.push(...paths.filter(p => !item.sources.includes(p)));
        break;
      }
      default: return;
    }
    this.dirty = true;
    this.render();
  }

  /** Sound files dragged in from the desktop: upload them, then add them where they were dropped. */
  async _onFileDrop(zone, index, files) {
    const sc = this.scape;
    const paths = await uploadAudioFiles(files, sc.isGlobal ? "global" : sc.name);
    if (!paths.length) return;
    switch (zone) {
      case "music": {
        const s = await ensureLibrarySound(paths[0]);
        Object.assign(sc.music, { mode: "track", soundUuid: s.uuid });
        break;
      }
      case "ambience":
        for (const p of paths) {
          const s = await ensureLibrarySound(p);
          if (!sc.ambience.some(a => a.soundUuid === s.uuid)) sc.ambience.push(normAmbience({ soundUuid: s.uuid }));
        }
        break;
      case "pads":
        for (const p of paths) sc.pads.push(normPad({ name: soundName(p), sources: [p] }));
        break;
      case "scatter":
        sc.scatter.push(normScatter({ name: soundName(paths[0]), sources: paths }));
        break;
      case "pads-sources":
      case "scatter-sources": {
        const item = sc[zone.split("-")[0]][index];
        if (item) item.sources.push(...paths.filter(p => !item.sources.includes(p)));
        break;
      }
      default: return;
    }
    this.dirty = true;
    this.render();
  }

  _pickAudio(target, list, index) {
    const FP = FilePickerCls();
    const fp = new FP({
      type: "audio",
      callback: async path => {
        if (!path) return;
        if (target === "music") {
          const s = await ensureLibrarySound(path);
          Object.assign(this.scape.music, { mode: "track", soundUuid: s.uuid });
        } else if (target === "ambience") {
          return this._addAmbience(await ensureLibrarySound(path));
        } else if (target.endsWith("-sources")) {
          this.scape[list][index]?.sources.push(path);
        }
        this.dirty = true;
        this.render();
      }
    });
    fp.render(true);
  }

  _pickImage() {
    const FP = FilePickerCls();
    new FP({ type: "image", current: this.scape.img, callback: path => { this.scape.img = path; this.dirty = true; this.render(); } }).render(true);
  }

  async _audition(el) {
    stopPreview();
    const src = el.dataset.src;
    if (!src) return;
    preview = await engine.playOneShot(src, { volume: 0.8, channel: "interface", broadcast: false });
  }

  async _save(andActivate) {
    const sc = normScape(this.scape);
    if (sc.music.mode === "track" && !sc.music.soundUuid) sc.music.mode = "none";
    if (sc.music.mode === "playlist" && !sc.music.playlistUuid) sc.music.mode = "none";
    if (sc.sceneId) {
      const clash = getScapes().find(s => s.sceneId === sc.sceneId && s.id !== sc.id);
      if (clash) warn("Notify.SceneClash", { name: clash.name });
    }
    await upsertScape(sc);
    this.dirty = false;
    await this.close();
    if (andActivate && !sc.isGlobal) engine.activate(sc.id);
  }
}
