// @vitest-environment jsdom
/**
 * NewApiSection behavior over a scripted wire face. These tests assert
 * user-visible outcomes (fields rendered, calls made) — never React internals.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewApiSection } from '../../src/client/NewApiSection.tsx'
import { en } from '../../src/client/locale.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

/** A wire face answering one resolved llm-newapi section. */
function wireFace(overrides: Partial<{
  describeAnswer: unknown
  credentialsAnswer: unknown
}> = {}) {
  return {
    settings: {
      describe: vi.fn(() => Promise.resolve({
        result: {
          ok: true,
          value: overrides.describeAnswer ?? {
            writable: true,
            hasDocument: true,
            namespaces: [{
              ns: 'llm-newapi',
              schema: {},
              value: { baseURL: 'http://gw.local:3000/v1', models: [{ id: 'deepseek-chat', contextWindow: 65536 }] },
              applies: 'live',
              secrets: [],
              revision: 7,
            }],
          },
        },
      })),
      mutate: vi.fn(() => Promise.resolve({ result: { ok: true, value: { ns: 'llm-newapi', revision: 8 } } })),
    },
    credentials: {
      describe: vi.fn(() => Promise.resolve({
        result: { ok: true, value: overrides.credentialsAnswer ?? { credentials: { newapi: { configured: true, writable: true } } } },
      })),
      set: vi.fn(() => Promise.resolve({ result: { ok: true, value: undefined } })),
    },
    llm: { discoverModels: vi.fn() },
  }
}

describe('NewApiSection mount', () => {
  it('loads the section on mount and renders the configuration form', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)

    // The form fields the user configures the provider through.
    await waitFor(() => { expect(screen.getByLabelText(t('baseUrl'))).toBeTruthy() })
    expect((screen.getByLabelText(t('baseUrl')) as HTMLInputElement).value)
      .toBe('http://gw.local:3000/v1')
    expect(screen.getByLabelText(t('keyInput'))).toBeTruthy()
    expect(screen.getByText(t('fetchModels'))).toBeTruthy()
    expect(screen.getByText(t('apply'))).toBeTruthy()

    // The mount itself interrogated the settings plane.
    expect(api.settings.describe).toHaveBeenCalledTimes(1)
  })

  it('names the missing namespace when the host has no llm-newapi section', async () => {
    const api = wireFace({ describeAnswer: { writable: true, hasDocument: true, namespaces: [] } })
    render(<NewApiSection api={api as never} t={t} />)

    await waitFor(() => { expect(screen.getByText(new RegExp('not registered'))).toBeTruthy() })
    expect(screen.getByText(t('retry'))).toBeTruthy()
  })
})

describe('environment-supplied credential (read-only)', () => {
  const envCredential = {
    credentials: { newapi: { configured: true, writable: false, source: 'env' } },
  }

  it('locks the key field with the launch-environment placeholder', async () => {
    const api = wireFace({ credentialsAnswer: envCredential })
    render(<NewApiSection api={api as never} t={t} />)

    await waitFor(() => { expect(screen.getByLabelText(t('keyInput'))).toBeTruthy() })
    // The official ProviderEditor pattern: writable === false disables the
    // input and the placeholder states the fact (launch environment, read-only).
    expect((screen.getByLabelText(t('keyInput')) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(t('keyInput')) as HTMLInputElement).placeholder).toBe(t('keyEnvLocked'))
  })

  it('saves the section without attempting a shadowed credential write', async () => {
    const api = wireFace({ credentialsAnswer: envCredential })
    render(<NewApiSection api={api as never} t={t} />)

    await waitFor(() => { expect(screen.getByLabelText(t('baseUrl'))).toBeTruthy() })
    fireEvent.change(screen.getByLabelText(t('baseUrl')), { target: { value: 'http://other:3000/v1' } })
    fireEvent.click(screen.getByText(t('apply')))

    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    expect(api.credentials.set).not.toHaveBeenCalled()
    await waitFor(() => { expect(screen.getByText(t('saved'))).toBeTruthy() })
  })
})

describe('model catalog', () => {
  /** The models op of the first mutate call. */
  function savedModels(api: ReturnType<typeof wireFace>): Array<Record<string, unknown>> {
    return api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'models').value
  }

  it('folds capacities behind the row disclosure and adopts K/M entry', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)

    await waitFor(() => { expect(screen.getByLabelText(t('baseUrl'))).toBeTruthy() })
    // Capacities are not on the row until its disclosure opens.
    expect(screen.queryByLabelText(`${t('contextWindow')} 1`)).toBeNull()
    fireEvent.click(screen.getByLabelText(`${t('modelAdvanced')} 1`))
    const context = await waitFor(() => screen.getByLabelText(`${t('contextWindow')} 1`))
    // 65536 is not a whole multiple of 1000, so it stays written out.
    expect((context as HTMLInputElement).value).toBe('65536')

    fireEvent.change(context, { target: { value: '256K' } })
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    expect(savedModels(api)[0].contextWindow).toBe(256_000)
  })

  it('drops an emptied name instead of storing an empty string', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)

    const name = await waitFor(() => screen.getByLabelText(`${t('modelName')} 1`))
    fireEvent.change(name, { target: { value: 'Renamed' } })
    fireEvent.change(name, { target: { value: '' } })
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    expect(savedModels(api)[0].name).toBeUndefined()
  })

  it('adds a row through the add-model action and refuses a save with an empty id', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)

    await waitFor(() => { expect(screen.getByText(t('addModel'))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('addModel')))
    expect(screen.getByLabelText(`${t('modelId')} 2`)).toBeTruthy()

    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(screen.getByText(new RegExp(t('modelIdRequired')))).toBeTruthy() })
    expect(api.settings.mutate).not.toHaveBeenCalled()
  })
})
