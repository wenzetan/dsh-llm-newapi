/**
 * The NewAPI settings section: API key (write-only), gateway base URL, and
 * the model list with endpoint interrogation. Pure props — no ctx, no
 * contexts, no subscription machinery; everything arrives through the inject
 * face the apply closure owns (api wire face + bound translate).
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { DiscoveredModelView, IApiClient, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-client-connection/client'
import type { NewApiKey } from './locale.ts'

/** One editable model row; capacities are optional free-form drafts. */
interface ModelDraft {
  id: string
  name: string
  contextWindow: string
  maxTokens: string
}

/** Inject face: the wire face and the bound translate. */
export interface NewApiSectionProps {
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  t: (key: NewApiKey) => string
}

const NS = 'llm-newapi'
const KEY_REF = 'NEWAPI_API_KEY'

const fieldStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12,
}
const inputStyle: CSSProperties = {
  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border, #444)',
  background: 'var(--dsw-alias-input-bg, #1b1b1b)', color: 'inherit', fontSize: 13,
}
const buttonStyle: CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid var(--dsw-alias-border, #444)',
  background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13,
}
const primaryButtonStyle: CSSProperties = {
  ...buttonStyle, background: 'var(--dsw-alias-accent, #3b82f6)', borderColor: 'transparent',
}
const rowStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr auto', gap: 8, marginBottom: 8,
  alignItems: 'center',
}

function toDraft(source: unknown): ModelDraft[] {
  const models = Array.isArray(source) ? source : []
  return models.map((entry) => {
    const model = (entry ?? {}) as Record<string, unknown>
    return {
      id: typeof model.id === 'string' ? model.id : '',
      name: typeof model.name === 'string' ? model.name : '',
      contextWindow: model.contextWindow === undefined ? '' : String(model.contextWindow),
      maxTokens: model.maxTokens === undefined ? '' : String(model.maxTokens),
    }
  })
}

function capacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const value = Number(trimmed)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function toWire(models: readonly ModelDraft[]): unknown {
  return models.map(model => ({
    id: model.id.trim(),
    ...model.name.trim().length > 0 ? { name: model.name.trim() } : {},
    ...capacity(model.contextWindow) !== undefined ? { contextWindow: capacity(model.contextWindow) } : {},
    ...capacity(model.maxTokens) !== undefined ? { maxTokens: capacity(model.maxTokens) } : {},
  }))
}

/**
 * Render the NewAPI settings section.
 * @param props - the wire face and the bound translate.
 * @returns the section.
 */
