// Planar Soundboard — the main GM panel.

import {
  MODULE_ID, CHANNELS, channelLabel, GLOBAL_ID, esc, channelOf, getScapes, getAllScapes, getGlobalScape, getState,
  getSetting, setSetting, findScape, missingCount, upsertScape, deleteScape, saveAllScapes, normScape, normPad,
  randomId, saveFile, soundName, uploadAudioFiles, dragHasFiles, docFromDrop
} from "./store.mjs";
import * as engine from "./engine.mjs";
import * as cues from "./cues.mjs";
import { PRESETS } from "./fxgraph.mjs";
import { t, info, error } from "./i18n.mjs";
import { ScapeEditor } from "./editor.mjs";
import { CueEditor } from "./cue-editor.mjs";

const { ApplicationV2 } = foundry.applications.api;

const FADE_CHOICES = [null, 0, 250, 500, 1000, 3000, 6000, 10000, 20000];
const fadeLabel = ms => (ms == null ? t("Panel.FadeDefault") : ms === 0 ? t("Panel.FadeCut") : `${ms / 1000} s`);

export class SoundboardPanel extends ApplicationV2 {
  constructor(options = {}) {
    super(options);
    this.fadeOverride = null;
    this.search = "";
    this.tab = "scapes";
    this.filterTargets = new Set();
    this._dragging = false;
  }

  static DEFAULT_OPTIONS = {
    id: "planar-soundboard",
    classes: ["planar-soundboard", "ps-app"],
    tag: "div",
    window: { title: "PLANAR_SOUNDBOARD.Title", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 880, height: 740 },
    actions: {
      activate: function (ev, el) { return this._onActivate(ev, el); },
      edit: function (ev, el) { return this._onEdit(el.closest("[data-id]")?.dataset.id); },
      newScape: function () { return this._onNew(); },
      duplicate: function (ev, el) { return this._onDuplicate(el.closest("[data-id]")?.dataset.id); },
      remove: function (ev, el) { return this._onDelete(el.closest("[data-id]")?.dataset.id); },
      preload: function (ev, el) { const sc = findScape(el.closest("[data-id]")?.dataset.id); if (sc) engine.preloadScape(sc); },
      pad: function (ev, el) { return this._onPad(el); },
      narrate: () => engine.narrate(),
      muffle: () => engine.muffle(),
      stopAll: function () { return engine.stopAll({ fadeMs: this.fadeOverride }); },
      stopTrack: function (ev, el) { return engine.stopTrack(fromUuidSync(el.closest("[data-uuid]").dataset.uuid), this.fadeOverride); },
      nextTrack: (ev, el) => { const s = fromUuidSync(el.closest("[data-uuid]").dataset.uuid); return s?.parent?.playNext(s.id); },
      editGlobal: function () { return this._onEdit(GLOBAL_ID); },
      exportJson: () => SoundboardPanel.exportJson(),
      importJson: () => SoundboardPanel.importJson(),
      moveScape: function (ev, el) { return this._onMove(el.closest("[data-id]")?.dataset.id, Number(el.dataset.dir)); },
      psTab: function (ev, el) { this.tab = el.dataset.psTab; this.render(); },
      // filters
      filter: function (ev, el) { return engine.toggleFilter(el.dataset.preset, { targets: [...this.filterTargets] }); },
      target: function (ev, el) { return this._onTarget(el.dataset.user); },
      clearFilter: (ev, el) => engine.clearFilter(el.dataset.fid),
      clearFilters: () => engine.clearAllFilters(),
      // cues
      cueGo: () => cues.go(),
      cueBack: () => cues.back(),
      cueStandby: function (ev, el) { return cues.standby(el.closest("[data-list]").dataset.list, Number(el.closest("[data-index]").dataset.index)); },
      cueFire: function (ev, el) { return cues.fireAt(el.closest("[data-list]").dataset.list, Number(el.closest("[data-index]").dataset.index)); },
      cueNewList: function () { return this._onNewCueList(); },
      cueEditList: function () { const l = cues.currentList(); if (l) new CueEditor({ listId: l.id }).render({ force: true }); },
      cueDeleteList: function () { return this._onDeleteCueList(); },
      cueRestart: function () { const l = cues.currentList(); if (l) return cues.standby(l.id, 0); }
    }
  };

