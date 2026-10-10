# testbed: containerized plugin test environment

Runs source-level (L1) and real-host startup-level (L2) checks without touching the host DSH
environment; supports multiple host versions and plugin coexistence combinations.

- Both the host `$DSH_HOME` and the repository sources are mounted **read-only** (`:ro`);
  writes inside the container only land in the container's writable layer and named volumes.
- Every run first asserts that both mounts (`/host-dsh-home` and `/plugin-src`) are in fact not
  writable and refuses to run otherwise. That assertion is gated by `STEPS` (so `STEPS=l2` skips
  it), and the companion mount `/companion-src` is not covered by it (it is still mounted `:ro`
  by compose — see the next section and "How host-untouched is verified").
- Default host port is 13080 (the host's 3080 is the GUI; this environment never takes it).

What is checked:

| Layer | Where | What |
| --- | --- | --- |
| L1 (source layer) | `run_l1` in `entrypoint.sh` | `npm ci`, `npm run typecheck` (host + client), `npm run build` followed by a `lib/` content-hash comparison (artifact freshness), `npm run test:client` (vitest), `npm run test:host` (host-compat, against the `dsh-llm` actually installed in the container), `node test/smoke.mjs` (a real Cordis composition) |
| L2 (real host layer) | `probes/boot-probe.sh` | Really starts `dsh web` inside the container, then drives it with a curl probe: one-time token → session cookie → home page 200 → boot graph references this plugin's client bundle → this plugin's RPC channel answers with the expected semantics → log hygiene. A companion grid adds assertions for the companion bundle and for the two channels not covering each other |

The single source of truth for the assertions and the companion contract is the pair of files in
this repository: `probes/boot-probe.sh` and `probes/expectations.companion.json`. This README
describes usage and boundaries only; judge the details by those files.

## Prerequisites

- Docker Engine + Compose v2 (`docker compose version` prints a version).
- Node.js, needed only for `node matrix.mjs` (v24.19.0 verified here; the script uses Node built-ins only).
- Access to an npm registry (or set `NPM_REGISTRY` in `.env` to a mirror). The image build installs
  `pnpm` and `@deepseek-ai/dsh`; `preserve` mode and companion packing also need network access to
  resolve third-party packages.
- The host `$DSH_HOME` (default `/root/.dsh`): mounted read-only, never modified from the container.
- Disk space for the image plus two named volumes (npm / pnpm store). The first build pulls the base image.

## First build

```sh
cd testbed
cp .env.example .env   # adjust DSH_HOME_HOST / HOST_PORT / NPM_REGISTRY as needed
docker compose build
```

`testbed/.gitignore` ignores `.env`, `.out/` and the contents of `.docker-config/` (with a `!`
exception that keeps `.docker-config/.gitkeep`, the placeholder tracked in this repository), so
neither the `.env` you copy nor any run output is ever committed.

`.env` is the **single source for both sides**: `docker compose` interpolates the host mount
(`DSH_HOME_HOST`) and the `NPM_REGISTRY` build arg from it, and `matrix.mjs` loads the same file via
`process.loadEnvFile` — an already-set environment variable wins, exactly as in compose, and `.env`
only fills the gaps. Every matrix run prints the snapshot target actually in use, e.g.
`[matrix] 宿主快照目标：/root/.dsh（来源：…）`, so `宿主零改动：是` ("host untouched: yes") is never
reported for a directory the container never mounted.

## Common commands

Run all of these from inside `testbed/`.

```sh
# 1) Single grid: the default host version (CI dev pin, 0.2.0-rc.2) with full L1 + L2
docker compose run --rm --build testbed

# 2) Pin a host version
DSH_VERSION=0.2.0-rc.2 docker compose run --rm --build testbed

# 3) Stack a companion plugin (coexistence check)
COMPANION=dsh-quota-panel COMPANION_HOST_DIR=../../dsh-quota-panel \
  GRID_LABEL=self+quota docker compose run --rm --build testbed

# 4) Full matrix (default: latest + next, deduplicated, × self)
node matrix.mjs

# 5) preserve: restore the host profile's bundle rows by name first, then install this repo's tarball
PROFILE_MODE=preserve DSH_VERSION=0.2.0-rc.2 docker compose run --rm --build testbed

# 6) Step-by-step debugging (`STEPS=all` is the default)
STEPS=assert,seed,stage,l1,pack,profile,l2 docker compose run --rm --build testbed
```

`matrix.mjs` parameters:

| Parameter | Meaning |
| --- | --- |
| `--versions v1,v2` | Explicit host versions; otherwise registry `latest` + `next`, deduplicated |
| `--combos self,self+companion` | Combo set, default `self`. **Only the literal `self+companion` is special-cased**: it sets `COMPANION=dsh-quota-panel` automatically and uses the sibling directory `../dsh-quota-panel` (`../../dsh-quota-panel` as seen from `testbed/`). Any other name is accepted verbatim but leaves the companion unset, so it degenerates into a duplicate `self` grid that still prints PASS — do not use unimplemented names such as `pair` |
| `--check-host` / `--no-check-host` | Host-untouched snapshot, on by default; passing both is an error |
| `--jobs 1` | Reserved parameter only: the matrix is still serial, and any value other than 1 errors out |

If the version set or the combo set parses to empty, the script **refuses to run** (a 0-grid run
would be a false green) instead of degrading into "0/0 grids passed".

Each grid's raw log goes to `testbed/.out/<version>-<combo>.log`, and the summary table to
`testbed/.out/summary.md` (the whole `.out/` directory is gitignored).

### Four things people get wrong when copying commands

- `DSH_VERSION` / `PROFILE_MODE` / `COMPANION` / `GRID_LABEL` / `STEPS` are **compose environment
  variables** and belong *before* `docker compose run`. Only arguments placed after the service
  name become entrypoint arguments (for example `--source-hash`).
- `COMPANION_HOST_DIR` is a **host path** resolved relative to `testbed/`: if the companion repo
  sits next to this one, write `../../<companion-dir>`. The companion directory must already have
  `node_modules` (its `prepack` *is* the build, so missing devDependencies fail fast at `npm pack`).
- `COMPANION` must match the companion tarball's `package.json` `name` exactly, or the run errors out.
- With `matrix.mjs --combos self,self+companion` the companion is chosen **automatically** as the
  sibling directory `../dsh-quota-panel` (that is `../../dsh-quota-panel` as seen from `testbed/`),
  and you neither need nor can pass `COMPANION` by hand. `--combos` recognises that one literal
  name only — see the parameter table above and the measured `preserve` result opening "Known
  limitations".

## Host-side preparation

On some machines `/root/.docker` is read-only, and the docker CLI needs a **writable** state directory:

```sh
export DOCKER_CONFIG="$PWD/.docker-config"   # run from inside testbed/
```

That directory ships with this repository and is ignored; **do not** copy
`~/.docker/config.json` into it (it may contain credentials). `matrix.mjs` sets this variable
automatically.

## Base image

The `Dockerfile` `FROM` is always the official `node:24-bookworm-slim`, and it is **not** pinned by
digest (see below). If the daemon's registry mirror is unavailable or direct `docker.io` access
times out, prefetch and tag it locally under the original name:

```sh
docker pull docker.m.daocloud.io/library/node:24-bookworm-slim
docker tag  docker.m.daocloud.io/library/node:24-bookworm-slim node:24-bookworm-slim
```

**Never** put a third-party mirror into `FROM`. Note that this `FROM` does **not** pin a digest:
`node:24-bookworm-slim` is a rolling tag, so a rebuild can pick up whatever the tag currently points
at. This environment observed the digest
`sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`
(`node:24-bookworm-slim`, from the build log's
`FROM docker.io/library/node:24-bookworm-slim@sha256:…` line) at prefetch time; it is recorded for
reference only and moves as the upstream image is updated. If you need a reproducible base image,
pin it yourself (`FROM node:24-bookworm-slim@sha256:<digest>`).

## How host-untouched is verified

1. **Read-only assertion before the run**: when `STEPS` includes `assert` (the default `STEPS=all`
   does), the run asserts that `/host-dsh-home` and `/plugin-src` are read-only and refuses to run
   if either is writable (the `assert` step). Skipping `assert` explicitly (for example `STEPS=l2`)
   skips that self-check, and the companion mount `/companion-src` is not covered by it.
2. **Whitelist snapshot around the run**: `matrix.mjs` snapshots the host config before and after —
   `settings.yaml`, `.credentials.yaml`, `pet.json`, `skills/`, `profiles/` (excluding
   `profiles/node_modules`) — and reports red on any change; the last line prints
   `宿主零改动：是/否` ("host untouched: yes/no"). Volatile session/browser directories are not in
   the whitelist.
3. **Manual double-check**:

   ```sh
   find "$DSH_HOME" -maxdepth 1 -newermt '-5 minutes'
   ```

   This should print nothing (right after a run, nothing at the top level of the host `$DSH_HOME`
   should have changed).

Note the snapshot covers **config-class files** only: it proves the tests did not rewrite host
configuration, not that they never touched a single host byte.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `@deepseek-ai/*` fails with `EINTEGRITY` | Set `NPM_REGISTRY=https://registry.npmmirror.com` in `.env` and rerun with `--build` (the variable applies at image build time) |
| Port already in use | Set `HOST_PORT=13081` (the host's 3080 is the GUI and is never used); the matrix starts at 13080 and increments per grid, so check for leftover containers if it clashes with a manual run |
| A plugin tree fails to load with `can only be read by its owner` | Credential permissions inside the container: confirm `chmod 600` took effect (the entrypoint already does this); on Windows mounts the mode may not be settable |
| Artifact freshness check reports red | Run `npm run build` on the host and commit the rebuilt `lib/` (equivalent to CI's "committed artifacts are current") |
| First build is slow | It pulls `node:24-bookworm-slim`; later builds hit the layer cache |
| A package download misbehaves or registry state looks stale | The named volumes `dsh-testbed-llm-newapi_npm-cache` and `dsh-testbed-llm-newapi_pnpm-store` hold package caches; if you suspect cache corruption, `docker volume rm` them and rerun (the cost is re-downloading) |
| A grid reports FAIL | Read the tail of `testbed/.out/<version>-<combo>.log` first; `[freshness]` or the wording `镜像陈旧` ("stale image", the literal string the script prints) means the image did not follow the sources — see **Known limitations and caveats**, item 4 (image-freshness trap) |

## Known limitations and caveats

**Measured `preserve` result (read this conclusion before the numbered items): `preserve` works.**
In one full run (`PROFILE_MODE=preserve DSH_VERSION=0.1.5-rc.1`, on an npm-layout host profile) all
3 third-party bundle rows of the host profile — `superpowers-dsh`, `dsh-quota-panel`,
`@creait/dsh-tailnet-gateway` — were **restored successfully with 0 warnings**, the `bundles:` line
listed every row (`@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, superpowers-dsh, dsh-quota-panel,
@creait/dsh-tailnet-gateway, dsh-llm-newapi`), the assembly assertion passed, and the run exited **0
with two runs giving identical results** (both runs used
`STEPS=assert,seed,stage,l1,pack,profile`, i.e. **L2 was not run**); the `minimal` regression run
around it was green too. The spec's only open risk — "npm/pnpm layout mixing" — therefore **does not
materialise** (the host profile is already pnpm-managed and `dsh plugin add` inside the container
forwards the same pnpm).
`minimal` is still the recommended default (faster, fewer external dependencies, unaffected by
registry availability); use `preserve` when you need the host's full bundle composition reproduced —
but read it together with limitations 1 and 3 below.

1. **`preserve` does not restore version constraints (version drift).** `preserve` restores the
   host profile's bundle rows **by row name only**. A host row like `dsh-quota-panel@0.9.2-rc.3`
   resolves inside the container to the registry's **`latest` stable version** (`^0.9.1`, so **0.9.1**
   is what actually gets installed — confirmed in
   `testbed/.out/logs/task5-step3-preserve.log`), while the host pins the `next` prerelease
   `0.9.2-rc.3`. `^0.9.1` does **not** include prereleases, so **relative to the host this is a
   downgrade** (0.9.2-rc.3 → 0.9.1). The conclusion is unchanged: `preserve` reproduces *which
   bundle rows are installed*, not *which exact versions*. Exact-version parity would need separate
   work and is not implemented here.
2. **`preserve` starts from row names and needs the host profile.** If
   `/host-dsh-home/profiles/web/package.json` is missing it exits immediately (`die`);
   `minimal` has no such prerequisite.
3. **`preserve` exit-code semantics.** A failed third-party row restore only produces a
   **warning** and does not abort the run. So **exit code 0 does not mean "the host composition
   was fully reproduced"**. Read two things instead: the `bundles:` line (the bundle layers
   actually registered) and whether the log contains `警告：还原 <row> 失败`. pnpm peer-dependency
   warnings (`[WARN] Issues with peer dependencies found`) **occur in both kinds of grid** (observed
   in `minimal` grids as well as `preserve` grids); they are normal noise and do not affect the
   assembly assertion.
4. **Image-freshness trap (it once produced a false green).** When `docker compose run --build`
   decides the `COPY probes` layer is a cache hit, it **silently reuses a stale image** (observed:
   probe 137 lines in the image vs 191 on the host, with the whole grid green). `matrix.mjs`
   therefore checks every grid before running it: ① it runs `--source-hash`, comparing the sha256
   of the image's `entrypoint.sh` + every `probes/` file against the host sources item by item and
   comparing the build-recipe fingerprint (a digest of `Dockerfile` + `entrypoint.sh`);
   ② on a mismatch it rebuilds with `docker compose build --no-cache`, and if it still mismatches
   it marks that grid **FAIL** (better a true red than a false green). When running a single grid
   by hand after editing `entrypoint.sh`, `probes/` or the `Dockerfile`, pass `--build` and use
   `--no-cache` when needed.
5. **`--volume` must come before the service name.** In a form like
   `docker compose run --rm testbed --volume … testbed`, a `--volume` placed after the service name
   is **silently ignored** and the injected fixture never takes effect.
6. **The log-hygiene assertion has never gone red (known limitation).** The keywords
   `plugin tree failed to load` and `without inject` have **0 hits** across all historical logs.
   The assertion runs last in L2, and a plugin-tree load failure would normally be caught earlier
   by the boot-graph assertion; whether it can go red on its own is untested. This is an
   **uncovered item, not a defect**.
7. **`die()` prints the log tail (including a one-time token).** On probe failure it tails the
   container's `dsh web` log, which contains a one-time login token, so those lines land in that
   grid's log file `testbed/.out/<version>-<combo>.log` (written by `matrix.mjs`; `.out/` is
   gitignored). **Redact before sharing logs**, e.g.
   `sed -E 's/([?&]token=)[^ &]+/\1[REDACTED]/g'`.
