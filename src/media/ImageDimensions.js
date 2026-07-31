const JPEG_START_OF_FRAME = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
])

export const GUIDE_IMAGE_LIMITS = {
  maxDimension: 8_192,
  maxPixels: 32_000_000,
  maxAspectRatio: 8,
}

function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

function jpegDimensions(bytes) {
  let offset = 2

  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset++
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    if (offset >= bytes.length) break

    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (offset + 2 > bytes.length) break

    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    if (JPEG_START_OF_FRAME.has(marker) && length >= 7) {
      return dimensions(
        bytes.readUInt16BE(offset + 5),
        bytes.readUInt16BE(offset + 3),
      )
    }
    offset += length
  }

  return null
}

function webpDimensions(bytes) {
  if (bytes.length < 30) return null
  const chunk = bytes.toString("ascii", 12, 16)

  if (chunk === "VP8X") {
    const width = 1 + bytes.readUIntLE(24, 3)
    const height = 1 + bytes.readUIntLE(27, 3)
    return dimensions(width, height)
  }

  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    const width = 1 + (bits & 0x3fff)
    const height = 1 + ((bits >>> 14) & 0x3fff)
    return dimensions(width, height)
  }

  if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return dimensions(
      bytes.readUInt16LE(26) & 0x3fff,
      bytes.readUInt16LE(28) & 0x3fff,
    )
  }

  return null
}

export function detectImageDimensions(value, mimeType) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || [])

  try {
    if (mimeType === "image/png" && bytes.length >= 24) {
      return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
    }
    if (mimeType === "image/gif" && bytes.length >= 10) {
      return dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8))
    }
    if (mimeType === "image/jpeg") return jpegDimensions(bytes)
    if (mimeType === "image/webp") return webpDimensions(bytes)
  } catch {
    return null
  }

  return null
}

/**
 * QQ Markdown 对超长图的展示不稳定，视觉模型处理这类图片也很容易超时。
 * 无法解析尺寸时保留图片，避免误伤兼容接口支持的其他有效编码。
 */
export function isGuideImageUsable(
  image,
  limits = GUIDE_IMAGE_LIMITS,
) {
  if (image?.width == null || image?.height == null) return true
  const width = Number(image?.width)
  const height = Number(image?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true
  if (width <= 0 || height <= 0) return false

  const longest = Math.max(width, height)
  const shortest = Math.min(width, height)
  return (
    longest <= limits.maxDimension &&
    width * height <= limits.maxPixels &&
    longest / shortest <= limits.maxAspectRatio
  )
}

export function selectUsableGuideImages(images, maximum = 2) {
  const limit = Math.max(0, Math.floor(Number(maximum) || 0))
  if (!limit) return []
  return (images || [])
    .filter(image => isGuideImageUsable(image))
    .slice(0, limit)
}

function imageCost(image) {
  const width = Number(image?.width)
  const height = Number(image?.height)
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return width * height
  }
  return Number.MAX_SAFE_INTEGER / 2 + (Number(image?.byteLength) || 0)
}

export function selectGuideImagesForVision(images, maximum = 2) {
  const limit = Math.max(0, Math.floor(Number(maximum) || 0))
  if (!limit) return []

  const usable = selectUsableGuideImages(images, limit)
  if (usable.length) return usable

  // 没有适合直接发给 QQ 的图片时，仍让模型尝试成本最低的一张；
  // 回退消息不会发送这张超长图。
  return (images || [])
    .map((image, index) => ({ image, index }))
    .sort(
      (left, right) =>
        imageCost(left.image) - imageCost(right.image) ||
        left.index - right.index,
    )
    .slice(0, 1)
    .map(item => item.image)
}

export { imageCost, jpegDimensions, webpDimensions }