  /* ---------------------------------------- */
  /*  Context                                 */
  /* ---------------------------------------- */

  async _prepareContext() {
    const st = getState();
    const scapes = getScapes();
    const groups = new Map();
    for (const sc of scapes) {
      const g = sc.group || t("Panel.Soundscapes");
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(sc);
    }
    const hk = new Map(engine.hotkeyPads().map((e, i) => [e.pad.id, i + 1]));
    const padBanks = [];
    for (const sc of [findScape(st.base), ...st.overlays.map(findScape), getGlobalScape()].filter(Boolean)) {
      if (!sc.pads.length && !sc.isGlobal && sc.id !== st.base) continue;
      padBanks.push({ scape: sc, pads: sc.pads.map(p => ({ ...p, hotkey: hk.get(p.id), active: engine.isLoopPadActive(p.id) })) });
    }
    const tracks = engine.playingSounds().map(s => ({
      uuid: s.uuid, name: s.name, playlist: s.parent?.name ?? "", channel: channelOf(s), volume: s.volume ?? 0,
      canNext: [CONST.PLAYLIST_MODES.SEQUENTIAL, CONST.PLAYLIST_MODES.SHUFFLE].includes(s.parent?.mode)
    })).sort((a, b) => Object.keys(CHANNELS).indexOf(a.channel) - Object.keys(CHANNELS).indexOf(b.channel));
    const players = game.users.filter(u => !u.isGM).map(u => ({
      id: u.id, name: u.character?.name ?? u.name, user: u.name, active: u.active, color: u.color?.css ?? u.color ?? ""
    }));
    for (const id of [...this.filterTargets]) if (!players.some(p => p.id === id)) this.filterTargets.delete(id);

    const list = cues.currentList();
    const run = cues.getRun();
    const onList = list && run.listId === list.id;
    return {
      st, groups: [...groups.entries()], padBanks, tracks, fx: engine.fxState(), players,
      base: findScape(st.base), overlays: st.overlays.map(findScape).filter(Boolean),
      combatScape: getSetting("combatScape"), scapes,
      cueLists: cues.getCueLists(), cueList: list,
      cueNext: onList ? run.index : 0, cueLast: onList ? run.last : null, cueRunning: cues.runningCueId()
    };
  }

  /* ---------------------------------------- */
  /*  Rendering                               */
  /* ---------------------------------------- */