export function NewApiSection(props: NewApiSectionProps): ReactNode {
  const { api, t } = props
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorText, setErrorText] = useState<string | undefined>(undefined)
  const [revision, setRevision] = useState<number>(0)
  const [writable, setWritable] = useState(true)
  const [keyConfigured, setKeyConfigured] = useState<boolean | undefined>(undefined)
  /** Whether the credential seam reports the key reference read-only (launch environment). */
  const [keyLocked, setKeyLocked] = useState(false)
  const [baseURL, setBaseURL] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [models, setModels] = useState<ModelDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  const load = async (): Promise<void> => {
    setStatus('loading')
    setErrorText(undefined)
    try {
      const described = await api.settings.describe({})
      if (!described.result.ok) {
        setErrorText(described.result.error.message)
        setStatus('error')
        return
      }
      setWritable(described.result.value.writable)
      const section = described.result.value.namespaces.find((entry: SettingsNamespaceView) => entry.ns === NS)
      if (section === undefined) {
        setErrorText(`${NS}: settings namespace is not registered (is the llm-newapi plugin row loaded?)`)
        setStatus('error')
        return
      }
      const value = (section.value ?? {}) as Record<string, unknown>
      setRevision(section.revision)
      setBaseURL(typeof value.baseURL === 'string' ? value.baseURL : '')
      setModels(toDraft(value.models))
      const credential = await api.credentials.describe({ refs: [KEY_REF] })
      if (credential.result.ok) {
        const view = credential.result.value.credentials[KEY_REF]
        setKeyConfigured(view?.configured)
        setKeyLocked(view?.writable === false)
      }
      setStatus('ready')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
  }

  const patchModel = (at: number, next: Partial<ModelDraft>): void => {
    setModels(current => current.map((model, index) => index === at ? { ...model, ...next } : model))
  }

  // The section interrogates the settings plane once on mount: the page the
  // slot renders must show the stored configuration, not an eternal ellipsis.
  useEffect(() => { void load() }, [])

  const saved = (text: string): void => {
    setNotice(text)
    void load()
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    setErrorText(undefined)
    try {
      const trimmedBase = baseURL.trim()
      const ops: SettingsPathOpView[] = []
      if (trimmedBase.length > 0) ops.push({ op: 'set', path: ['baseURL'], value: trimmedBase })
      else ops.push({ op: 'unset', path: ['baseURL'] })
      ops.push({ op: 'set', path: ['models'], value: toWire(models) })
      const mutated = await api.settings.mutate({ ns: NS, ops, expectedRevision: revision })
      if (!mutated.result.ok) {
        setErrorText(mutated.result.error.message)
        return
      }
      setRevision(mutated.result.value.revision)
      const key = keyDraft.trim()
      if (key.length > 0) {
        const stored = await api.credentials.set({ ref: KEY_REF, value: key })
        if (!stored.result.ok) {
          setErrorText(stored.result.error.message)
          return
        }
        setKeyDraft('')
      }
      saved(t('saved'))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setErrorText(undefined)
    setCandidates(undefined)
    try {
      const key = keyDraft.trim()
      const response = await api.llm.discoverModels({
        settingsNs: NS,
        ...baseURL.trim().length > 0 ? { baseURL: baseURL.trim() } : {},
        ...key.length > 0 ? { apiKey: key } : {},
      })
      if (!response.result.ok) {
        setErrorText(response.result.error.message)
        return
      }
      const found = response.result.value.models
      if (found.length === 0) {
        setErrorText(t('fetchEmpty'))
        return
      }
      const known = new Set(models.map(model => model.id.trim()).filter(id => id.length > 0))
      setCandidates(found)
      setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const adopt = (): void => {
    if (candidates === undefined) return
    const existing = new Map(models.map(model => [model.id.trim(), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      if (existing.has(candidate.id)) continue
      existing.set(candidate.id, {
        id: candidate.id,
        name: candidate.name ?? '',
        contextWindow: candidate.contextWindow === undefined ? '' : String(candidate.contextWindow),
        maxTokens: candidate.maxTokens === undefined ? '' : String(candidate.maxTokens),
      })
    }
    setModels([...existing.values()])
    setCandidates(undefined)
    setPicked(new Set())
  }

  const toggle = (id: string): void => {
    setPicked(current => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  if (status === 'loading') return <section aria-label={t('nav')}><p>…</p></section>
  if (status === 'error') {
    return (
      <section aria-label={t('nav')}>
        <p style={{ color: '#f87171' }}>{`${t('loadFailed')}: ${errorText ?? ''}`}</p>
        <button type="button" style={buttonStyle} onClick={() => { void load() }}>{t('retry')}</button>
      </section>
    )
  }

  return (
    <section aria-label={t('nav')}>
      <p>{t('intro')}</p>
      {notice === undefined ? null : <p role="status">{notice}</p>}
      {!writable ? <p>{t('readOnly')}</p> : null}
      {errorText === undefined ? null : <p style={{ color: '#f87171' }}>{errorText}</p>}

      <div style={fieldStyle}>
        <label htmlFor="newapi-key">{t('keyInput')}</label>
        {/* The official ProviderEditor credential pattern: a read-only
            credential (launch environment) locks the input and the
            placeholder states the fact; no separate hint paragraph. */}
        <input
          id="newapi-key" type="password" autoComplete="off" style={inputStyle}
          disabled={keyLocked}
          placeholder={keyLocked
            ? t('keyEnvLocked')
            : keyConfigured === true ? t('keyStored') : keyConfigured === false ? t('keyMissing') : t('keyPlaceholder')}
          value={keyDraft}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="newapi-base">{t('baseUrl')}</label>
        <input
          id="newapi-base" type="text" style={inputStyle} placeholder={t('baseUrlPlaceholder')}
          value={baseURL}
          onChange={(event) => { setBaseURL(event.target.value) }}
        />
      </div>

      <div style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{t('models')}</strong>
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void fetchModels() }}>
          {busy ? t('fetching') : t('fetchModels')}
        </button>
        <button type="button" style={buttonStyle} disabled={busy}
          onClick={() => { setModels(current => [...current, { id: '', name: '', contextWindow: '', maxTokens: '' }]) }}>
          {t('addModel')}
        </button>
      </div>

      {candidates === undefined ? null : (
        <div style={{ border: '1px solid var(--dsw-alias-border, #444)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <strong>{t('fetchTitle')}</strong>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
            {candidates.map(model => (
              <li key={model.id}>
                <label>
                  <input
                    type="checkbox" checked={picked.has(model.id)}
                    onChange={() => { toggle(model.id) }}
                  />
                  {' '}
                  {model.id}{model.name === undefined || model.name === model.id ? '' : ` (${model.name})`}
                </label>
              </li>
            ))}
          </ul>
          <button type="button" style={primaryButtonStyle} disabled={picked.size === 0} onClick={adopt}>
            {t('fetchAdopt')}
          </button>
          {' '}
          <button type="button" style={buttonStyle} onClick={() => { setCandidates(undefined); setPicked(new Set()) }}>
            {t('fetchCancel')}
          </button>
        </div>
      )}

      {models.map((model, index) => (
        <div key={index} style={rowStyle}>
          <input style={inputStyle} aria-label={t('modelId')} value={model.id}
            placeholder={t('modelId')}
            onChange={(event) => { patchModel(index, { id: event.target.value }) }} />
          <input style={inputStyle} aria-label={t('modelName')} value={model.name}
            placeholder={t('modelName')}
            onChange={(event) => { patchModel(index, { name: event.target.value }) }} />
          <input style={inputStyle} aria-label={t('contextWindow')} value={model.contextWindow}
            placeholder={t('contextWindow')} inputMode="numeric"
            onChange={(event) => { patchModel(index, { contextWindow: event.target.value }) }} />
          <input style={inputStyle} aria-label={t('maxTokens')} value={model.maxTokens}
            placeholder={t('maxTokens')} inputMode="numeric"
            onChange={(event) => { patchModel(index, { maxTokens: event.target.value }) }} />
          <button type="button" style={buttonStyle} aria-label={`${t('removeModel')} ${model.id}`}
            onClick={() => { setModels(current => current.filter((_, at) => at !== index)) }}>
            ✕
          </button>
        </div>
      ))}

      <p style={{ fontSize: 12 }}>{t('modelHint')}</p>

      <button type="button" style={primaryButtonStyle} disabled={busy || !writable} onClick={() => { void save() }}>
        {busy ? t('applying') : t('apply')}
      </button>
    </section>
  )
}
