// Planar Soundboard — cue list editor.

import { CHANNELS, channelLabel, esc, getScapes, getGlobalScape, FilePickerCls } from "./store.mjs";
import { PRESETS } from "./fxgraph.mjs";
import { t, info } from "./i18n.mjs";
import { ACTION_TYPES, actionLabel, normAction, normCue, normCueList, getCueLists, upsertCueList, fireCue } from "./cues.mjs";

const { ApplicationV2 } = foundry.applications.api;
const OPEN = new Set();

export class CueEditor extends ApplicationV2 {
  static instances() { return [...OPEN]; }

  constructor({ listId, ...options } = {}) {
    super({ id: `planar-soundboard-cues-${listId}`, ...options });
    this.listId = listId;
    this.list = normCueList(getCueLists().find(l => l.id === listId) ?? { id: listId });
    this.collapsed = new Set();
  }

  static DEFAULT_OPTIONS = {
    classes: ["planar-soundboard", "ps-app", "ps-editor", "ps-cue-editor"],
    tag: "div",
    window: { title: "PLANAR_SOUNDBOARD.CueEditor.WindowTitle", icon: "fa-solid fa-list-ol", resizable: true },
    position: { width: 760, height: 780 },
    actions: {
      save: function () { return this._save(); },
      cancel: function () { return this.close(); },
      addCue: function () { this.list.cues.push(normCue({ name: t("Defaults.CueN", { n: this.list.cues.length + 1 }) })); this.render(); },
      removeCue: function (ev, el) { this.list.cues.splice(Number(el.dataset.cue), 1); this.render(); },
      moveCue: function (ev, el) { this._move(this.list.cues, Number(el.dataset.cue), Number(el.dataset.dir)); },
      dupCue: function (ev, el) { return this._dupCue(Number(el.dataset.cue)); },
      testCue: function (ev, el) { return fireCue(normCue(this.list.cues[Number(el.dataset.cue)])); },
      copyLink: function (ev, el) { return this._copyLink(Number(el.dataset.cue)); },
      toggleCue: function (ev, el) {
        const id = this.list.cues[Number(el.dataset.cue)]?.id;
        if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
        this.render();
      },
      removeAction: function (ev, el) { this.list.cues[Number(el.dataset.cue)].actions.splice(Number(el.dataset.act), 1); this.render(); },
      moveAction: function (ev, el) { this._move(this.list.cues[Number(el.dataset.cue)].actions, Number(el.dataset.act), Number(el.dataset.dir)); },
      pickFile: function (ev, el) { return this._pickFile(Number(el.dataset.cue), Number(el.dataset.act)); }
    }
  };

  get title() { return t("CueEditor.Title", { name: this.list.name }); }
  _onFirstRender() { OPEN.add(this); }
  async close(options) { OPEN.delete(this); return super.close(options); }

  async _prepareContext() { return {}; }

  /* ---------------------------------------- */
  /*  Rendering                               */
  /* ---------------------------------------- */

  async _renderHTML() {
    const cues = this.list.cues.map((c, i) => this._cueBlock(c, i)).join("");
    return `<div class="ps-editor-body ps-scroll">
      <section class="ps-sec">
        <div class="ps-form"><label class="ps-wide">${t("CueEditor.ListName")} <input type="text" data-field="name" value="${esc(this.list.name)}" data-rerender-title></label></div>
        <p class="ps-hint">${t("CueEditor.Hint")}</p>
      </section>
      ${cues || `<p class="ps-dim ps-center">${t("CueEditor.Empty")}</p>`}
      <button type="button" class="ps-addcue" data-action="addCue"><i class="fa-solid fa-plus"></i> ${t("CueEditor.AddCue")}</button>
    </div>
    <footer class="ps-footer">
      <span class="ps-flex"></span>
      <button type="button" data-action="cancel">${t("Common.Cancel")}</button>
      <button type="button" class="ps-primary" data-action="save"><i class="fa-solid fa-floppy-disk"></i> ${t("Common.Save")}</button>
    </footer>`;
  }