  async _renderHTML(ctx) {
    const fadeSel = FADE_CHOICES.map(v =>
      `<option value="${v ?? ""}" ${String(v ?? "") === String(this.fadeOverride ?? "") ? "selected" : ""}>${fadeLabel(v)}</option>`).join("");
    const now = ctx.base
      ? `<span class="ps-now-base" style="--c:${esc(ctx.base.color)}"><i class="${esc(ctx.base.icon)}"></i> ${esc(ctx.base.name)}</span>`
      : `<span class="ps-dim">${t("Panel.NothingActive")}</span>`;
    const chips = ctx.overlays.map(o => `<span class="ps-chip" style="--c:${esc(o.color)}"><i class="${esc(o.icon)}"></i> ${esc(o.name)}</span>`).join("");

    return `
    <div class="ps-panel">
      <header class="ps-toolbar">
        <div class="ps-now">${now}${chips}</div>
        <label class="ps-fade" data-tooltip="${t("Panel.FadeTooltip")}">
          <i class="fa-solid fa-wave-square"></i>
          <select data-field="fadeOverride">${fadeSel}</select>
        </label>
        <button type="button" class="ps-toggle ${ctx.fx.narrate ? "on" : ""}" data-action="narrate" data-tooltip="${t("Panel.NarrateTooltip")}">
          <i class="fa-solid fa-microphone-lines"></i> ${t("Panel.Narrate")}</button>
        <button type="button" class="ps-toggle ${ctx.fx.muffle ? "on" : ""}" data-action="muffle" data-tooltip="${t("Panel.MuffleTooltip")}">
          <i class="fa-solid fa-door-closed"></i> ${t("Panel.Muffle")}</button>
        <button type="button" class="ps-danger" data-action="stopAll" data-tooltip="${t("Panel.SilenceTooltip")}">
          <i class="fa-solid fa-volume-xmark"></i> ${t("Panel.Silence")}</button>
      </header>
      ${this._goBar(ctx)}
      <div class="ps-body">
        <section class="ps-main ps-scroll">
          <nav class="ps-tabs">
            <a data-action="psTab" data-ps-tab="scapes" class="${this.tab === "scapes" ? "on" : ""}"><i class="fa-solid fa-layer-group"></i> ${t("Panel.Soundscapes")}</a>
            <a data-action="psTab" data-ps-tab="cues" class="${this.tab === "cues" ? "on" : ""}"><i class="fa-solid fa-list-ol"></i> ${t("Panel.Cues")}</a>
          </nav>
          ${this.tab === "cues" ? this._cuesTab(ctx) : this._scapesTab(ctx)}
        </section>
        <aside class="ps-side ps-scroll">
          ${this._filtersSection(ctx)}
          ${this._padsSection(ctx)}
          <h3>${t("Panel.NowPlaying")}</h3>
          <div class="ps-mixer">${this._mixer(ctx)}</div>
          <h3>${t("Panel.Combat")}</h3>
          <label class="ps-combat">On “Begin Combat” switch to
            <select data-field="combatScape">${[`<option value="">${t("Common.None")}</option>`, ...ctx.scapes.map(s =>
              `<option value="${s.id}" ${s.id === ctx.combatScape ? "selected" : ""}>${esc(s.name)}</option>`)].join("")}</select></label>
        </aside>
      </div>
    </div>`;
  }

  _goBar(ctx) {
    const list = ctx.cueList;
    if (!list) return "";
    const next = list.cues[ctx.cueNext];
    const running = ctx.cueRunning && list.cues.find(c => c.id === ctx.cueRunning);
    return `<div class="ps-gobar">
      <button type="button" class="ps-go" data-action="cueGo" ${next ? "" : "disabled"} data-tooltip="${t("Panel.GoTooltip")}">
        <i class="fa-solid fa-play"></i> GO</button>
      <div class="ps-go-next">
        ${next ? `<span class="ps-dim">${t("Panel.NextCue", { n: ctx.cueNext + 1, total: list.cues.length })}</span> <b>${esc(next.name)}</b>`
               : `<span class="ps-dim">${t("Panel.EndOfList", { name: esc(list.name) })}</span>`}
        ${running ? `<span class="ps-running"><i class="fa-solid fa-circle-notch fa-spin"></i> ${esc(running.name)}</span>` : ""}
      </div>
      <a data-action="cueBack" data-tooltip="${t("Panel.StepBack")}"><i class="fa-solid fa-backward-step"></i></a>
      <a data-action="psTab" data-ps-tab="cues" data-tooltip="${t("Panel.ShowCues")}"><i class="fa-solid fa-list-ol"></i></a>
    </div>`;
  }

