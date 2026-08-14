window.__ModuleLoader__.load({ id: "dsh-llm-newapi", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/NewApiSection.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var NS = "llm-newapi";
var KEY_REF = "newapi";
function toDraft(source) {
  const models = Array.isArray(source) ? source : [];
  return models.map((entry) => {
    const model = entry ?? {};
    return {
      id: typeof model.id === "string" ? model.id : "",
      name: typeof model.name === "string" ? model.name : "",
      contextWindow: model.contextWindow === void 0 ? "" : String(model.contextWindow),
      maxTokens: model.maxTokens === void 0 ? "" : String(model.maxTokens)
    };
  });
}
function capacity(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return void 0;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : void 0;
}
function toWire(models) {
  return models.map((model) => ({
    id: model.id.trim(),
    ...model.name.trim().length > 0 ? { name: model.name.trim() } : {},
    ...capacity(model.contextWindow) !== void 0 ? { contextWindow: capacity(model.contextWindow) } : {},
    ...capacity(model.maxTokens) !== void 0 ? { maxTokens: capacity(model.maxTokens) } : {}
  }));
}
function NewApiSection(props) {
  const { api, t } = props;
  const [status, setStatus] = (0, import_react.useState)("loading");
  const [errorText, setErrorText] = (0, import_react.useState)(void 0);
  const [revision, setRevision] = (0, import_react.useState)(0);
  const [writable, setWritable] = (0, import_react.useState)(true);
  const [keyConfigured, setKeyConfigured] = (0, import_react.useState)(void 0);
  const [keyLocked, setKeyLocked] = (0, import_react.useState)(false);
  const [baseURL, setBaseURL] = (0, import_react.useState)("");
  const [keyDraft, setKeyDraft] = (0, import_react.useState)("");
  const [models, setModels] = (0, import_react.useState)([]);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [notice, setNotice] = (0, import_react.useState)(void 0);
  const [candidates, setCandidates] = (0, import_react.useState)(void 0);
  const [picked, setPicked] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const load = async () => {
    setStatus("loading");
    setErrorText(void 0);
    try {
      const described = await api.settings.describe({});
      if (!described.result.ok) {
        setErrorText(described.result.error.message);
        setStatus("error");
        return;
      }
      setWritable(described.result.value.writable);
      const section = described.result.value.namespaces.find((entry) => entry.ns === NS);
      if (section === void 0) {
        setErrorText(`${NS}: settings namespace is not registered (is the llm-newapi plugin row loaded?)`);
        setStatus("error");
        return;
      }
      const value = section.value ?? {};
      setRevision(section.revision);
      setBaseURL(typeof value.baseURL === "string" ? value.baseURL : "");
      setModels(toDraft(value.models));
      const credential = await api.credentials.describe({ refs: [KEY_REF] });
      if (credential.result.ok) {
        const view = credential.result.value.credentials[KEY_REF];
        setKeyConfigured(view?.configured);
        setKeyLocked(view?.writable === false);
      }
      setStatus("ready");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
      setStatus("error");
    }
  };
  const patchModel = (at, next) => {
    setModels((current) => current.map((model, index) => index === at ? { ...model, ...next } : model));
  };
  (0, import_react.useEffect)(() => {
    void load();
  }, []);
  const saved = (text) => {
    setNotice(text);
    void load();
  };
  const save = async () => {
    setBusy(true);
    setNotice(void 0);
    setErrorText(void 0);
    try {
      const trimmedBase = baseURL.trim();
      const ops = [];
      if (trimmedBase.length > 0) ops.push({ op: "set", path: ["baseURL"], value: trimmedBase });
      else ops.push({ op: "unset", path: ["baseURL"] });
      ops.push({ op: "set", path: ["models"], value: toWire(models) });
      const mutated = await api.settings.mutate({ ns: NS, ops, expectedRevision: revision });
      if (!mutated.result.ok) {
        setErrorText(mutated.result.error.message);
        return;
      }
      setRevision(mutated.result.value.revision);
      const key = keyDraft.trim();
      if (key.length > 0) {
        const stored = await api.credentials.set({ ref: KEY_REF, value: key });
        if (!stored.result.ok) {
          setErrorText(stored.result.error.message);
          return;
        }
        setKeyDraft("");
      }
      saved(t("saved"));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const fetchModels = async () => {
    setBusy(true);
    setErrorText(void 0);
    setCandidates(void 0);
    try {
      const key = keyDraft.trim();
      const response = await api.llm.discoverModels({
        settingsNs: NS,
        ...baseURL.trim().length > 0 ? { baseURL: baseURL.trim() } : {},
        ...key.length > 0 ? { apiKey: key } : {}
      });
      if (!response.result.ok) {
        setErrorText(response.result.error.message);
        return;
      }
      const found = response.result.value.models;
      if (found.length === 0) {
        setErrorText(t("fetchEmpty"));
        return;
      }
      const known = new Set(models.map((model) => model.id.trim()).filter((id) => id.length > 0));
      setCandidates(found);
      setPicked(new Set(found.filter((model) => !known.has(model.id)).map((model) => model.id)));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const adopt = () => {
    if (candidates === void 0) return;
    const existing = new Map(models.map((model) => [model.id.trim(), model]));
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue;
      if (existing.has(candidate.id)) continue;
      existing.set(candidate.id, {
        id: candidate.id,
        name: candidate.name ?? "",
        contextWindow: candidate.contextWindow === void 0 ? "" : String(candidate.contextWindow),
        maxTokens: candidate.maxTokens === void 0 ? "" : String(candidate.maxTokens)
      });
    }
    setModels([...existing.values()]);
    setCandidates(void 0);
    setPicked(/* @__PURE__ */ new Set());
  };
  const toggle = (id) => {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  if (status === "loading") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { "aria-label": t("nav"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u2026" }) });
  if (status === "error") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": t("nav"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-error", children: `${t("loadFailed")}: ${errorText ?? ""}` }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button", onClick: () => {
        void load();
      }, children: t("retry") })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": t("nav"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("intro") }),
    notice === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: notice }),
    !writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("readOnly") }) : null,
    errorText === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-error", children: errorText }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "newapi-key", children: t("keyInput") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          id: "newapi-key",
          type: "password",
          autoComplete: "off",
          className: "newapi-input",
          disabled: keyLocked,
          placeholder: keyLocked ? t("keyEnvLocked") : keyConfigured === true ? t("keyStored") : keyConfigured === false ? t("keyMissing") : t("keyPlaceholder"),
          value: keyDraft,
          onChange: (event) => {
            setKeyDraft(event.target.value);
          }
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "newapi-base", children: t("baseUrl") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          id: "newapi-base",
          type: "text",
          className: "newapi-input",
          placeholder: t("baseUrlPlaceholder"),
          value: baseURL,
          onChange: (event) => {
            setBaseURL(event.target.value);
          }
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("models") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button", disabled: busy, onClick: () => {
        void fetchModels();
      }, children: busy ? t("fetching") : t("fetchModels") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "newapi-button",
          disabled: busy,
          onClick: () => {
            setModels((current) => [...current, { id: "", name: "", contextWindow: "", maxTokens: "" }]);
          },
          children: t("addModel")
        }
      )
    ] }),
    candidates === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-candidates", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("fetchTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: candidates.map((model) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: picked.has(model.id),
            onChange: () => {
              toggle(model.id);
            }
          }
        ),
        " ",
        model.id,
        model.name === void 0 || model.name === model.id ? "" : ` (${model.name})`
      ] }) }, model.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button newapi-button--primary", disabled: picked.size === 0, onClick: adopt, children: t("fetchAdopt") }),
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button", onClick: () => {
        setCandidates(void 0);
        setPicked(/* @__PURE__ */ new Set());
      }, children: t("fetchCancel") })
    ] }),
    models.map((model, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          className: "newapi-input",
          "aria-label": t("modelId"),
          value: model.id,
          placeholder: t("modelId"),
          onChange: (event) => {
            patchModel(index, { id: event.target.value });
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          className: "newapi-input",
          "aria-label": t("modelName"),
          value: model.name,
          placeholder: t("modelName"),
          onChange: (event) => {
            patchModel(index, { name: event.target.value });
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          className: "newapi-input",
          "aria-label": t("contextWindow"),
          value: model.contextWindow,
          placeholder: t("contextWindow"),
          inputMode: "numeric",
          onChange: (event) => {
            patchModel(index, { contextWindow: event.target.value });
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          className: "newapi-input",
          "aria-label": t("maxTokens"),
          value: model.maxTokens,
          placeholder: t("maxTokens"),
          inputMode: "numeric",
          onChange: (event) => {
            patchModel(index, { maxTokens: event.target.value });
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "newapi-button",
          "aria-label": `${t("removeModel")} ${model.id}`,
          onClick: () => {
            setModels((current) => current.filter((_, at) => at !== index));
          },
          children: "\u2715"
        }
      )
    ] }, index)),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-hint", children: t("modelHint") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button newapi-button--primary", disabled: busy || !writable, onClick: () => {
      void save();
    }, children: busy ? t("applying") : t("apply") })
  ] });
}

