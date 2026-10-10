> 🚧 **Archived Notice / 归档通知**
>
> **English:**  
> This repository is no longer maintained and is now archived (read-only).  
> The author's setup has moved from NewAPI to OmniRoute. The plugin capabilities the two gateways need have diverged: implementing OmniRoute's needs in this project would risk conflicting with the NewAPI-facing behaviour, and would add maintenance cost — so this project stops at its last release.  
> The last published version is `0.2.0-rc.2-v0.1` (dsh `0.2.0-rc.2`). It keeps working against that pinned host, but there will be no further fixes, releases or new-host support.
>
> **中文：**  
> 本仓库已停止维护并已归档（只读）。  
> 作者的使用场景已从 NewAPI 迁移到 OmniRoute。两边需要的插件能力有差异：在本项目里实现 OmniRoute 的需求，既担心与面向 NewAPI 的行为冲突，也有额外的维护成本，因此本项目停在最后一个发布版本。  
> 最后一个发布版本是 `0.2.0-rc.2-v0.1`（对应 dsh `0.2.0-rc.2`）：锁住该宿主仍可继续使用，但不再有修复、新版本，也不再跟进新的 dsh 宿主。

# dsh-llm-newapi

**English** | [中文](README.zh-CN.md)

Use your NewAPI gateway in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). The plugin adds a **NewAPI settings page** for credentials, model discovery and model parameters, plus streaming text and tool calls. It requires no changes to dsh.

## Choose a compatible version

**Install the host and plugin as a pair.** Status checked on October 4, 2026.

| dsh host | Plugin version line | Install from | Status |
| --- | --- | --- | --- |
| `0.1.5-rc.3` | `0.1.5-rc.3-v0.3` | tag `v0.1.5-rc.3-v0.3` | Published, that line is frozen |
| `0.1.7-rc.1` | `0.1.7-rc.1-v0.x` | tag `v0.1.7-rc.1-v0.3` | Published, cannot run on a 0.2.0 host |
| **`0.2.0-rc.2`** | **`0.2.0-rc.2-v0.x`** | **tag `v0.2.0-rc.2-v0.1`** | **Current promoted line** |

The plugin is **no longer distributed through npm**: install it from this repository's Git tag (or the matching GitHub Release), as shown under [Install from Git](#install-from-git). On a host line only the last segment increments (`-v0.1` → `-v0.2` → …), so the current line is named `v0.x`; the tag list on [GitHub Releases](https://github.com/wenzetan/dsh-llm-newapi/releases) is the authoritative index of what exists.

### Version scheme

The plugin version follows the upstream host: `<dsh version>-v<plugin revision>`. Only the last segment is this plugin's own revision:

| Case | dsh version | Plugin version | Git tag / Release |
| --- | --- | --- | --- |
| Upstream RC | `0.2.0-rc.2` | `0.2.0-rc.2-v0.1` | `v0.2.0-rc.2-v0.1` |
| Later plugin change on the same host line | `0.2.0-rc.2` | `0.2.0-rc.2-v0.2` | `v0.2.0-rc.2-v0.2` |
| Upstream stable | `0.2.0` | `0.2.0-v0.1` | `v0.2.0-v0.1` |
| Host line changes (revision restarts) | `0.2.0-rc.3` | `0.2.0-rc.3-v0.1` | `v0.2.0-rc.3-v0.1` |

- The Git tag and GitHub Release carry a `v` prefix (`v0.2.0-rc.2-v0.1`); `package.json` stays `0.2.0-rc.2-v0.1`.
- **Distribution**: the plugin ships as repository tags only — there is no npm channel, so the tag you install *is* the exact version and no `dist-tags` lookup is involved. A future stable tag (`v0.2.0-v0.x`) would be an ordinary GitHub Release.
- The older **`0.8.x` series** (dsh `0.1.1-rc.2` / `0.1.2-rc.1` host lines) had its tags removed from this repository and is no longer supported.

### Compatibility and upgrades