  _scapesTab(ctx) {
    const cards = ctx.groups.map(([g, list]) => `
      <h3 class="ps-group">${esc(g)}</h3>
      <div class="ps-grid">${list.map(sc => this._card(sc, ctx.st)).join("")}</div>`).join("")
      || `<div class="ps-empty">${t("Panel.NoScapes")}</div>`;
    return `
      <div class="ps-row">
        <input type="search" class="ps-search" placeholder="${t("Panel.Search")}" value="${esc(this.search)}">
        <button type="button" data-action="newScape"><i class="fa-solid fa-plus"></i> ${t("Panel.New")}</button>
        <button type="button" data-action="importJson" data-tooltip="${t("Panel.Import")}"><i class="fa-solid fa-file-import"></i></button>
        <button type="button" data-action="exportJson" data-tooltip="${t("Panel.Export")}"><i class="fa-solid fa-file-export"></i></button>
      </div>
      <p class="ps-hint">${t("Panel.ClickHint")}</p>
      ${cards}`;
  }

  _cuesTab(ctx) {
    const lists = ctx.cueLists;
    const list = ctx.cueList;
    const head = `<div class="ps-row">
      <select data-field="cueList" ${lists.length ? "" : "disabled"}>${lists.map(l =>
        `<option value="${l.id}" ${l.id === list?.id ? "selected" : ""}>${esc(l.name)} (${l.cues.length})</option>`).join("") || `<option>${t("Panel.NoCueLists")}</option>`}</select>
      <button type="button" data-action="cueNewList"><i class="fa-solid fa-plus"></i> ${t("Panel.NewList")}</button>
      ${list ? `<button type="button" data-action="cueEditList"><i class="fa-solid fa-pen"></i> ${t("Common.Edit")}</button>
      <button type="button" data-action="cueRestart" data-tooltip="${t("Panel.Restart")}"><i class="fa-solid fa-rotate-left"></i></button>
      <button type="button" data-action="cueDeleteList" data-tooltip="${t("Panel.DeleteList")}"><i class="fa-solid fa-trash"></i></button>` : ""}
    </div>`;
    if (!list) return `${head}<div class="ps-empty">${t("Panel.NoCueListHint")}</div>`;
    const rows = list.cues.map((c, i) => {
      const cls = [i === ctx.cueNext ? "next" : "", i === ctx.cueLast ? "last" : "", i < ctx.cueNext ? "done" : "", c.id === ctx.cueRunning ? "running" : ""].join(" ");
      return `<div class="ps-cue ${cls}" data-action="cueStandby" data-index="${i}" style="${c.color ? `--c:${esc(c.color)}` : ""}"
          data-tooltip="${t("Panel.CueClickHint")}">
        <span class="ps-cue-num">${i + 1}</span>
        <div class="ps-cue-body">
          <div class="ps-cue-name">${esc(c.name)}${c.autoFollow != null ? ` <span class="ps-dim" data-tooltip="${t("Panel.AutoFollows", { s: c.autoFollow })}"><i class="fa-solid fa-arrow-turn-down"></i> ${c.autoFollow}s</span>` : ""}</div>
          <div class="ps-cue-acts">${c.actions.map(a => `<span>${esc(cues.describeAction(a))}</span>`).join("") || `<span class="ps-dim">${t("Panel.NoActions")}</span>`}</div>
          ${c.notes ? `<div class="ps-cue-notes">${esc(c.notes)}</div>` : ""}
        </div>
        <a class="ps-cue-fire" data-action="cueFire" data-tooltip="${t("Panel.FireNow")}"><i class="fa-solid fa-play"></i></a>
      </div>`;
    }).join("") || `<div class="ps-empty">${t("Panel.ListEmpty")}</div>`;
    return `${head}<div class="ps-cues" data-list="${list.id}">${rows}</div>`;
  }

