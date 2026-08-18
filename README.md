# dsh-llm-newapi

**English** | [中文](README.zh-CN.md)

An LLM provider plugin that adds **NewAPI** to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). **Zero modifications to dsh itself.**

- Provider route id: `newapi`
- Display name: `NewAPI`
- Shape: LLM Provider plugin — implements the `LlmAdapter` seam from `@deepseek-ai/dsh-llm`; NewAPI is an OpenAI-compatible gateway (`POST {baseURL}/chat/completions`, `GET {baseURL}/models`, baseURL includes `/v1`)
- Dual-face structure: host side (adapter + model discovery) + browser side (a "NewAPI" settings page in the dsh web settings panel, including "Fetch model info")

Design decisions and trade-off analysis live in [DESIGN.md](DESIGN.md); reference implementation: `deepseek-harness/packages/llm/llm-deepseek`.

## Installation (dsh ≥ 0.1.0-rc)

### Release channels and version selection

The project uses a **dual release channel**. Install from the **npm registry** (default) or a **versioned tag**; never from the `main` branch HEAD:

| Channel | Version shape | Install reference | When to use |
|---|---|---|---|
| **Stable (recommended)** | `vX.Y.Z` | `dsh plugin --profile web add dsh-llm-newapi` (npm `latest`) or `github:wenzetan/dsh-llm-newapi#latest` | Daily use; passed all gates and promoted after manual confirmation |
| **Prerelease** | `vX.Y.Z-rc.N` etc. | `dsh plugin --profile web add dsh-llm-newapi@next` or `github:wenzetan/dsh-llm-newapi#v0.8.2-rc.3` | Trying out / validating new features; not manually confirmed, published only as GitHub Pre-release and npm `next` |
| **main branch HEAD (not recommended)** | no tag | `github:wenzetan/dsh-llm-newapi` | Development preview; untagged commits have not gone through release verification and may be unstable |

> 💡 The npm `latest` dist-tag (and the GitHub `latest` tag) always points at the newest **manually confirmed** stable version, so the default install command never goes stale and this README does not need per-release updates. Pin an exact `#vX.Y.Z` only when you must reproduce an older build. The tag-less `github:` shorthand installs `main` HEAD — that is not a release channel.

### Option A: npm registry (default, recommended)

```sh
dsh plugin --profile web add dsh-llm-newapi        # stable: npm latest (auto-follows confirmed releases)
# dsh plugin --profile web add dsh-llm-newapi@next  # prerelease

# then: register the bundle — edit $DSH_HOME/profiles/web/package.json
#       (default ~/.dsh/profiles/web/package.json),
#       add "dsh-llm-newapi" to the dsh.profile.bundles array — and restart dsh web
```

### Option B: GitHub shorthand — `#latest` (moving) or `#vX.Y.Z` (pinned)

```sh
dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi#latest"    # newest confirmed stable
# dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi#v0.8.1"  # exact version
# Same bundle registration & restart as Option A
```

### Option C: Release tarball (no GitHub clone)

```sh
dsh plugin --profile web add \
  https://github.com/wenzetan/dsh-llm-newapi/releases/download/v0.8.1/dsh-llm-newapi-0.8.1.tgz
# Same bundle registration & restart; use the matching -rc.N asset for prereleases
```

### Option D: local development (link)

```sh
git clone https://github.com/wenzetan/dsh-llm-newapi && cd dsh-llm-newapi
npm install && npm run build && npm test
dsh plugin --profile web add link:$(pwd)
# Same bundle registration & restart; after changing code re-run npm run build, commit lib/ and restart dsh web
```

> **Missing-peer warnings at install time are expected and can be ignored**: `react`/`cordis`/`dsh-llm`/`dsh-settings`/`schemastery` etc. are provided at runtime by the dsh host app; declaring them as `peerDependencies` is exactly how the plugin says "don't install your own copy". The profile's `autoInstallPeers: false` makes pnpm report them as missing. Every dsh plugin shows this WARN on install (dsh-at-file is the same); installation succeeds regardless. Do not install that list manually or enable autoInstallPeers — it causes duplicate cordis services and the plugin silently failing.

After install: a "NewAPI" page appears in the settings panel → fill in the API key and the gateway address (including `/v1`) → "Fetch model info" pulls the model list and lets you pick chat models (embedding / rerank / ranker are filtered automatically) → save. The `newapi` route's models then show up in the model picker (composer).

## Configuration (cordis.yml entry config; after install the `llm-newapi:` section in settings.yaml hot-reloads and overrides it)

