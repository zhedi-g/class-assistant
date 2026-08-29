// 设备级 AES-GCM 加密：随机密钥生成后存 IndexedDB 且不可导出，密文与密钥物理分离。
// 非 HTTPS 环境（如局域网 IP 调试）下 WebCrypto 不可用，退化为 base64 混淆；
// 部署到 HTTPS 后自动恢复真加密，无需改代码。
import { openDB, idbGet, idbSet } from './idb'

const META = 'meta'
const AES_KEY_ID = 'device-aes-key'
const PREFIX_ENC = 'enc1.'
const PREFIX_PLAIN = 'plain.'

let deviceKeyPromise: Promise<CryptoKey | null> | null = null

function getDeviceKey(): Promise<CryptoKey | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return Promise.resolve(null)
  if (!deviceKeyPromise) {
    deviceKeyPromise = (async () => {
      const db = await openDB()
      const existing = await idbGet<CryptoKey>(db, META, AES_KEY_ID)
      if (existing) return existing
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ])
      await idbSet(db, META, AES_KEY_ID, key)
      return key
    })()
  }
  return deviceKeyPromise
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function encryptText(plain: string): Promise<string> {
  const key = await getDeviceKey()
  const data = new TextEncoder().encode(plain)
  if (!key) return PREFIX_PLAIN + toB64(data)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return PREFIX_ENC + toB64(iv) + '.' + toB64(new Uint8Array(ct))
}

export async function decryptText(payload: string): Promise<string> {
  if (payload.startsWith(PREFIX_PLAIN)) {
    return new TextDecoder().decode(fromB64(payload.slice(PREFIX_PLAIN.length)))
  }
  if (!payload.startsWith(PREFIX_ENC)) return payload // 兼容裸文本
  const key = await getDeviceKey()
  if (!key) throw new Error('当前环境无法解密（WebCrypto 不可用）')
  const [ivB64, ctB64] = payload.slice(PREFIX_ENC.length).split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64))
  return new TextDecoder().decode(pt)
}
