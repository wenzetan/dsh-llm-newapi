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
function textOf(model, key) {
  const value = model[key];
  return typeof value === "string" ? value : "";
}
function numberOf(model, key) {
  const value = model[key];
  return typeof value === "number" ? value : void 0;
}
var CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;
var CAPACITY_SCALE = { k: 1e3, m: 1e6 };
function parseCapacity(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return void 0;
  const match = CAPACITY_PATTERN.exec(trimmed);
  if (match === null) return Number.NaN;
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
  const scaled = Number(match[1]) * scale;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}
function formatCapacity(value) {
  if (!Number.isInteger(value) || value <= 0) return String(value);
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`;
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`;
  return String(value);
}
var CAPACITY_HINT = {
  contextWindow: "128K",
  maxTokens: "8K"
};
function IconChevron({ open }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      width: "14",
      height: "14",
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": true,
      style: { transform: open ? "rotate(90deg)" : void 0, transition: "transform 120ms ease" },
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6 3.5L10.5 8L6 12.5", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" })
    }
  );
}
function IconTrash() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "path",
    {
      d: "M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4",
      stroke: "currentColor",
      strokeWidth: "1.3",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }
  ) });
}
var NS = "llm-newapi";
var KEY_REF = "newapi";
var DEFAULT_PROXY_URL = "http://127.0.0.1:7890";
function toDrafts(source) {
  if (!Array.isArray(source)) return [];
  return source.map((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {});
}
var EFFORT_RUNG = {
  max: 7,
  xhigh: 6,
  high: 5,
  medium: 4,
  low: 3,
  minimal: 2,
  none: 1,
  default: 0
};
function highestOf(efforts) {
  const ids = efforts.filter((effort) => typeof effort === "string");
  return [...ids].sort((a, b) => (EFFORT_RUNG[b] ?? -1) - (EFFORT_RUNG[a] ?? -1))[0] ?? "";
}
function bufferKey(index, field) {
  return `${String(index)}:${field}`;
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
  const [expanded, setExpanded] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [editing, setEditing] = (0, import_react.useState)(/* @__PURE__ */ new Map());
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [notice, setNotice] = (0, import_react.useState)(void 0);
  const [candidates, setCandidates] = (0, import_react.useState)(void 0);
  const [picked, setPicked] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [proxyEnabled, setProxyEnabled] = (0, import_react.useState)(false);
  const [proxyUrl, setProxyUrl] = (0, import_react.useState)(DEFAULT_PROXY_URL);
  const [params, setParams] = (0, import_react.useState)(void 0);
  const [paramChoices, setParamChoices] = (0, import_react.useState)(/* @__PURE__ */ new Map());
  const [paramsBusy, setParamsBusy] = (0, import_react.useState)(false);
  const paramsRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    paramsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [params]);
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
      setModels(toDrafts(value.models));
      const proxy = value.proxy ?? {};
      setProxyEnabled(proxy.enabled === true);
      if (typeof proxy.url === "string" && proxy.url.length > 0) setProxyUrl(proxy.url);
      setExpanded(/* @__PURE__ */ new Set());
      setEditing(/* @__PURE__ */ new Map());
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
  (0, import_react.useEffect)(() => {
    void load();
  }, []);
  const saved = (text) => {
    setNotice(text);
    void load();
  };
  const catalogProblem = () => {
    const seen = /* @__PURE__ */ new Set();
    for (const [index, model] of models.entries()) {
      const id = textOf(model, "id").trim();
      if (id.length === 0) return `${t("modelIdRequired")} (${t("models")} ${String(index + 1)})`;
      if (seen.has(id)) return `${t("modelIdDuplicate")} (${id})`;
      seen.add(id);
      for (const field of ["contextWindow", "maxTokens"]) {
        const buffer = editing.get(bufferKey(index, field));
        if (buffer !== void 0 && Number.isNaN(parseCapacity(buffer) ?? 0)) {
          return `${t("capacityInvalid")} (${id} \xB7 ${t(field)})`;
        }
      }
    }
    return void 0;
  };
  const save = async () => {
    const problem = catalogProblem();
    if (problem !== void 0) {
      setErrorText(problem);
      return;
    }
    setBusy(true);
    setNotice(void 0);
    setErrorText(void 0);
    try {
      const trimmedBase = baseURL.trim();
      const ops = [];
      if (trimmedBase.length > 0) ops.push({ op: "set", path: ["baseURL"], value: trimmedBase });
      else ops.push({ op: "unset", path: ["baseURL"] });
      ops.push({
        op: "set",
        path: ["proxy"],
        value: { enabled: proxyEnabled, url: proxyUrl.trim().length > 0 ? proxyUrl.trim() : DEFAULT_PROXY_URL }
      });
      ops.push({
        op: "set",
        path: ["models"],
        value: models.map((model) => {
          const id = textOf(model, "id").trim();
          const name = textOf(model, "name").trim();
          const contextWindow = numberOf(model, "contextWindow");
          const maxTokens = numberOf(model, "maxTokens");
          const efforts = Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts.filter((effort) => typeof effort === "string" && effort.length > 0) : [];
          const preset = typeof model.defaultReasoningEffort === "string" && efforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : void 0;
          return {
            id,
            ...name.length > 0 ? { name } : {},
            ...contextWindow !== void 0 ? { contextWindow } : {},
            ...maxTokens !== void 0 ? { maxTokens } : {},
            ...efforts.length > 0 ? { reasoningEfforts: efforts } : {},
            ...preset !== void 0 ? { defaultReasoningEffort: preset } : {}
          };
        })
      });
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
        provider: "newapi",
        ...baseURL.trim().length > 0 ? { baseURL: baseURL.trim() } : {},
        ...key.length > 0 ? { apiKey: key } : {}
      });
      if (!response.result.ok) {
        setErrorText(response.result.error.message);
        return;
      }
      const found = response.result.value.models;
      found.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      if (found.length === 0) {
        setErrorText(t("fetchEmpty"));
        return;
      }
      const known = new Set(models.map((model) => textOf(model, "id")));
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
    const existing = new Map(models.map((model) => [textOf(model, "id"), model]));
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue;
      if (existing.has(candidate.id)) continue;
      existing.set(candidate.id, {
        id: candidate.id,
        ...candidate.name === void 0 ? {} : { name: candidate.name },
        ...candidate.contextWindow === void 0 ? {} : { contextWindow: candidate.contextWindow },
        ...candidate.maxTokens === void 0 ? {} : { maxTokens: candidate.maxTokens }
      });
    }
    setModels([...existing.values()].sort((a, b) => {
      const ai = textOf(a, "id").trim();
      const bi = textOf(b, "id").trim();
      if (ai.length === 0) return bi.length === 0 ? 0 : 1;
      if (bi.length === 0) return -1;
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    }));
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
  const updateParams = async () => {
    const ids = models.map((model) => textOf(model, "id").trim()).filter((id) => id.length > 0);
    if (ids.length === 0) {
      setErrorText(t("paramsNoModels"));
      return;
    }
    setParamsBusy(true);
    setErrorText(void 0);
    setParams(void 0);
    try {
      const response = await props.fetchModelParams({
        modelIds: ids,
        ...proxyEnabled && proxyUrl.trim().length > 0 ? { proxyUrl: proxyUrl.trim() } : {}
      });
      if (!response.ok) {
        setErrorText(response.error.message);
        return;
      }
      setParams(response.value);
      setParamChoices(/* @__PURE__ */ new Map());
      const matched = response.value.models.filter((entry) => entry.matches.length > 0).length;
      setNotice(
        t("paramsSummary").replace("{matched}", String(matched)).replace("{unmatched}", String(response.value.models.length - matched))
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setParamsBusy(false);
    }
  };
  const chosenMatch = (entry) => entry.matches[paramChoices.get(entry.id) ?? 0] ?? entry.matches[0];
  const applyParams = (overwrite) => {
    if (params === void 0) return;
    const byId = new Map(params.models.map((entry) => [entry.id, entry]));
    let touched = 0;
    const next = models.map((model) => {
      const id = textOf(model, "id").trim();
      const entry = byId.get(id);
      const match = entry === void 0 || entry.matches.length === 0 ? void 0 : chosenMatch(entry);
      if (match === void 0) return model;
      const nextContext = match.contextWindow;
      const nextMax = match.maxTokens;
      const nextEfforts = match.reasoningEfforts;
      const currentContext = numberOf(model, "contextWindow");
      const currentMax = numberOf(model, "maxTokens");
      const hasEfforts = Array.isArray(model.reasoningEfforts);
      const takeContext = nextContext !== void 0 && (overwrite || currentContext === void 0);
      const takeMax = nextMax !== void 0 && (overwrite || currentMax === void 0);
      const takeEfforts = nextEfforts !== void 0 && nextEfforts.length > 0 && (overwrite || !hasEfforts);
      if (!takeContext && !takeMax && !takeEfforts) return model;
      touched += 1;
      return {
        ...model,
        ...takeContext && nextContext !== void 0 ? { contextWindow: nextContext } : {},
        ...takeMax && nextMax !== void 0 ? { maxTokens: nextMax } : {},
        ...takeEfforts && nextEfforts !== void 0 ? { reasoningEfforts: nextEfforts } : {}
      };
    });
    setModels(next);
    setParams(void 0);
    setParamChoices(/* @__PURE__ */ new Map());
    setNotice(`${t("paramsApplied")} (${String(touched)})`);
  };
  const patch = (index, next) => {
    setModels((current) => current.map((model, at) => {
      if (at !== index) return model;
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === void 0 || value === "").map(([key]) => key)
      );
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key))
      );
    }));
  };
  const toggleExpanded = (index) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };
  const capacityText = (model, index, field) => editing.get(bufferKey(index, field)) ?? (numberOf(model, field) === void 0 ? "" : formatCapacity(numberOf(model, field)));
  const editCapacity = (index, field, text) => {
    setEditing((current) => new Map(current).set(bufferKey(index, field), text));
    patch(index, { [field]: parseCapacity(text) });
  };
  const reindexOnRemove = (current, index) => {
    const next = /* @__PURE__ */ new Map();
    for (const [key, value] of current) {
      const at = Number(key.slice(0, key.indexOf(":")));
      if (at === index) continue;
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value);
    }
    return next;
  };
  const removeModel = (index) => {
    setModels((current) => current.filter((_model, at) => at !== index));
    setExpanded((current) => {
      const next = /* @__PURE__ */ new Set();
      for (const at of current) {
        if (at < index) next.add(at);
        else if (at > index) next.add(at - 1);
      }
      return next;
    });
    setEditing((current) => reindexOnRemove(current, index));
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
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "newapi-catalog", "aria-label": t("models"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-catalog-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-catalog-title", children: t("models") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-catalog-actions", style: { display: "flex", gap: 4 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-linkbutton", disabled: busy, onClick: () => {
            void fetchModels();
          }, children: busy ? t("fetching") : t("fetchModels") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-linkbutton", disabled: paramsBusy, onClick: () => {
            void updateParams();
          }, children: paramsBusy ? t("paramsFetching") : t("updateParams") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-linkbutton", disabled: busy || models.length === 0, onClick: () => {
            setModels([]);
            setExpanded(/* @__PURE__ */ new Set());
            setEditing(/* @__PURE__ */ new Map());
            setParams(void 0);
            setParamChoices(/* @__PURE__ */ new Map());
          }, children: t("clearModels") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-proxyrow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              checked: proxyEnabled,
              "aria-label": t("proxyToggle"),
              onChange: (event) => {
                setProxyEnabled(event.target.checked);
              }
            }
          ),
          t("proxyToggle")
        ] }),
        proxyEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "newapi-input",
            type: "text",
            style: { maxWidth: 220 },
            "aria-label": t("proxyUrl"),
            placeholder: DEFAULT_PROXY_URL,
            value: proxyUrl,
            onChange: (event) => {
              setProxyUrl(event.target.value);
            }
          }
        ) : null
      ] }),
      models.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-empty", children: t("modelsEmpty") }) : null,
      models.map((model, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-entry", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-modelrow", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              className: "newapi-input",
              type: "text",
              value: textOf(model, "id"),
              placeholder: t("modelId"),
              "aria-label": `${t("modelId")} ${String(index + 1)}`,
              onChange: (event) => {
                patch(index, { id: event.target.value });
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              className: "newapi-input",
              type: "text",
              value: textOf(model, "name"),
              placeholder: t("modelName"),
              "aria-label": `${t("modelName")} ${String(index + 1)}`,
              onChange: (event) => {
                patch(index, { name: event.target.value === "" ? void 0 : event.target.value });
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "newapi-iconbutton",
              "aria-label": `${t("modelAdvanced")} ${String(index + 1)}`,
              "aria-expanded": expanded.has(index),
              title: t("modelAdvanced"),
              onClick: () => {
                toggleExpanded(index);
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconChevron, { open: expanded.has(index) })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "newapi-iconbutton newapi-iconbutton--danger",
              "aria-label": `${t("removeModel")} ${String(index + 1)}`,
              title: t("removeModel"),
              onClick: () => {
                removeModel(index);
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconTrash, {})
            }
          )
        ] }),
        expanded.has(index) ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-modeladvanced", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "newapi-modelfield", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-modelfield-label", children: t("contextWindow") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "newapi-input",
                type: "text",
                inputMode: "numeric",
                value: capacityText(model, index, "contextWindow"),
                placeholder: CAPACITY_HINT.contextWindow,
                "aria-label": `${t("contextWindow")} ${String(index + 1)}`,
                onChange: (event) => {
                  editCapacity(index, "contextWindow", event.target.value);
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "newapi-modelfield", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-modelfield-label", children: t("maxTokens") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "newapi-input",
                type: "text",
                inputMode: "numeric",
                value: capacityText(model, index, "maxTokens"),
                placeholder: CAPACITY_HINT.maxTokens,
                "aria-label": `${t("maxTokens")} ${String(index + 1)}`,
                onChange: (event) => {
                  editCapacity(index, "maxTokens", event.target.value);
                }
              }
            )
          ] }),
          Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "newapi-modelfield", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-modelfield-label", children: t("modelReasoning") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "select",
              {
                className: "newapi-select",
                "aria-label": `${t("defaultEffort")} ${String(index + 1)}`,
                value: typeof model.defaultReasoningEffort === "string" && model.reasoningEfforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : highestOf(model.reasoningEfforts),
                onChange: (event) => {
                  patch(index, { defaultReasoningEffort: event.target.value });
                },
                children: model.reasoningEfforts.map((effort) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: effort, children: effort }, effort))
              }
            )
          ] }) : null
        ] }) : null
      ] }, index)),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "newapi-addmodel",
          disabled: busy,
          onClick: () => {
            setModels((current) => [...current, { id: "" }]);
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
    params === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-params", ref: paramsRef, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("paramsTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "newapi-params-summary", children: t("paramsSummary").replace("{matched}", String(params.models.filter((entry) => entry.matches.length > 0).length)).replace("{unmatched}", String(params.models.filter((entry) => entry.matches.length === 0).length)) }),
      params.models.map((entry) => {
        if (entry.matches.length === 0) {
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-params-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-id", children: entry.id }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-unmatched", children: t("paramsUnmatched") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {})
          ] }, entry.id);
        }
        if (entry.matches.length === 1) {
          const match2 = entry.matches[0];
          if (match2 === void 0) return null;
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-params-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-id", children: entry.id }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-values", children: `${match2.official === true ? `${t("officialMark")} \xB7 ` : ""}${match2.provider} \xB7 ${t("contextWindow")} ${match2.contextWindow ?? "\u2014"} / ${t("maxTokens")} ${match2.maxTokens ?? "\u2014"}${match2.reasoningEfforts !== void 0 && match2.reasoningEfforts.length > 0 ? ` \xB7 ${t("modelReasoning")}: ${match2.reasoningEfforts.join("/")}` : ""}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {})
          ] }, entry.id);
        }
        const chosen = paramChoices.get(entry.id) ?? 0;
        const match = entry.matches[chosen] ?? entry.matches[0];
        if (match === void 0) return null;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "newapi-params-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-id", children: entry.id }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "select",
            {
              className: "newapi-select",
              "aria-label": `${t("paramsProvider")} ${entry.id}`,
              value: String(chosen),
              onChange: (event) => {
                setParamChoices((current) => new Map(current).set(entry.id, Number(event.target.value)));
              },
              children: entry.matches.map((candidate, at) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: String(at), children: `${candidate.official === true ? `${t("officialMark")} \xB7 ` : ""}${candidate.provider}: ${t("contextWindow")} ${candidate.contextWindow ?? "\u2014"} / ${t("maxTokens")} ${candidate.maxTokens ?? "\u2014"}${candidate.reasoningEfforts !== void 0 && candidate.reasoningEfforts.length > 0 ? ` \xB7 ${t("modelReasoning")}: ${candidate.reasoningEfforts.join("/")}` : ""}` }, candidate.provider))
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "newapi-params-values", children: match.provider })
        ] }, entry.id);
      }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, marginTop: 10 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button newapi-button--primary", onClick: () => {
          applyParams(true);
        }, children: t("paramsOverwrite") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button", onClick: () => {
          applyParams(false);
        }, children: t("paramsFillBlank") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "newapi-button", onClick: () => {
          setParams(void 0);
          setParamChoices(/* @__PURE__ */ new Map());
        }, children: t("fetchCancel") })
      ] })
    ] }),
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
  modelsEmpty: "\u6682\u65E0\u6A21\u578B\uFF1A\u70B9\u300C\u6DFB\u52A0\u6A21\u578B\u300D\u624B\u52A8\u65B0\u589E\uFF0C\u6216\u300C\u83B7\u53D6\u6A21\u578B\u300D\u4ECE\u7F51\u5173\u62C9\u53D6\u3002",
  clearModels: "\u6E05\u7A7A",
  addModel: "\u6DFB\u52A0\u6A21\u578B",
  removeModel: "\u5220\u9664\u8BE5\u6A21\u578B",
  modelAdvanced: "\u9AD8\u7EA7\u8BBE\u7F6E\uFF08\u4E0A\u4E0B\u6587 / \u8F93\u51FA\u4E0A\u9650\uFF09",
  modelId: "\u6A21\u578B ID",
  modelName: "\u663E\u793A\u540D\u79F0",
  contextWindow: "\u4E0A\u4E0B\u6587\u7A97\u53E3",
  maxTokens: "\u8F93\u51FA\u4E0A\u9650",
  modelReasoning: "\u601D\u8003\u7B49\u7EA7",
  defaultEffort: "\u9884\u8BBE\u601D\u8003\u7B49\u7EA7\uFF08\u5207\u6362\u6A21\u5F0F\u65F6\u81EA\u52A8\u9009\u62E9\uFF09",
  modelIdRequired: "\u6A21\u578B ID \u4E0D\u80FD\u4E3A\u7A7A",
  modelIdDuplicate: "\u6A21\u578B ID \u91CD\u590D",
  capacityInvalid: "\u5BB9\u91CF\u9700\u4E3A\u6B63\u6570\uFF0C\u53EF\u7528 K/M \u7F29\u5199\uFF08\u5982 128K\u30011M\uFF09",
  fetchModels: "\u83B7\u53D6\u6A21\u578B",
  fetching: "\u6B63\u5728\u8BE2\u95EE\u7F51\u5173\u2026",
  fetchEmpty: "\u7F51\u5173\u6CA1\u6709\u5217\u51FA\u53EF\u7528\u7684 chat \u6A21\u578B\uFF08embedding / rerank / ranker \u5DF2\u8FC7\u6EE4\uFF09\u3002",
  fetchTitle: "\u9009\u62E9\u8981\u6DFB\u52A0\u7684\u6A21\u578B",
  fetchAdopt: "\u6DFB\u52A0\u6240\u9009",
  fetchCancel: "\u53D6\u6D88",
  updateParams: "\u4ECEmodels.dev\u83B7\u53D6\u6A21\u578B\u4FE1\u606F",
  paramsFetching: "\u6B63\u5728\u67E5\u8BE2 models.dev\u2026",
  paramsTitle: "\u6A21\u578B\u53C2\u6570\uFF08\u6765\u81EA models.dev\uFF09",
  paramsSummary: "\u5339\u914D {matched} \u4E2A \xB7 \u672A\u5339\u914D {unmatched} \u4E2A",
  paramsUnmatched: "\u672A\u5339\u914D\uFF08\u4FDD\u6301\u539F\u503C\uFF09",
  paramsProvider: "\u9009\u62E9\u6570\u636E\u6765\u6E90\u4F9B\u5E94\u5546",
  officialMark: "\u5B98\u65B9",
  paramsOverwrite: "\u5E94\u7528\uFF08\u8986\u76D6\u73B0\u6709\u503C\uFF09",
  paramsFillBlank: "\u4EC5\u586B\u7A7A\u767D\u5B57\u6BB5",
  paramsApplied: "\u5DF2\u66F4\u65B0\u6A21\u578B\u4FE1\u606F",
  paramsNoModels: "\u6CA1\u6709\u53EF\u67E5\u8BE2\u7684\u6A21\u578B\uFF1A\u5148\u6DFB\u52A0\u6A21\u578B\u6216\u4ECE\u7F51\u5173\u83B7\u53D6\u3002",
  proxyToggle: "\u4EE3\u7406",
  proxyUrl: "\u4EE3\u7406\u5730\u5740",
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
  modelsEmpty: "No models yet: add one by hand, or fetch the list from the gateway.",
  clearModels: "Clear",
  addModel: "Add model",
  removeModel: "Remove this model",
  modelAdvanced: "Advanced (context window / max output)",
  modelId: "Model ID",
  modelName: "Display name",
  contextWindow: "Context window",
  maxTokens: "Max output tokens",
  modelReasoning: "Reasoning efforts",
  defaultEffort: "Default reasoning effort (auto-selected on mode switch)",
  modelIdRequired: "Model id is required",
  modelIdDuplicate: "Duplicate model id",
  capacityInvalid: "Capacity must be a positive number; K/M suffix allowed (e.g. 128K, 1M)",
  fetchModels: "Fetch models",
  fetching: "Asking the gateway\u2026",
  fetchEmpty: "The gateway listed no chat-capable models (embedding / rerank / ranker filtered out).",
  fetchTitle: "Choose models to add",
  fetchAdopt: "Add selected",
  fetchCancel: "Cancel",
  updateParams: "Fetch model info from models.dev",
  paramsFetching: "Querying models.dev\u2026",
  paramsTitle: "Model parameters (from models.dev)",
  paramsSummary: "{matched} matched \xB7 {unmatched} unmatched",
  paramsUnmatched: "No match (values kept)",
  paramsProvider: "Choose the data provider",
  officialMark: "Official",
  paramsOverwrite: "Apply (overwrite existing)",
  paramsFillBlank: "Fill blank fields only",
  paramsApplied: "Model info updated",
  paramsNoModels: "No models to look up: add one or fetch from the gateway first.",
  proxyToggle: "Proxy",
  proxyUrl: "Proxy URL",
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
.newapi-error { color: var(--dsw-alias-state-error-primary); }
.newapi-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
/* Model catalog, mirroring ui-settings-models: one bordered entry per
   model, id and display name on the row, capacities behind the row's own
   disclosure. */
.newapi-catalog {
  display: flex; flex-direction: column; gap: 10px;
  padding-top: 12px; margin-bottom: 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.newapi-catalog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.newapi-catalog-title {
  font-size: 12px; line-height: 18px; font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.newapi-linkbutton {
  box-sizing: border-box; display: inline-flex; align-items: center;
  height: 28px; padding: 0 10px; border: none; border-radius: 14px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.newapi-linkbutton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.newapi-linkbutton:disabled { opacity: 0.4; cursor: default; }
.newapi-empty { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.newapi-entry {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px;
}
.newapi-modelrow {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
}
/* Square, label-free affordances: the row's own inputs carry the meaning, so
   the actions stay glyphs and announce themselves through aria-label. */
.newapi-iconbutton {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.newapi-iconbutton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.newapi-iconbutton:disabled { opacity: 0.4; cursor: default; }
.newapi-iconbutton--danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}
.newapi-modeladvanced {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
  padding: 8px 4px 2px;
}
.newapi-modelfield { display: flex; flex-direction: column; gap: 4px; }
.newapi-modelfield-label { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.newapi-addmodel {
  box-sizing: border-box; align-self: flex-start; display: inline-flex; align-items: center;
  gap: 4px; height: 28px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.newapi-addmodel:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.newapi-addmodel:disabled { opacity: 0.4; cursor: default; }
.newapi-candidates { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.newapi-candidates ul { list-style: none; padding: 0; margin: 8px 0; }
/* Proxy control + models.dev params panel. */
.newapi-proxyrow {
  display: flex; flex-direction: row; align-items: center; flex-wrap: wrap;
  gap: 8px; margin-bottom: 12px;
}
.newapi-proxyrow label { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); }
.newapi-select {
  box-sizing: border-box; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; max-width: 220px;
}
.newapi-params {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 12px; margin-bottom: 12px;
}
.newapi-params-summary { margin: 6px 0 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.newapi-params-row {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center; gap: 8px; padding: 4px 0;
}
/* The id rides a fixed-width text box so rows align; content wider than
   the box stays hidden until hover, when it scrolls horizontally. */
.newapi-params-id {
  box-sizing: border-box; width: 30ch; max-width: 30ch;
  padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; line-height: 18px;
  text-align: left; white-space: nowrap; overflow: hidden;
  scrollbar-width: thin;
}
.newapi-params-id:hover { overflow-x: auto; }
.newapi-params-values {
  color: var(--dsw-alias-label-tertiary); font-size: 12px;
  font-variant-numeric: tabular-nums; text-align: left;
}
.newapi-params-unmatched { color: var(--dsw-alias-label-dimmed); font-size: 12px; padding: 4px 0; }
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
  const fetchModelParams = (request) => connection.rpc.call("/llm-newapi", "models-dev-params", request);
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "newapi",
    order: 15,
    label: () => t("nav"),
    inject: () => ({ api: connection.api, t, fetchModelParams })
  }, NewApiSection));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
