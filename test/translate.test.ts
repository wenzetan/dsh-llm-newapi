import { describe, expect, it } from 'vitest'
import { translate, mapUsage } from '../src/translate.ts'

const DONE = '[DONE]'
const payload = (wire: object) => JSON.stringify(wire)

describe('tool-call deltas with explicit JSON null id/name', () => {
  // Some upstreams re-send `id` and `function.name` as JSON `null` on
  // continuation deltas instead of omitting the field. Earlier (issue #1)
  // code guarded against EMPTY strings with `value.length > 0` but only
  // checked `!== undefined`, so `null` slipped through and the `.length`
  // read crashed the stream — caught by `adapter.stream()` and surfaced as
  // TRANSPORT "NewAPI stream from ... failed". The stream cut happened
  // exactly when a tool call began.
  it('keeps the real id/name from the first delta when later deltas carry null', async () => {
    const wire = (json: object) => payload({ choices: [{ delta: json }] })
    const finish = (toolCalls: object[]) => payload({ choices: [{ delta: { tool_calls: toolCalls }, finish_reason: 'tool_calls' }] })
    const inputs = [
      wire({ reasoning_content: 'plan ahead', content: '', tool_calls: null }),
      wire({ tool_calls: [{ index: 0, id: 'call-real', type: 'function', function: { name: 'bash', arguments: '' } }] }),
      wire({ tool_calls: [{ index: 0, id: null, type: null, function: { name: null, arguments: '' } }] }),
      finish([{ index: 0, id: null, type: null, function: { name: null, arguments: '{"command":"ls"}' } }]),
      DONE,
    ]
    const out: any[] = []
    for await (const chunk of translate((async function* () { for (const p of inputs) yield p })())) out.push(chunk)
    const blockEnd = out.find(c => c.type === 'block-end' && c.block?.type === 'tool-call')
    expect(blockEnd?.block).toEqual({ type: 'tool-call', id: 'call-real', name: 'bash', arguments: '{"command":"ls"}' })
    expect(out.find(c => c.type === 'finish')?.reason).toEqual({ kind: 'tool-calls' })
  })

  it('keeps the real id when the name is sent as null', async () => {
    const wire = (json: object) => payload({ choices: [{ delta: json }] })
    const finish = (toolCalls: object[]) => payload({ choices: [{ delta: { tool_calls: toolCalls }, finish_reason: 'tool_calls' }] })
    const inputs = [
      wire({ tool_calls: [{ index: 0, id: 'call-real', type: 'function', function: { name: 'bash', arguments: '' } }] }),
      wire({ tool_calls: [{ index: 0, id: 'call-real', type: 'function', function: { name: null, arguments: '' } }] }),
      finish([{ index: 0, id: 'call-real', type: 'function', function: { name: null, arguments: '{}' } }]),
      DONE,
    ]
    const out: any[] = []
    for await (const chunk of translate((async function* () { for (const p of inputs) yield p })())) out.push(chunk)
    const blockEnd = out.find(c => c.type === 'block-end' && c.block?.type === 'tool-call')
    expect(blockEnd?.block?.name).toBe('bash')
  })

  it('coerces null arguments to an empty fragment', async () => {
    const wire = (json: object) => payload({ choices: [{ delta: json }] })
    const finish = (toolCalls: object[]) => payload({ choices: [{ delta: { tool_calls: toolCalls }, finish_reason: 'tool_calls' }] })
    const inputs = [
      wire({ tool_calls: [{ index: 0, id: 'call-real', type: 'function', function: { name: 'bash', arguments: null } }] }),
      finish([{ index: 0, id: 'call-real', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } }]),
      DONE,
    ]
    const out: any[] = []
    for await (const chunk of translate((async function* () { for (const p of inputs) yield p })())) out.push(chunk)
    const blockEnd = out.find(c => c.type === 'block-end' && c.block?.type === 'tool-call')
    expect(blockEnd?.block?.arguments).toBe('{"command":"ls"}')
  })
})

describe('mapUsage totalTokens', () => {
  it('derives totalTokens from valid prompt and completion counts', () => {
    expect(mapUsage({ prompt_tokens: 12, completion_tokens: 8 })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    })
  })

  it('includes totalTokens when a matching wire total is present', () => {
    expect(mapUsage({ prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    })
  })

  it('omits totalTokens when the wire total disagrees', () => {
    expect(mapUsage({ prompt_tokens: 12, completion_tokens: 8, total_tokens: 21 })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
    })
  })

  it.each([
    { prompt_tokens: -1, completion_tokens: 8 },
    { prompt_tokens: 12, completion_tokens: -1 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 0 },
  ])('omits totalTokens for invalid counts: %o', usage => {
    expect(mapUsage(usage)).not.toHaveProperty('totalTokens')
  })

  it('preserves disjoint cache and reasoning accounting', () => {
    expect(mapUsage({
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
      prompt_tokens_details: { cached_tokens: 5 },
      completion_tokens_details: { reasoning_tokens: 3 },
    })).toEqual({
      inputTokens: 7,
      outputTokens: 8,
      cacheReadTokens: 5,
      reasoningTokens: 3,
      totalTokens: 20,
    })
  })
})