// src/client/locale.ts
var zh = {
  nav: "NewAPI",
  intro: "\u914D\u7F6E NewAPI \u7F51\u5173\uFF1AAPI \u5BC6\u94A5\u3001\u7F51\u5173\u5730\u5740\u4E0E\u6A21\u578B\u5217\u8868\u3002\u6A21\u578B\u53D1\u73B0\u53EA\u5217\u51FA\u652F\u6301 chat \u63A5\u53E3\u7684\u6A21\u578B\u3002",
  keyInput: "API \u5BC6\u94A5",
  keyPlaceholder: "\u7C98\u8D34\u4EE4\u724C\uFF1B\u7559\u7A7A\u4FDD\u6301\u5DF2\u5B58\u5BC6\u94A5\u4E0D\u53D8",
  keyStored: "\u5DF2\u914D\u7F6E\uFF08\u4E0D\u56DE\u663E\uFF09",
  keyMissing: "\u672A\u914D\u7F6E",
  keyEnvLocked: "\u7531\u542F\u52A8\u73AF\u5883\u63D0\u4F9B\uFF08\u53EA\u8BFB\uFF09",
  baseUrl: "\u7F51\u5173\u5730\u5740\uFF08\u542B /v1 \u524D\u7F00\uFF09",
  baseUrlPlaceholder: "http://gw.local:3000/v1",
  models: "\u6A21\u578B",
  addModel: "\u6DFB\u52A0\u6A21\u578B",
  removeModel: "\u5220\u9664\u8BE5\u6A21\u578B",
  modelId: "\u6A21\u578B ID",
  modelName: "\u663E\u793A\u540D\u79F0",
  contextWindow: "\u4E0A\u4E0B\u6587\u7A97\u53E3",
  maxTokens: "\u8F93\u51FA\u4E0A\u9650",
  fetchModels: "\u83B7\u53D6\u6A21\u578B",
  fetching: "\u6B63\u5728\u8BE2\u95EE\u7F51\u5173\u2026",
  fetchEmpty: "\u7F51\u5173\u6CA1\u6709\u5217\u51FA\u53EF\u7528\u7684 chat \u6A21\u578B\uFF08embedding / rerank / ranker \u5DF2\u8FC7\u6EE4\uFF09\u3002",
  fetchTitle: "\u9009\u62E9\u8981\u6DFB\u52A0\u7684\u6A21\u578B",
  fetchAdopt: "\u6DFB\u52A0\u6240\u9009",
  fetchCancel: "\u53D6\u6D88",
  apply: "\u4FDD\u5B58",
  applying: "\u6B63\u5728\u4FDD\u5B58\u2026",
  saved: "\u5DF2\u4FDD\u5B58\u3002",
  loadFailed: "\u52A0\u8F7D\u5931\u8D25",
  retry: "\u91CD\u8BD5",
  readOnly: "\u5F53\u524D\u8BBE\u7F6E\u6E90\u53EA\u8BFB\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u3002",
  modelHint: "\u53D1\u73B0\u7ED3\u679C\u6309\u547D\u540D\u8FC7\u6EE4\u975E chat \u6A21\u578B\uFF1B\u53EF\u5728 settings.yaml \u7684 llm-newapi: \u6BB5\u7528 modelExcludePatterns \u8C03\u6574\u3002"
};
var en = {
  nav: "NewAPI",
  intro: "Configure the NewAPI gateway: API key, gateway base URL, and model list. Discovery lists chat-capable models only.",
  keyInput: "API key",
  keyPlaceholder: "Paste the token; leave blank to keep the stored key",
  keyStored: "Configured (never echoed)",
  keyMissing: "Not configured",
  keyEnvLocked: "Provided by the launch environment (read-only)",
  baseUrl: "Gateway base URL (including /v1)",
  baseUrlPlaceholder: "http://gw.local:3000/v1",
  models: "Models",
  addModel: "Add model",
  removeModel: "Remove this model",
  modelId: "Model ID",
  modelName: "Display name",
  contextWindow: "Context window",
  maxTokens: "Max output tokens",
  fetchModels: "Fetch models",
  fetching: "Asking the gateway\u2026",
  fetchEmpty: "The gateway listed no chat-capable models (embedding / rerank / ranker filtered out).",
  fetchTitle: "Choose models to add",
  fetchAdopt: "Add selected",
  fetchCancel: "Cancel",
  apply: "Save",
  applying: "Saving\u2026",
  saved: "Saved.",
  loadFailed: "Load failed",
  retry: "Retry",
  readOnly: "The active settings source is read-only; nothing can be saved.",
  modelHint: "Discovery filters non-chat models by naming convention; tune modelExcludePatterns in the llm-newapi: settings section."
};