```yaml
- id: llm-newapi
  name: dsh-llm-newapi
  config:
    baseURL: http://gw.local:3000/v1   # include the /v1 prefix; falls back to env NEWAPI_BASE_URL → placeholder
    # models:                          # suggested catalog; empty by default, use "Fetch model info" to pull /models
    #   - id: deepseek-chat
    #     contextWindow: 65536
    # modelExcludePatterns:            # chat-only filter during discovery (replaces the default wholesale)
    #   - embed                        #   default ['embed','rerank','ranker'] (case-insensitive id substring)
    #   - rerank                       #   set [] to disable the filter; multi-capability ids (bge-m3) must be added manually
    # defaultContextWindow: 128000     # context capacity when the catalog has no entry
    # maxTokens: 8192                  # when absent, max_tokens is not sent and each upstream default applies
    # providerHints:                   # official-vendor arbitration for models.dev parameter matching
    #   defaults:                      #   family prefix → provider (overrides built-ins like glm→zai)
    #     glm: zhipuai                 #   e.g. use the ZhipuAI open platform data instead
    #   models:                        #   per-id exact → provider (takes precedence over family)
    #     tencent/Hunyuan-MT-7B: nano-gpt
```

**API key**: not a config item — it lives under the fixed `newapi` reference in the credentials store, and its only configuration surface is the web settings page (takes effect immediately on write, resolved per request). The plugin never reads the key from environment variables: the top read-only layer of the credentials service is inherited from the environment, so a `NEWAPI_API_KEY`-style reference would be shadowed by an identically-named env var and lock the front-end input; hence the fixed reference name `newapi`. Without a key, the first request fails with `MISSING_CREDENTIAL` and points to the settings page — it never errors at load time.

**Model discovery**: `GET {baseURL}/models`; only models that can serve chat-completions are adopted — embedding / rerank / ranker families are filtered by naming convention (configurable).

**Web settings page**: discovered at runtime by dsh web through the `dsh.client` manifest (`ClientModuleRegistry` scans composition plugin lines), contributing a `settings.section` slot (dsh contract: features own their settings page, no shell changes). Note it is a standalone "NewAPI" page in the settings panel, not embedded inside the official Models page. Inputs and buttons all use `--dsw-alias-*` design tokens (same recipe as the official Models page), adapting automatically to light / dark themes.

**Config validation**: the settings write point rejects segments the adapter cannot serve (e.g. non-http(s) baseURL, empty filter entries) — constraints the schema cannot express are reported at write time, so you never get "saved successfully but silently kept old values".

## Release flow (prerelease → manual confirmation → stable)

- **Prerelease**: write the `package.json` version as `X.Y.Z-rc.N` and push tag `vX.Y.Z-rc.N`. After the full four gates (build / plugin-check / boot / release): the GitHub Release is marked **Pre-release** and npm publishes to the **`next`** dist-tag (`latest` untouched). Install: `dsh plugin --profile web add dsh-llm-newapi@next`.
- **Promote to stable** (manual confirmation): Actions → CI → Run workflow → fill in `rc_tag` (e.g. `v0.8.2-rc.1`). The promote job verifies that rc's CI is fully green and the stable tag is unoccupied, then creates `vX.Y.Z` on the same commit — which automatically runs the stable release (full Release + npm `latest`). The GitHub `latest` tag is moved to the same commit, so `github:wenzetan/dsh-llm-newapi#latest` always resolves to the newest confirmed stable.
- Any tag with a `-` suffix is treated as a prerelease; stable tags are created exclusively by promote, so `latest` is always a manually confirmed version.

## Build & test (development in this repo)

```sh
npm install && npm run build   # host: tsc types + esbuild → lib/index.js; client: closure-factory → lib/client.js
npm test                       # cordis real-mount smoke: registration surface + chat-only filter + fiber release
npm run cache:models-dev      # cache models.dev/api.json locally to .cache/ (gitignored, for development)
```

**models.dev dev cache**: `.cache/models-dev.api.json` is not committed; it lets you inspect the real field shapes in the catalog (`limit.context/output`, `reasoning_options`) during development; when the optional smoke block detects it, real data validates `matchModelsDev` (skipped when missing, CI unaffected). Refreshing tries direct access to models.dev first, then the `HTTPS_PROXY` env var; when both are unreachable it synthesizes a subset snapshot from the GitHub source (sst/models.dev model TOML) and marks `_source`.

After changing source, re-run `npm run build` and **commit `lib/`** — `github:` installs run from the committed artifacts, and the CI "Committed artifacts are current" step rejects stale outputs.

## Status

