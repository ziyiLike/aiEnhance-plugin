import net from "node:net"

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 3

export class ImageInputError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "ImageInputError"
    this.code = code
  }
}

function asSegments(message) {
  if (Array.isArray(message)) return message
  if (message && typeof message === "object") return [message]
  return []
}

function imageSourceFromSegment(segment) {
  if (!segment || segment.type !== "image") return ""

  const values = [
    segment.url,
    segment.file,
    segment.data?.url,
    segment.data?.file,
  ]
  return values.find(value => typeof value === "string" && value.trim())?.trim() || ""
}

function declaredSize(segment) {
  const size = Number(segment?.size ?? segment?.data?.size)
  return Number.isFinite(size) && size >= 0 ? size : null
}

/**
 * 只读取适配器已经解析出的图片消息段，不从 raw_message 中解析 URL。
 * raw_message 可能包含临时鉴权参数，直接解析既不稳定，也容易误收普通文本链接。
 */
export function extractImageSources(event) {
  const sources = []
  const seen = new Set()

  for (const segment of asSegments(event?.message)) {
    const source = imageSourceFromSegment(segment)
    if (!source || seen.has(source)) continue
    seen.add(source)
    sources.push({
      source,
      size: declaredSize(segment),
    })
  }

  return sources
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false

  const [first, second] = parts
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  )
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.toLowerCase()
  if (normalized === "::" || normalized === "::1") return true
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  if (/^fe[89ab]/.test(normalized)) return true
  if (normalized.startsWith("::ffff:")) return true
  return false
}

function validateRemoteUrl(value, { allowInsecureHttp }) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new ImageInputError("invalid_url", "图片地址不是有效 URL")
  }

  if (url.protocol !== "https:" && !(allowInsecureHttp && url.protocol === "http:")) {
    throw new ImageInputError("unsafe_url", "图片地址协议不受支持")
  }

  if (url.username || url.password) {
    throw new ImageInputError("unsafe_url", "图片地址不得包含登录凭据")
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (net.isIP(hostname) === 4 && isPrivateIpv4(hostname)) ||
    (net.isIP(hostname) === 6 && isPrivateIpv6(hostname))
  ) {
    throw new ImageInputError("unsafe_url", "图片地址指向本机或私有网络")
  }

  return url
}

function detectImageType(bytes) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg"
  }

  const signature = bytes.subarray(0, 6).toString("ascii")
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif"

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }

  return ""
}

function checkedImage(bytes, maxBytes) {
  if (!bytes.length) {
    throw new ImageInputError("empty_image", "图片内容为空")
  }
  if (bytes.length > maxBytes) {
    throw new ImageInputError("image_too_large", "图片超过大小限制")
  }

  const mimeType = detectImageType(bytes)
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    throw new ImageInputError("unsupported_image", "图片格式不受支持")
  }
  return { bytes, mimeType }
}

function decodeInlineImage(source, maxBytes) {
  let encoded = ""
  let declaredType = ""

  if (source.startsWith("base64://")) {
    encoded = source.slice("base64://".length)
  } else {
    const match = source.match(/^data:([^;,]+);base64,([a-z\d+/=\s]+)$/i)
    if (!match) {
      throw new ImageInputError("invalid_data_url", "图片 data URL 无效")
    }
    declaredType = match[1].toLowerCase()
    encoded = match[2]
  }

  if (declaredType && !SUPPORTED_IMAGE_TYPES.has(declaredType)) {
    throw new ImageInputError("unsupported_image", "图片格式不受支持")
  }

  // Base64 长度可在解码前给出安全上界，避免超大内联内容产生额外内存峰值。
  if (encoded.replace(/\s/g, "").length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new ImageInputError("image_too_large", "图片超过大小限制")
  }

  return checkedImage(Buffer.from(encoded, "base64"), maxBytes)
}

async function readLimitedBody(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ImageInputError("image_too_large", "图片超过大小限制")
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        total += chunk.length
        if (total > maxBytes) {
          await reader.cancel().catch(() => {})
          throw new ImageInputError("image_too_large", "图片超过大小限制")
        }
        chunks.push(chunk)
      }
    } finally {
      reader.releaseLock?.()
    }

    return Buffer.concat(chunks, total)
  }

  if (typeof response.arrayBuffer !== "function") {
    throw new ImageInputError("download_failed", "图片响应无法读取")
  }
  return Buffer.from(await response.arrayBuffer())
}

async function fetchImage(fetchImpl, source, config, signal) {
  let url = validateRemoteUrl(source, config)

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5",
      },
      redirect: "manual",
      signal,
    })

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers?.get?.("location")
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new ImageInputError("download_failed", "图片重定向次数过多")
      }
      url = validateRemoteUrl(new URL(location, url).toString(), config)
      continue
    }

    if (!response.ok) {
      throw new ImageInputError("download_failed", `图片下载返回 HTTP ${response.status}`)
    }

    return checkedImage(
      await readLimitedBody(response, config.maxBytesPerImage),
      config.maxBytesPerImage,
    )
  }

  throw new ImageInputError("download_failed", "图片下载失败")
}

function toDataUrl({ bytes, mimeType }) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`
}

async function prepareSource(fetchImpl, item, config) {
  if (item.size !== null && item.size > config.maxBytesPerImage) {
    throw new ImageInputError("image_too_large", "图片超过大小限制")
  }

  if (item.source.startsWith("data:") || item.source.startsWith("base64://")) {
    return decodeInlineImage(item.source, config.maxBytesPerImage)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    return await fetchImage(fetchImpl, item.source, config, controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}

export class ImageInput {
  constructor({ fetchImpl = globalThis.fetch, logger = console } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("当前 Node.js 环境没有可用的 fetch")
    }
    this.fetch = fetchImpl
    this.logger = logger
  }

  async prepare(event, config) {
    const sources = extractImageSources(event)
    if (!sources.length) return { hadImages: false, images: [], failures: [] }
    if (!config.enabled) {
      return {
        hadImages: true,
        images: [],
        failures: [{ code: "vision_disabled" }],
      }
    }

    const images = []
    const failures = []

    const results = await Promise.all(
      sources.slice(0, config.maxImages).map(async item => {
        try {
          return {
            image: await prepareSource(this.fetch, item, config),
          }
        } catch (error) {
          return {
            code:
              error?.name === "AbortError"
                ? "download_timeout"
                : error instanceof ImageInputError
                  ? error.code
                  : "download_failed",
          }
        }
      }),
    )

    for (const result of results) {
      if (result.image) {
        images.push({
          dataUrl: toDataUrl(result.image),
          mimeType: result.image.mimeType,
          byteLength: result.image.bytes.length,
        })
        continue
      }

      failures.push({ code: result.code })
      this.logger.warn?.(`[aiEnhance-plugin] 图片读取失败 code=${result.code}`)
    }

    if (sources.length > config.maxImages) {
      failures.push({
        code: "too_many_images",
        count: sources.length - config.maxImages,
      })
    }

    return { hadImages: true, images, failures }
  }
}

export {
  SUPPORTED_IMAGE_TYPES,
  checkedImage,
  decodeInlineImage,
  detectImageType,
  fetchImage,
  prepareSource,
  toDataUrl,
  validateRemoteUrl,
  readLimitedBody,
}