// src/client/apply.ts
var NS2 = "settings.newapi";
var SECTION_CSS = `
.newapi-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.newapi-input {
  box-sizing: border-box; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px;
}
.newapi-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.newapi-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.newapi-input:disabled { opacity: 0.6; cursor: default; }
.newapi-button {
  padding: 6px 12px; border-radius: 6px; font: inherit; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.newapi-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.newapi-button:disabled { opacity: 0.4; cursor: default; }
.newapi-button--primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.newapi-button--primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.newapi-toolbar { display: flex; flex-direction: row; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.newapi-row { display: grid; grid-template-columns: 2fr 2fr 1fr 1fr auto; gap: 8px; margin-bottom: 8px; align-items: center; }
.newapi-candidates { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.newapi-candidates ul { list-style: none; padding: 0; margin: 8px 0; }
.newapi-error { color: var(--dsw-alias-state-error-primary); }
.newapi-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
`;
var inject = ["slots", "locale", "connection"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS2, { zh, en }), "llm-newapi: copy dictionaries");
  if (typeof document !== "undefined") {
    ctx.effect(() => {
      const element = document.createElement("style");
      element.textContent = SECTION_CSS;
      document.head.append(element);
      return () => {
        element.remove();
      };
    }, "llm-newapi: section styles");
  }
  const connection = ctx.get("connection");
  const t = ctx.locale.bind(NS2);
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "newapi",
    order: 15,
    label: () => t("nav"),
    inject: () => ({ api: connection.api, t })
  }, NewApiSection));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