v0.8.3: tool-call id/name delta hardening (#1) — some gateways (glm-5.3 via qcplay) repeat `tool_calls[].id` and `function.name` on every continuation delta as **empty strings** instead of omitting the fields; the presence-only merge overwrote the first delta's real tool name with `''`, so every tool call failed as `unknown tool`. The translator now accepts only non-empty `id`/`name` values (matching the existing non-empty guards on text/reasoning deltas); argument concatenation is unchanged.

v0.8.1: preset reasoning effort — the effort field in a model row's advanced area is now a dropdown, letting users set one level as default (`defaultReasoningEffort` persisted); when nothing is preset, the **highest** declared level is used by default (max>xhigh>high>medium>low>…); `resolveModel` declares `defaultEffort` and the composer auto-selects that level when switching reasoning modes. Write validation: the preset must belong to that model's effort list.

v0.8.0: parameter-matching engine rework — **built-in family hints + approximate-key matching + configurable overrides**. Built-in family defaults (glm→zai, gpt→openai, claude→anthropic, deepseek→deepseek, gemini→google, grok→xai, qwen→alibaba, kimi→moonshotai, mimo→xiaomi, minimax→minimax, hunyuan→tencent) put the official entry first and mark it "official" among candidates; **approximate keys** are supported inside the official vendor (when the catalog lacks that exact version, take the closest family entry, e.g. glm-5.3→zai's glm-5); no cross-vendor approximation to avoid noise; `providerHints` config can override/extend (`defaults` family prefix + `models` per-id exact, per-id takes precedence). Order: hinted official → exact key (catalog order) → registry official supplement. Measured: 22 models, 20 resolved directly to official (including real reasoning efforts); qwen27b-coder has no match (id absent from the catalog); tencent/Hunyuan-MT-7B falls to nano-gpt (official tencent has no such model).

v0.7.2: "Clear" button in the model catalog title row — same semantics as per-row delete, removes all model rows at once; resets expanded state, capacity input buffers and the parameter results panel; disabled when the catalog is empty; saving writes an empty `models` array.

v0.7.1: parameter matching prefers official by default — when multiple vendors match, the official vendor's entry is put first and marked "official" (the panel defaults to item 0, i.e. the official parameters); the authoritative source is the built-in model catalogs of other routes in the dsh-llm registry (e.g. the deepseek route declares deepseek-v4-flash, so api.json uses the deepseek vendor entry), matched by bare model id (multi-segment ids look up the last segment); the index rebuilds automatically when the route set changes.

v0.7.0: display-name generation supports brand spelling (glm→GLM, gpt→GPT, deepseek→DeepSeek), multi-segment ids append the raw prefix in parentheses (`deepseek-ai/deepseek-v4-flash`→`DeepSeek V4 Flash[deepseek-ai]`), size-suffix uppercasing limited to b/k/m (`gpt-4o` keeps lowercase o); **end-to-end reasoning effort** — "Fetch model info from models.dev" now also brings in the effort list from `reasoning_options` (null dropped), stored in the catalog's `reasoningEfforts` field, `resolveModel` declares selectable reasoning efforts from it (the composer shows an effort selector), an explicit effort goes on the wire via the OpenAI-compatible `reasoning_effort` field; the row's advanced area shows it read-only, and the results panel + provider selector display it in sync.

v0.6.3: the fetch-model adoption chain is sorted by id end to end — the candidate list is re-sorted client-side after pulling (not dependent on the host-side version); after "Add selected", the form rows merge into one alphabetical list (old and new rows sorted together); half-formed rows with empty ids sink to the bottom.

v0.6.2: fetch-model auto-generates display names — when the gateway listing has no name, derive one from the id: multi-segment ids keep only the content after the last `/`, `-` becomes a space, each word's first letter is capitalized, trailing single-letter size suffixes are uppercased (`qwen3-32b`→Qwen3 32B, `glm-4.5-air`→Glm 4.5 Air, `llama-3.1-70b`→Llama 3.1 70B); names provided by the listing still win.

v0.6.1: proxy control simplified — the preset dropdown is gone, leaving a single text field whose default and placeholder are both `http://127.0.0.1:7890` (saving an empty value falls back to that default).

v0.6.0: parameter results panel rearranged — the model id is a fixed 30ch text field (left-aligned; oversized content scrolls horizontally on hover so row alignment no longer drifts), and the right-side mapping column is explicitly left-aligned; "Fetch model info from models.dev" now gives immediate feedback: the status line shows "matched N · unmatched M" counts, and the results panel auto-scrolls into view (long model lists no longer push the panel off-screen).

v0.5.8: action copy changed to "Fetch model info from models.dev"; fixed the misleading failure hint — when the proxy is on but the proxy itself is unreachable (ECONNREFUSED), the old message wrongly suggested "enable the proxy"; now it distinguishes by actual route: proxy-path failures name "proxy at <url> is unreachable; check that it is running, or change or disable the proxy setting", and only direct-path failures suggest enabling the proxy.

v0.5.7: fixed the published package's type entry — declaration emit left a `.ts` specifier (`rewriteRelativeImportExtensions` does not apply to d.ts), breaking consumer type resolution; the host build now rewrites relative `.ts` to `.js` in `lib/types/*.d.ts`. Added `prepack` script. CI gained the dsh-plugin-check compliance gate (manifest protocol / patch format / build pitfalls; verdict must pass; this repo went from fail to green).

v0.5.6: fixed "Update model info" HTTP 500 — download failures (models.dev unreachable directly, dead proxy, etc.) previously threw, which the transport layer mapped to an opaque 500; the handler now returns an error envelope and the settings page shows the underlying cause directly (DNS / refused / timeout) with the "enable proxy" hint. Also fixed the dual-undici issue on the proxy path: npm undici's ProxyAgent is rejected by Node's built-in fetch brand check, so proxy requests now go through npm undici's own fetch.

v0.5.4: CI boot gate stabilized — the runner installs pnpm (the profile plugin flow depends on it; a bare runner lacked it, making the gate fail on first run); the three gate assertions (:3080 ready, client bundle 200, RPC channel not 405) are green end-to-end on tag builds.

v0.5.3: fixed undici missing from production installs — undici previously sat in both dependencies and devDependencies, and `--omit=dev` installs (the CI self-containment gate's clean directory) dropped the same-named devDep wholesale instead of falling back to the prod declaration, making the bundled output unresolvable in isolation; removing it from devDependencies turned the CI gate green. CI gained a boot gate: install dsh globally → fresh DSH_HOME installs the tarball via `dsh plugin add` → start `dsh web` in the background, requiring :3080 ready, `/plugins/dsh-llm-newapi/client.js` retrievable, and `/llm-newapi/models-dev-params` not 405.

v0.5.2: fixed "Update model info" HTTP 405 — the RPC channel previously read `ctx.get('connection')` eagerly in apply, silently skipping registration when the plugin mounted before the web app started the connection service (got `undefined`); it now uses `ctx.inject(['connection'], …)` to register once the service is ready (re-run automatically on service reload), and a smoke scenario pins the "plugin mounts first, service starts later" ordering.

v0.5.1: undici moved from peerDependencies into dependencies (the host does not provide undici; under `autoInstallPeers: false` unresolved peers made the whole plugin tree fail to load); CI gained a self-containment gate — `npm pack` output is unpacked into a clean directory installing production deps only, and every non-host-provided bare import in the host bundle must resolve.

v0.5: discovery results sorted by id; display names for `a/b`-shaped ids take the last segment (wire id unchanged); new "Update model info" — the browser sends model ids (and the proxy draft) to the host via the RPC (`/llm-newapi` channel), the backend downloads `https://models.dev/api.json` and matches by id/last segment, returning `limit.context`/`limit.output`; same-name multi-vendor entries are chosen by the user in the results panel; applying supports "overwrite" or "fill blanks only", unmatched rows keep their values with a count hint. Proxy toggle off by default, default `http://127.0.0.1:7890`, three preset dropdown entries 7890/7897/10809 plus custom input; enabled state and address persist with the settings section (used only for that download; gateway traffic does not go through the proxy).

v0.4: model catalog redesigned after the official Models page (`ModelListEditor`) — each model is a bordered card (id + display name inline), context window / max output collapsed behind the leading chevron, with K/M shorthand input (`256K`→256000, `1M`→1000000) and per-field input buffers; local validation before saving (empty id / duplicate id / unparseable capacity are rejected and the row named); empty-state hint and pill "Add model" button; deleting rows re-aligns expanded state and buffers by row number.

v0.3: API key moved to pure front-end configuration (fixed credentials reference `newapi`; removed the `apiKeyEnv` config and env fallback); settings page uses `--dsw-alias-*` design tokens, adapting to light/dark themes; settings write point gained validate rejection; `WireAssistantMessage.content` type tightened to `string`. The dual-face structure (host adapter + chat-only-filtered discovery, browser NewAPI settings page) is unchanged; typecheck / build / smoke all green; artifacts committed + CI sync check + Release tarball. Known npm rc gap stubbed via overrides (see DESIGN §8).
