/**
 * Cache https://models.dev/api.json locally for development: the catalog's
 * real field shapes (limit.context/output, reasoning_options) are what the
 * smoke suite and hand-checks compare against, and models.dev is often
 * unreachable without a proxy. Resolution order:
 *
 *   1. direct fetch of https://models.dev/api.json;
 *   2. the same fetch through $HTTPS_PROXY / $https_proxy (ProxyAgent);
 *   3. --from-github fallback: pull the canonical model TOMLs from the
 *      models.dev source repo (raw.githubusercontent.com — usually
 *      reachable) and synthesize a subset snapshot with the same shape.
 *
 * The result lands in .cache/models-dev.api.json (gitignored). Run with
 * `npm run cache:models-dev`.
 */
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { mkdir, writeFile } from 'node:fs/promises'

const OUT = '.cache/models-dev.api.json'
const URL_ = 'https://models.dev/api.json'
const RAW = 'https://raw.githubusercontent.com/sst/models.dev/dev'
const TIMEOUT_MS = 30_000

/** Subset used by the --from-github fallback: provider key -> toml paths. */
const GITHUB_SUBSET = [
  ['openai', ['providers/302ai/models/gpt-5.1.toml']],
  ['deepseek', ['models/deepseek/deepseek-chat.toml', 'models/deepseek/deepseek-reasoner.toml']],
  ['zhipuai', ['models/zhipuai/glm-4.5.toml', 'models/zhipuai/glm-4.5-air.toml']],
]

async function fetchText(url, proxyUrl) {
  const dispatcher = proxyUrl === undefined ? undefined : new ProxyAgent(proxyUrl)
  try {
    const response = await undiciFetch(url, {
      headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.8' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...dispatcher === undefined ? {} : { dispatcher },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    void dispatcher?.close().catch(() => {})
  }
}

/** Minimal TOML reads for the fields the snapshot needs. */
function parseModelToml(text) {
  const name = /^name = "(.+)"$/m.exec(text)?.[1]
  const number = (key) => {
    const hit = new RegExp(`^${key} = ([\\d_]+)$`, 'm').exec(text)
    return hit === undefined ? undefined : Number(hit[1].replaceAll('_', ''))
  }
  const limitContext = /\[limit\][\s\S]*?^context = [\d_]+$/m.test(text) ? number('context') : undefined
  const limitOutput = /\[limit\][\s\S]*?^output = [\d_]+$/m.test(text) ? number('output') : undefined
  const efforts = /reasoning_options = \[\{ type = "effort", values = \[([^\]]*)\]/.exec(text)?.[1]
    ?.split(',').map(value => value.trim().replace(/^"|"$/g, '')).filter(value => value.length > 0)
  return {
    ...name === undefined ? {} : { name },
    ...limitContext === undefined && limitOutput === undefined ? {} : {
      limit: {
        ...limitContext === undefined ? {} : { context: limitContext },
        ...limitOutput === undefined ? {} : { output: limitOutput },
      },
    },
    ...efforts === undefined ? {} : { reasoning_options: [{ type: 'effort', values: efforts }] },
  }
}

async function fromGithub() {
  const snapshot = {}
  for (const [provider, paths] of GITHUB_SUBSET) {
    const models = {}
    for (const path of paths) {
      const id = path.slice(path.lastIndexOf('/') + 1).replace(/\.toml$/, '')
      models[id] = parseModelToml(await fetchText(`${RAW}/${path}`, undefined))
    }
    snapshot[provider] = { models }
  }
  return { _source: 'github-synthetic-subset', ...snapshot }
}

const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy
let text
try {
  text = await fetchText(URL_, undefined)
  JSON.parse(text)
  console.log('fetched https://models.dev/api.json directly')
} catch {
  if (proxyUrl !== undefined) {
    try {
      text = await fetchText(URL_, proxyUrl)
      JSON.parse(text)
      console.log(`fetched via proxy ${proxyUrl}`)
    } catch {
      text = undefined
    }
  }
}
const body = text ?? JSON.stringify(await fromGithub(), null, 2)
if (text === undefined) console.log('models.dev unreachable; wrote a GitHub-synthetic subset snapshot instead')
await mkdir('.cache', { recursive: true })
await writeFile(OUT, body, 'utf8')
const parsed = JSON.parse(body)
const providers = Object.keys(parsed).filter(key => !key.startsWith('_'))
console.log(`${OUT}: ${providers.length} providers, ${providers.reduce((n, p) => n + Object.keys(parsed[p]?.models ?? {}).length, 0)} models`)
