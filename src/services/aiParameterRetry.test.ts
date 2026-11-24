import { describe, expect, it } from 'vitest'
import { adjustBodyForParameterError } from './aiParameterRetry'

const body = { model: 'o-mini', messages: [], max_tokens: 100, temperature: 0.8, top_p: 0.9 }

describe('parameter retry', () => {
  it('drops the parameter named in an unsupported-parameter error', () => {
    const result = adjustBodyForParameterError(400, '{"error":{"message":"Unsupported parameter: \'temperature\' is not supported with this model."}}', body)
    expect(result?.dropped).toBe('temperature')
    expect(result?.body).not.toHaveProperty('temperature')
    expect(result?.body).toHaveProperty('top_p', 0.9)
  })

  it('renames max_tokens when the provider asks for max_completion_tokens', () => {
    const result = adjustBodyForParameterError(400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", body)
    expect(result?.body).toMatchObject({ max_completion_tokens: 100 })
    expect(result?.body).not.toHaveProperty('max_tokens')
  })

  it('does not retry key, quota, content or unrelated errors', () => {
    expect(adjustBodyForParameterError(401, 'invalid temperature', body)).toBeNull()
    expect(adjustBodyForParameterError(400, 'Invalid API key', body)).toBeNull()
    expect(adjustBodyForParameterError(400, 'insufficient quota, invalid temperature', body)).toBeNull()
    expect(adjustBodyForParameterError(400, '内容审核不通过', body)).toBeNull()
    expect(adjustBodyForParameterError(400, 'messages too long', body)).toBeNull()
  })
})