  _filtersSection(ctx) {
    const targets = [...this.filterTargets];
    const chips = [`<a class="ps-tgt ${targets.length ? "" : "on"}" data-action="target" data-user="">${t("Panel.Everyone")}</a>`,
      ...ctx.players.map(p => `<a class="ps-tgt ${this.filterTargets.has(p.id) ? "on" : ""} ${p.active ? "" : "offline"}"
        data-action="target" data-user="${p.id}" data-tooltip="${esc(p.user)}${p.active ? "" : ` (${t("Panel.Offline")})`}"
        style="${p.color ? `--u:${esc(p.color)}` : ""}">${esc(p.name)}</a>`)].join("");
    const buttons = Object.entries(PRESETS).map(([id, pr]) => {
      const on = engine.isFilterOn(id, targets);
      return `<button type="button" class="ps-filter ${on ? "on" : ""}" data-action="filter" data-preset="${id}"
        data-tooltip="${esc(t(`Filters.${id}.Hint`))}"><i class="${pr.icon}"></i><span>${esc(t(`Filters.${id}.Label`))}</span></button>`;
    }).join("");
    const nameOf = id => ctx.players.find(p => p.id === id)?.name ?? game.users.get(id)?.name ?? "?";
    const active = ctx.fx.filters.map(f => {
      const who = f.id.startsWith("scape:") ? t("Panel.WhoScape") : f.targets.length ? f.targets.map(nameOf).join(", ") : t("Panel.WhoEveryone");
      return `<span class="ps-chip ps-fchip"><i class="${PRESETS[f.preset]?.icon}"></i> ${esc(t(`Filters.${f.preset}.Label`))}
        <small>→ ${esc(who)}</small><a data-action="clearFilter" data-fid="${esc(f.id)}" data-tooltip="${t("Panel.FilterOff")}"><i class="fa-solid fa-xmark"></i></a></span>`;
    }).join("");
    return `<h3>${t("Panel.Filters")} ${ctx.fx.filters.length ? `<a class="ps-h-link" data-action="clearFilters" data-tooltip="${t("Panel.ClearAllTooltip")}">${t("Panel.ClearAll")}</a>` : ""}</h3>
      <div class="ps-tgts">${chips}</div>
      <div class="ps-filters">${buttons}</div>
      ${active ? `<div class="ps-factive">${active}</div>` : ""}`;
  }

  _padsSection(ctx) {
    const banks = ctx.padBanks.map(b => `
      <div class="ps-bank" data-scape="${b.scape.id}">
        <div class="ps-bank-title">${esc(b.scape.isGlobal ? t("Panel.Global") : b.scape.name)}
          <a data-action="${b.scape.isGlobal ? "editGlobal" : "edit"}" data-id="${b.scape.id}" data-tooltip="${t("Panel.EditPads")}"><i class="fa-solid fa-pen"></i></a></div>
        <div class="ps-pads">${b.pads.map(p => `
          <button type="button" class="ps-pad ${p.active ? "active" : ""} ${p.loop ? "loop" : ""}" data-action="pad"
            data-scape="${b.scape.id}" data-pad="${p.id}" style="${p.color ? `--c:${esc(p.color)}` : ""}"
            data-tooltip="${esc([p.name, channelLabel(p.channel), p.duck && t("Panel.PadDucks"), p.loop && t("Panel.PadLoops"), t("Panel.PadRightClick")].filter(Boolean).join(" · "))}">
            <i class="${esc(p.icon)}"></i><span>${esc(p.name)}</span>
            ${p.hotkey ? `<kbd>Alt+${p.hotkey}</kbd>` : ""}
          </button>`).join("")}
          <div class="ps-pad-drop">${t("Panel.PadDrop")}</div>
        </div>
      </div>`).join("");
    return `<h3>${t("Panel.Pads")}</h3>${banks}`;
  }

  _mixer(ctx) {
    return ctx.tracks.map(tr => `
      <div class="ps-track ch-${tr.channel}" data-uuid="${tr.uuid}">
        <i class="${CHANNELS[tr.channel]?.icon ?? "fa-solid fa-music"}" data-tooltip="${channelLabel(tr.channel)}"></i>
        <div class="ps-track-name"><span>${esc(tr.name)}</span><small>${esc(tr.playlist)}</small></div>
        <input type="range" class="ps-vol" min="0" max="1" step="0.01" value="${tr.volume}">
        <span class="ps-pct">${Math.round(tr.volume * 100)}%</span>
        ${tr.canNext ? `<a data-action="nextTrack" data-tooltip="${t("Panel.NextTrack")}"><i class="fa-solid fa-forward-step"></i></a>` : "<span></span>"}
        <a data-action="stopTrack" data-tooltip="${t("Panel.FadeOut")}"><i class="fa-solid fa-stop"></i></a>
      </div>`).join("") || `<div class="ps-dim">${t("Panel.Quiet")}</div>`;
  }