8. **Base image provenance.** The `Dockerfile` `FROM` is always the official
   `node:24-bookworm-slim`. In an environment where direct `docker.io` access times out and the
   daemon's mirror is unavailable, the image is prefetched from a trusted mirror and then **tagged
   locally under the original name** (see "Base image"). That is an environment-side workaround,
   not file content; requiring strict official-`docker.io` provenance means fixing the network or
   the mirror first. The digest this environment measured is recorded in "Base image".
9. **This is not a security sandbox.** The container executes this repository's and the
   companion's source code, and can read the **real credentials** mounted read-only into it (the
   entire `$DSH_HOME` is mounted). It addresses environment pollution and version matrices, **not**
   untrusted-code isolation — only run it on a machine where you are willing to run that code in a
   container.
10. **`DOCKER_CONFIG`.** Host-side `docker compose` invocations need a writable in-repo directory:
    `export DOCKER_CONFIG="$PWD/.docker-config"` (under some sandboxes `/root/.docker` is
    read-only). `matrix.mjs` sets it automatically.
11. **Scope limits.** No browser E2E (real GUI rendering) and no real upstream (NewAPI etc.) calls;
    L2 drives the server with a curl probe instead. This environment does not modify CI and does
    not take the host's port 3080.
12. **The default matrix follows the registry's host line.** `node matrix.mjs` resolves the
    registry's `latest + next` by default. As of 2026-10-04, upstream `latest` and `next` are both
    `0.2.0-rc.2` (supported), so the default matrix only covers the 0.2.0 line. When you pin an
    older line explicitly, `0.1.7-rc.1` reports FAIL from the version guard — an expected signal,
    not a regression. To run only the supported line: `node matrix.mjs --versions 0.2.0-rc.2`.