  _cueBlock(c, i) {
    const collapsed = this.collapsed.has(c.id);
    const actions = c.actions.map((a, j) => this._actionRow(a, i, j)).join("");
    const adder = `<select class="ps-adder" data-add-action="${i}"><option value="">${t("CueEditor.AddAction")}</option>${Object.keys(ACTION_TYPES)
      .map(k => `<option value="${k}">${actionLabel(k)}</option>`).join("")}</select>`;
    return `<section class="ps-sec ps-cue-edit" style="${c.color ? `--c:${esc(c.color)}` : ""}">
      <div class="ps-cue-edit-head">
        <a data-action="toggleCue" data-cue="${i}" data-tooltip="${t(collapsed ? "CueEditor.Expand" : "CueEditor.Collapse")}">
          <i class="fa-solid fa-chevron-${collapsed ? "right" : "down"}"></i></a>
        <span class="ps-cue-num">${i + 1}</span>
        <input type="text" class="ps-cue-title" data-field="cues.${i}.name" value="${esc(c.name)}">
        <input type="color" data-field="cues.${i}.color" value="${esc(c.color || "#8a6cf0")}" data-tooltip="${t("Editor.Colour")}">
        <label class="ps-inline ps-af" data-tooltip="${t("CueEditor.AutoFollowHint")}">
          <i class="fa-solid fa-arrow-turn-down"></i>
          <input type="number" min="0" step="0.5" placeholder="—" data-field="cues.${i}.autoFollow" value="${c.autoFollow ?? ""}"> s</label>
        <span class="ps-flex"></span>
        <a data-action="testCue" data-cue="${i}" data-tooltip="${t("CueEditor.Test")}"><i class="fa-solid fa-play"></i></a>
        <a data-action="copyLink" data-cue="${i}" data-tooltip="${t("CueEditor.CopyLink")}"><i class="fa-solid fa-link"></i></a>
        <a data-action="moveCue" data-cue="${i}" data-dir="-1" data-tooltip="${t("Common.MoveUp")}"><i class="fa-solid fa-arrow-up"></i></a>
        <a data-action="moveCue" data-cue="${i}" data-dir="1" data-tooltip="${t("Common.MoveDown")}"><i class="fa-solid fa-arrow-down"></i></a>
        <a data-action="dupCue" data-cue="${i}" data-tooltip="${t("Common.Duplicate")}"><i class="fa-solid fa-copy"></i></a>
        <a data-action="removeCue" data-cue="${i}" data-tooltip="${t("CueEditor.DeleteCue")}"><i class="fa-solid fa-trash"></i></a>
      </div>
      ${collapsed ? "" : `
      <input type="text" class="ps-cue-notesfield" data-field="cues.${i}.notes" value="${esc(c.notes)}" placeholder="${t("CueEditor.NotesPlaceholder")}">
      <div class="ps-actions">${actions || `<p class="ps-dim">${t("CueEditor.NoActions")}</p>`}</div>
      <div class="ps-row">${adder}</div>`}
    </section>`;
  }