  _card(sc, st) {
    const isBase = st.base === sc.id, isOverlay = st.overlays.includes(sc.id);
    const missing = missingCount(sc);
    const scene = sc.sceneId ? game.scenes.get(sc.sceneId) : null;
    const musicLabel = { none: "", keep: t("Panel.KeepsMusic"),
      playlist: fromUuidSync(sc.music.playlistUuid)?.name ?? "?",
      track: fromUuidSync(sc.music.soundUuid)?.name ?? "?" }[sc.music.mode];
    const meta = [
      musicLabel && `<span><i class="fa-solid fa-music"></i> ${esc(musicLabel)}</span>`,
      sc.ambience.length && `<span><i class="fa-solid fa-wind"></i> ${sc.ambience.length}</span>`,
      sc.scatter.length && `<span><i class="fa-solid fa-shuffle"></i> ${sc.scatter.length}</span>`,
      sc.pads.length && `<span><i class="fa-solid fa-table-cells"></i> ${sc.pads.length}</span>`,
      PRESETS[sc.filter.preset] && `<span data-tooltip="${esc(t("Panel.CardFilter", { name: t(`Filters.${sc.filter.preset}.Label`) }))}"><i class="${PRESETS[sc.filter.preset].icon}"></i></span>`,
      scene && `<span data-tooltip="${esc(t("Panel.CardScene", { name: scene.name }))}"><i class="fa-solid fa-map"></i></span>`,
      sc.sticky && `<span data-tooltip="${t("Panel.CardSticky")}"><i class="fa-solid fa-thumbtack"></i></span>`,
      missing && `<span class="ps-warn" data-tooltip="${t("Panel.CardMissing", { n: missing })}"><i class="fa-solid fa-triangle-exclamation"></i> ${missing}</span>`
    ].filter(Boolean).join("");
    const hidden = this.search && !`${sc.name} ${sc.group}`.toLowerCase().includes(this.search.toLowerCase());
    return `
      <div class="ps-card ${isBase ? "base" : ""} ${isOverlay ? "overlay" : ""}" data-action="activate" data-id="${sc.id}"
        style="--c:${esc(sc.color)};${sc.img ? `--img:url('${esc(sc.img)}')` : ""}" ${hidden ? "hidden" : ""}
        data-search="${esc(`${sc.name} ${sc.group}`.toLowerCase())}" ${sc.notes ? `data-tooltip="${esc(sc.notes)}"` : ""}>
        <div class="ps-card-head"><i class="${esc(sc.icon)}"></i><span class="ps-card-name">${esc(sc.name)}</span></div>
        <div class="ps-card-meta">${meta}</div>
        <div class="ps-card-tools">
          <a data-action="moveScape" data-dir="-1" data-tooltip="${t("Panel.MoveLeft")}"><i class="fa-solid fa-chevron-left"></i></a>
          <a data-action="moveScape" data-dir="1" data-tooltip="${t("Panel.MoveRight")}"><i class="fa-solid fa-chevron-right"></i></a>
          <a data-action="preload" data-tooltip="${t("Panel.Preload")}"><i class="fa-solid fa-cloud-arrow-down"></i></a>
          <a data-action="edit" data-tooltip="${t("Common.Edit")}"><i class="fa-solid fa-pen"></i></a>
          <a data-action="duplicate" data-tooltip="${t("Common.Duplicate")}"><i class="fa-solid fa-copy"></i></a>
          <a data-action="remove" data-tooltip="${t("Common.Delete")}"><i class="fa-solid fa-trash"></i></a>
        </div>
      </div>`;
  }