Plugin `0.2.0-rc.2-v0.x` supports the **dsh `0.2.0-rc.2` line** and rejects `0.1.7` and older hosts with an explicit upgrade message; `0.1.7-rc.1` users run `0.1.7-rc.1-v0.x`. Compatibility is keyed to the host line rather than one patch: a later `0.2.0-rc` cut is covered as long as its export surface matches — `npm run test:host` compares the installed surface against the checked-in one and fails loudly when it does not, instead of assuming. See the [compatibility assessment (Chinese)](docs/2026-10-04-dsh-0.2.0-rc.2-assessment.md).

Both lines are GitHub Pre-releases (the plugin has no stable release yet). The host comes from npm while the plugin comes from this repository's tag, so do not assume their versions pair — pick a host line from the table and install the matching tag next to it.

## Install from Git

You need Node.js, npm and pnpm. Repository CI uses Node.js 24. Install the host with npm, then install the plugin into dsh's `web` profile straight from this repository's tag.

### Current promoted pair (dsh `0.2.0-rc.2`, tag `v0.2.0-rc.2-v0.1`)

```sh
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
npm install -g pnpm
dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi#v0.2.0-rc.2-v0.1"
```

### Previous host pair (dsh `0.1.7-rc.1`)

```sh
npm install -g @deepseek-ai/dsh@0.1.7-rc.1
npm install -g pnpm
dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi#v0.1.7-rc.1-v0.3"
```

Choose one pair. A `github:` spec pins the tag, so the installed version cannot drift and no registry lookup is involved. You can also download the `.tgz` from the matching [Release](https://github.com/wenzetan/dsh-llm-newapi/releases) and pass its absolute path to `dsh plugin --profile web add`. Use `dsh plugin` to manage the profile; installing the plugin globally by itself does not register it there.

### Check that the plugin is enabled

Open `$DSH_HOME/profiles/web/package.json`. With no `DSH_HOME` override, this is `.dsh/profiles/web/package.json` under your home directory.

Ensure `dsh.profile.bundles` contains `dsh-llm-newapi`. Recent dsh hosts register installed bundle plugins automatically. On an older host or an existing profile where the entry is missing, append it once and preserve the other entries. This is a JSON fragment to check, **not a replacement for the entire file**:

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

Check the version table, stop dsh Web and back up your dsh configuration and session data before upgrading. Install the target host and exact plugin version, keep the existing bundle entry and restart. The plugin retains the `newapi` credential reference; configuration now persists through the profile's Cordis patch (see [configuration](docs/configuration.md)).

Host `0.1.7` migrates sessions from V3 to V4 (tool results become tool-role messages, message sources are renamed); older hosts cannot directly read migrated sessions. Installing an older plugin tag alone is not a complete rollback. See the [upstream migration guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/session/session-format-v3-to-v4/README.md).

| Symptom | Check first |
| --- | --- |
| No NewAPI settings page | The `web` profile, bundle entry, host compatibility and whether Web was restarted |
| Missing credential | Enter and save the key in NewAPI settings; the plugin does not read `NEWAPI_API_KEY` |
| Discovery fails | The `/v1` base URL, API key and gateway support for `/models` |
| Empty model list | Name-based filtering; manually add a model only if it supports chat-completions |
| models.dev download fails | Network and proxy settings; the plugin proxy applies to this download, while dsh also applies environment proxy settings through `dsh-http-proxy` |
| Missing-peer warnings during install | dsh supplies host packages. If installation and startup succeed, do not install duplicate host packages just to silence these warnings; investigate actual startup errors separately |

## Documentation

The detailed guides below are currently in Chinese:

- [Configuration and troubleshooting](docs/configuration.md): fields, model matching, proxies and save failures.
- [Development and RC releases](docs/development.md): builds, test coverage and release checks.
- [Design](DESIGN.md): source map, data flow and implementation decisions.
- [0.2.0-rc.2 assessment](docs/2026-10-04-dsh-0.2.0-rc.2-assessment.md): the current host line, its verification and its limits.
- [0.1.7-rc.1 assessment](docs/2026-09-24-dsh-0.1.7-rc.1-assessment.md): historical snapshot.
- [0.1.5-rc.1 assessment](docs/2026-09-10-dsh-0.1.5-rc.1-assessment.md): historical snapshot.

See [GitHub Releases](https://github.com/wenzetan/dsh-llm-newapi/releases) for published changes and downloadable packages.