  _actionRow(a, i, j) {
    const p = `cues.${i}.actions.${j}`;
    const type = ACTION_TYPES[a.type];
    const sel = (field, options, value, attrs = "") => `<select data-field="${p}.${field}" ${attrs}>${options.map(([v, l]) =>
      `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const scapeOpts = [["", t("CueEditor.Choose")], ...getScapes().map(s => [s.id, s.name])];
    const onOff = [["true", t("Common.On")], ["false", t("Common.Off")]];
    let fields = "";
    switch (a.type) {
      case "scape":
        fields = `${sel("scapeId", scapeOpts, a.scapeId)}
          ${sel("mode", ["switch", "layerOn", "layerOff"].map(m => [m, t(`CueEditor.ScapeModes.${m}`)]), a.mode)}
          <label class="ps-inline">${t("CueEditor.Fade")} <input type="number" min="0" step="0.1" placeholder="${t("Common.Default")}" data-field="${p}.fade" value="${a.fade ?? ""}"> s</label>`;
        break;
      case "pad": {
        const groups = [getGlobalScape(), ...getScapes()].filter(s => s?.pads.length).map(s =>
          `<optgroup label="${esc(s.isGlobal ? t("Panel.Global") : s.name)}">${s.pads.map(pd => {
            const key = `${s.id}|${pd.id}`;
            return `<option value="${key}" ${a.scapeId === s.id && a.padId === pd.id ? "selected" : ""}>${esc(pd.name)}</option>`;
          }).join("")}</optgroup>`).join("");
        fields = `<select data-field="${p}.padKey"><option value="">${t("CueEditor.ChoosePad")}</option>${groups}</select>`;
        break;
      }
      case "filter": {
        const players = game.users.filter(u => !u.isGM);
        fields = `${sel("on", onOff, a.on)}
          ${sel("preset", Object.keys(PRESETS).map(k => [k, t(`Filters.${k}.Label`)]), a.preset)}
          <span class="ps-tgts ps-inline-tgts">${t("CueEditor.For")}
            <label><input type="checkbox" data-targets="${p}" data-user="" ${a.targets.length ? "" : "checked"}> ${t("CueEditor.Everyone")}</label>
            ${players.map(u => `<label><input type="checkbox" data-targets="${p}" data-user="${u.id}" ${a.targets.includes(u.id) ? "checked" : ""}>
              ${esc(u.character?.name ?? u.name)}</label>`).join("")}
          </span>
          ${a.on ? `<label class="ps-inline">${t("CueEditor.Strength")} <input type="range" min="0.1" max="1" step="0.05" data-field="${p}.intensity" value="${a.intensity}"></label>` : ""}`;
        break;
      }
      case "narrate":
        fields = sel("on", [["true", t("CueEditor.NarrateOn")], ["false", t("Common.Off")]], a.on);
        break;
      case "play":
        fields = `<span class="ps-inline ps-grow"><input type="text" data-field="${p}.src" value="${esc(a.src)}" placeholder="path/to/sound.ogg">
            <button type="button" data-action="pickFile" data-cue="${i}" data-act="${j}"><i class="fa-solid fa-folder-open"></i></button></span>
          ${sel("channel", Object.keys(CHANNELS).map(k => [k, channelLabel(k)]), a.channel)}
          <label class="ps-inline">${t("CueEditor.Vol")} <input type="range" min="0" max="1" step="0.05" data-field="${p}.volume" value="${a.volume}"></label>`;
        break;
      case "macro": {
        const macros = (game.macros?.contents ?? []).filter(m => m.canExecute ?? true).sort((x, y) => x.name.localeCompare(y.name));
        fields = sel("macroUuid", [["", t("CueEditor.ChooseMacro")], ...macros.map(m => [m.uuid, m.name])], a.macroUuid);
        break;
      }
      case "wait":
        fields = `<label class="ps-inline"><input type="number" min="0" step="0.5" data-field="${p}.seconds" value="${a.seconds}"> ${t("CueEditor.Seconds")}</label>`;
        break;
      case "silence":
        fields = `<label class="ps-inline">${t("CueEditor.SilenceOver")} <input type="number" min="0" step="0.1" placeholder="${t("Common.Default")}" data-field="${p}.fade" value="${a.fade ?? ""}"> s</label>`;
        break;
    }
    return `<div class="ps-action">
      <span class="ps-action-type"><i class="${type.icon}"></i> ${actionLabel(a.type)}</span>
      <div class="ps-action-fields">${fields}</div>
      <span class="ps-action-tools">
        <a data-action="moveAction" data-cue="${i}" data-act="${j}" data-dir="-1" data-tooltip="${t("Common.MoveUp")}"><i class="fa-solid fa-arrow-up"></i></a>
        <a data-action="moveAction" data-cue="${i}" data-act="${j}" data-dir="1" data-tooltip="${t("Common.MoveDown")}"><i class="fa-solid fa-arrow-down"></i></a>
        <a data-action="removeAction" data-cue="${i}" data-act="${j}" data-tooltip="${t("Common.Remove")}"><i class="fa-solid fa-xmark"></i></a>
      </span>
    </div>`;
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
    for (const el of html.querySelectorAll("[data-field]")) el.addEventListener("change", ev => this._onField(ev));
    for (const el of html.querySelectorAll("[data-add-action]")) {
      el.addEventListener("change", () => {
        if (!el.value) return;
        this.list.cues[Number(el.dataset.addAction)].actions.push(normAction({ type: el.value }));
        this.render();
      });
    }
    for (const el of html.querySelectorAll("[data-targets]")) {
      el.addEventListener("change", () => {
        const action = foundry.utils.getProperty(this.list, el.dataset.targets);
        const uid = el.dataset.user;
        if (!uid) action.targets = [];
        else if (el.checked) action.targets = [...new Set([...action.targets, uid])];
        else action.targets = action.targets.filter(t => t !== uid);
        this.render();
      });
    }
  }

  _onField(ev) {
    const el = ev.currentTarget;
    let value;
    if (el.type === "checkbox") value = el.checked;
    else if (el.type === "number" || el.type === "range") value = el.value === "" ? null : Number(el.value);
    else value = el.value;
    const path = el.dataset.field;
    foundry.utils.setProperty(this.list, path, value);
    // Re-normalise the action this field belongs to (e.g. "on" strings, pad keys).
    const m = path.match(/^cues\.(\d+)\.actions\.(\d+)\./);
    if (m) {
      const cue = this.list.cues[Number(m[1])];
      cue.actions[Number(m[2])] = normAction(cue.actions[Number(m[2])]);
      if (/\.(on|preset)$/.test(path)) this.render();
    }
    if ("rerenderTitle" in el.dataset && this.window?.title) this.window.title.textContent = this.title;
  }

  _move(arr, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.render();
  }

  _dupCue(i) {
    const copy = foundry.utils.deepClone(this.list.cues[i]);
    copy.id = undefined;
    copy.name = t("Defaults.Copy", { name: copy.name });
    copy.actions = copy.actions.map(a => ({ ...a, id: undefined }));
    this.list.cues.splice(i + 1, 0, normCue(copy));
    this.render();
  }

  async _copyLink(i) {
    const text = `@Cue[${this.list.cues[i].name}]`;
    try {
      if (game.clipboard?.copyPlainText) game.clipboard.copyPlainText(text);
      else await navigator.clipboard.writeText(text);
      info("Notify.LinkCopied", { link: text });
    } catch {
      info("Notify.LinkText", { link: text });
    }
  }

  _pickFile(i, j) {
    const FP = FilePickerCls();
    new FP({
      type: "audio",
      callback: path => {
        const a = this.list.cues[i].actions[j];
        a.src = path;
        this.render();
      }
    }).render(true);
  }

  async _save() {
    await upsertCueList(normCueList(this.list));
    info("Notify.CueListSaved", { name: this.list.name });
    await this.close();
  }
}