  _replaceHTML(result, content) {
    const scrolls = [...content.querySelectorAll(".ps-scroll")].map(e => e.scrollTop);
    content.innerHTML = result;
    content.querySelectorAll(".ps-scroll").forEach((e, i) => { e.scrollTop = scrolls[i] ?? 0; });
  }

  render(...args) {
    if (this._dragging) { this._pendingRender = true; return this; }
    return super.render(...args);
  }

  _endDrag() {
    if (!this._dragging) return;
    this._dragging = false;
    if (this._pendingRender) { this._pendingRender = false; this.render(); }
  }

  /* ---------------------------------------- */
  /*  Listeners                               */
  /* ---------------------------------------- */

  _onRender() {
    const html = this.element;
    html.querySelector(".ps-search")?.addEventListener("input", ev => {
      this.search = ev.target.value;
      const q = this.search.toLowerCase();
      html.querySelectorAll(".ps-card").forEach(c => { c.hidden = !!q && !c.dataset.search.includes(q); });
    });
    html.querySelector('[data-field="fadeOverride"]')?.addEventListener("change", ev => {
      this.fadeOverride = ev.target.value === "" ? null : Number(ev.target.value);
    });
    html.querySelector('[data-field="combatScape"]')?.addEventListener("change", ev => setSetting("combatScape", ev.target.value));
    html.querySelector('[data-field="cueList"]')?.addEventListener("change", ev => cues.standby(ev.target.value, 0));

    for (const range of html.querySelectorAll(".ps-vol")) {
      const row = range.closest("[data-uuid]");
      range.addEventListener("pointerdown", () => {
        this._dragging = true;
        window.addEventListener("pointerup", () => setTimeout(() => this._endDrag(), 50), { once: true });
      });
      range.addEventListener("input", () => { row.querySelector(".ps-pct").textContent = `${Math.round(range.value * 100)}%`; });
      range.addEventListener("change", async () => {
        await engine.setTrackVolume(fromUuidSync(row.dataset.uuid), Number(range.value));
        this._endDrag();
      });
    }
    for (const pad of html.querySelectorAll(".ps-pad")) {
      pad.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        const p = this._padFrom(pad);
        if (p) engine.stopPad(p);
      });
    }
    // Drop sound files from the desktop (or sounds from the Playlists sidebar) onto a pad bank.
    for (const bank of html.querySelectorAll(".ps-bank")) {
      bank.addEventListener("dragover", ev => { ev.preventDefault(); bank.classList.add("ps-over"); });
      bank.addEventListener("dragleave", ev => { if (!bank.contains(ev.relatedTarget)) bank.classList.remove("ps-over"); });
      bank.addEventListener("drop", ev => {
        ev.preventDefault();
        bank.classList.remove("ps-over");
        this._onBankDrop(bank.dataset.scape, ev);
      });
    }
  }

  /* ---------------------------------------- */
  /*  Handlers                                */
  /* ---------------------------------------- */

  _padFrom(el) {
    return findScape(el.dataset.scape)?.pads.find(p => p.id === el.dataset.pad) ?? null;
  }

  _onActivate(event, target) {
    const id = target.dataset.id;
    if (event.shiftKey) return engine.activate(id, { additive: true, fadeMs: this.fadeOverride });
    return engine.activate(id, { fadeMs: this.fadeOverride });
  }

  _onPad(target) {
    const pad = this._padFrom(target);
    if (pad) engine.playPad(pad);
  }

  _onTarget(userId) {
    if (!userId) this.filterTargets.clear();
    else if (this.filterTargets.has(userId)) this.filterTargets.delete(userId);
    else this.filterTargets.add(userId);
    this.render();
  }

  async _onBankDrop(scapeId, ev) {
    const sc = findScape(scapeId);
    if (!sc) return;
    let newPads = [];
    if (dragHasFiles(ev)) {
      const paths = await uploadAudioFiles(ev.dataTransfer.files, sc.isGlobal ? "global" : sc.name);
      newPads = paths.map(p => normPad({ name: soundName(p), sources: [p] }));
    } else {
      const doc = docFromDrop(ev);
      if (!doc) return;
      const paths = doc.documentName === "Playlist" ? doc.sounds.contents.map(s => s.path).filter(Boolean) : [doc.path];
      newPads = [normPad({ name: doc.name, sources: paths })];
    }
    if (!newPads.length) return;
    const fresh = findScape(scapeId); // the upload may have taken a while
    fresh.pads.push(...newPads);
    await upsertScape(fresh);
    info("Notify.PadsAdded", { n: newPads.length, name: sc.isGlobal ? t("Panel.Global") : sc.name });
  }

  _onEdit(id) {
    if (!id) return;
    new ScapeEditor({ scapeId: id }).render({ force: true });
  }

  async _onNew() {
    const scape = normScape({ name: t("Defaults.Scape") });
    new ScapeEditor({ scapeId: scape.id, draft: scape }).render({ force: true });
  }

  async _onDuplicate(id) {
    const sc = findScape(id);
    if (!sc) return;
    const copy = foundry.utils.deepClone(sc);
    copy.id = randomId();
    copy.name = t("Defaults.Copy", { name: sc.name });
    copy.sceneId = "";
    for (const list of [copy.ambience, copy.scatter, copy.pads]) for (const item of list) item.id = randomId();
    await upsertScape(copy);
  }

  async _onDelete(id) {
    const sc = findScape(id);
    if (!sc) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("Panel.DeleteScapeTitle") },
      content: `<p>${t("Panel.DeleteScapeText", { name: esc(sc.name) })}</p>`
    });
    if (ok) await deleteScape(id);
  }

  async _onMove(id, dir) {
    const list = getScapes();
    const i = list.findIndex(s => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const order = new Map(list.map((s, k) => [s.id, k]));
    const all = getAllScapes().map(s => ({ ...s, sort: order.get(s.id) ?? s.sort }));
    await saveAllScapes(all);
  }

  async _onNewCueList() {
    const list = cues.normCueList({ name: t("Defaults.ListN", { n: cues.getCueLists().length + 1 }) });
    await cues.upsertCueList(list);
    await cues.standby(list.id, 0);
    this.tab = "cues";
    new CueEditor({ listId: list.id }).render({ force: true });
  }

  async _onDeleteCueList() {
    const list = cues.currentList();
    if (!list) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("Panel.DeleteListTitle") },
      content: `<p>${t("Panel.DeleteListText", { name: esc(list.name), n: list.cues.length })}</p>`
    });
    if (ok) await cues.deleteCueList(list.id);
  }

  /* ---------------------------------------- */

  static exportJson() {
    const data = {
      module: MODULE_ID, version: 2, exported: new Date().toISOString(),
      soundscapes: getAllScapes(), cueLists: cues.getCueLists()
    };
    saveFile(JSON.stringify(data, null, 2), "application/json", `planar-soundboard-${game.world.id}.json`);
  }

  static importJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const incoming = (Array.isArray(data) ? data : data.soundscapes ?? []).map(normScape);
        const all = getAllScapes();
        for (const sc of incoming) {
          const i = all.findIndex(s => s.id === sc.id);
          if (i >= 0) all[i] = sc; else all.push(sc);
        }
        await saveAllScapes(all);
        const lists = (data.cueLists ?? []).map(cues.normCueList);
        if (lists.length) {
          const cur = cues.getCueLists();
          for (const l of lists) {
            const i = cur.findIndex(c => c.id === l.id);
            if (i >= 0) cur[i] = l; else cur.push(l);
          }
          await cues.saveCueLists(cur);
        }
        info("Notify.Imported", { scapes: incoming.length, lists: lists.length });
      } catch (err) {
        error("Notify.ImportFailed", { error: err.message });
      }
    });
    input.click();
  }
}
