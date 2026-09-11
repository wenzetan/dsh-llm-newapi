# dsh-llm-newapi

**English** | [中文](README.zh-CN.md)

Use your NewAPI gateway in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). The plugin adds a **NewAPI settings page** for credentials, model discovery and model parameters, plus streaming text and tool calls. It requires no changes to dsh.

## Choose a compatible version

**Install the host and plugin as a pair.** Status checked on September 10, 2026; the planned release is listed separately from available releases.

| dsh host | Plugin | Status |
| --- | --- | --- |
| `0.1.1-rc.2` | `0.8.4` | Published; plugin npm `latest` |
| `0.1.2-rc.1` | `0.8.6-rc.1` | Published; plugin npm `next` |
| `0.1.5-rc.1` | **`0.8.6-rc.2`** | **Planned RC, not published**; isolated tests of the current source pass, full installation and Web validation remain pending |

Plugin `0.8.6-rc.1` rejects the older `0.1.1` host. The isolated results for `0.1.5-rc.1` do not certify an existing plugin release for that host. See the [compatibility assessment (Chinese)](docs/2026-09-10-dsh-0.1.5-rc.1-assessment.md).

The next release will remain **`0.8.6-rc.2`**, published to npm `next` and marked Pre-release on GitHub. It will not promote a stable version or move the plugin's `latest` tag. The host and plugin have separate release channels; their respective `latest` versions are not necessarily compatible.

## Install exact versions

You need Node.js, npm and pnpm. Repository CI uses Node.js 24. Install the host with npm, then install the plugin from the npm registry into dsh's `web` profile.

### Published RC pair

```sh
npm install -g @deepseek-ai/dsh@0.1.2-rc.1
npm install -g pnpm
dsh plugin --profile web add --save-exact dsh-llm-newapi@0.8.6-rc.1
```

### Pair for the older host

```sh
npm install -g @deepseek-ai/dsh@0.1.1-rc.2
npm install -g pnpm
dsh plugin --profile web add --save-exact dsh-llm-newapi@0.8.4
```

Choose one pair. `--save-exact` records an exact plugin dependency so a later dependency update does not switch versions automatically. Use `dsh plugin` to manage the profile; installing `dsh-llm-newapi` globally by itself does not register it there.

### New host pair: run only after rc.2 is published

**rc.2 is not available yet.** These are the planned commands. Check that the version exists before installing:

```sh
npm view dsh-llm-newapi@0.8.6-rc.2 version
npm install -g @deepseek-ai/dsh@0.1.5-rc.1
npm install -g pnpm
dsh plugin --profile web add --save-exact dsh-llm-newapi@0.8.6-rc.2
```

### Check that the plugin is enabled

Open `$DSH_HOME/profiles/web/package.json`. With no `DSH_HOME` override, this is `.dsh/profiles/web/package.json` under your home directory.

Ensure `dsh.profile.bundles` contains `dsh-llm-newapi`. Host `0.1.5-rc.1` registers installed bundle plugins automatically. On an older host or an existing profile where the entry is missing, append it once and preserve the other entries. This is a JSON fragment to check, **not a replacement for the entire file**:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-llm-newapi"
      ]
    }
  }
}
```

Check the installed versions, then restart dsh Web:

```sh
dsh --version
dsh plugin --profile web list dsh-llm-newapi
dsh web
```

## First use

1. Open **NewAPI** in dsh Web settings.
2. Enter your gateway URL, such as `https://your-gateway.example/v1`, and API key. Include `/v1`; do not enter the full `/chat/completions` path.
3. Click **Fetch models**, select the models you need and add the selected entries.
4. Optionally fetch model information from models.dev. Review context limits, output limits and reasoning efforts before applying values.
5. Click **Save**, then choose a model under the `newapi` provider in the conversation model picker.

Model discovery queries your gateway for available models. models.dev is a public parameter catalog; a match does not establish that your gateway supports a model or feature. Save after applying catalog values.

## Capabilities and limits

| Feature | Behavior |
| --- | --- |
| Text, reasoning content and tool calls | Streaming supported; an explicit reasoning effort is sent as `reasoning_effort` |
| Image input | The adapter currently declares text-only input |
| Model discovery | Queries `/models` and filters names containing `embed`, `rerank` or `ranker`; this is not a capability probe |
| Model parameters | Edit manually or match against models.dev; verify against your gateway |
| API key | Saved through settings, never echoed; a blank input preserves the stored key |
| Multiple gateways | One `newapi` route and one gateway configuration are currently supported |

## Upgrading and troubleshooting

Check the version table, stop dsh Web and back up your dsh configuration and session data before upgrading. Install the target host and exact plugin version, keep the existing bundle entry and restart. The plugin retains the `llm-newapi` settings namespace and `newapi` credential reference.

Host `0.1.5` migrates session data; older hosts cannot directly read migrated sessions. Reinstalling an older npm version alone is not a complete rollback. See the [upstream migration guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-format-v2-to-v3/README.md).

| Symptom | Check first |
| --- | --- |
| No NewAPI settings page | The `web` profile, bundle entry, host compatibility and whether Web was restarted |
| Missing credential | Enter and save the key in NewAPI settings; the plugin does not read `NEWAPI_API_KEY` |
| Discovery fails | The `/v1` base URL, API key and gateway support for `/models` |
| Empty model list | Name-based filtering; manually add a model only if it supports chat-completions |
| models.dev download fails | Network and proxy settings; the plugin proxy applies to this download, while host `0.1.5` also applies environment proxy settings |
| Missing-peer warnings during install | dsh supplies host packages. If installation and startup succeed, do not install duplicate host packages just to silence these warnings; investigate actual startup errors separately |

## Documentation

The detailed guides below are currently in Chinese:

- [Configuration and troubleshooting](docs/configuration.md): fields, model matching, proxies and save failures.
- [Development and RC releases](docs/development.md): builds, test coverage and release checks.
- [Design](DESIGN.md): source map, data flow and implementation decisions.
- [0.1.5-rc.1 assessment](docs/2026-09-10-dsh-0.1.5-rc.1-assessment.md): version inventory and pending work.

See [GitHub Releases](https://github.com/wenzetan/dsh-llm-newapi/releases) for published changes and downloadable packages.
