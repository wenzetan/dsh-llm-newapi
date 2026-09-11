import { describe, expect, it } from 'vitest'
import { mapUsage } from '../src/translate.ts'

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
