import type { ModelConfig } from '@/stores/config'
import { openAiV1BaseUrl } from './ai'
import { resolveAiProtocol } from './aiProtocols'

type ConnectionFingerprintInput = Pick<ModelConfig, 'baseUrl' | 'modelName' | 'apiKey' | 'kind' | 'apiProtocol'>

/** Hashes the effective connection inputs without persisting any credential material. */
export async function modelConnectionFingerprint(model: ConnectionFingerprintInput): Promise<string> {
  const payload = JSON.stringify({
    schema: 1,
    baseUrl: model.baseUrl.trim(),
    endpoint: openAiV1BaseUrl(model.baseUrl).toLowerCase(),
    model: model.modelName.trim(),
    kind: model.kind || 'chat',
    protocol: model.kind === 'embedding' ? undefined : resolveAiProtocol(model),
    key: model.apiKey.trim(),
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
