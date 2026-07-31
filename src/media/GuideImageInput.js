import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  ImageInputError,
  checkedImage,
  prepareSource,
  toDataUrl,
} from "./ImageInput.js"
import { detectImageDimensions } from "./ImageDimensions.js"

const CONTAINER_KEYS = new Set([
  "content",
  "data",
  "elements",
  "items",
  "message",
  "messages",
  "nodes",
])
const MAX_WALK_DEPTH = 10
const MAX_WALK_NODES = 1_000

function sourceFromImageSegment(segment) {
  if (!segment || String(segment.type || "").toLowerCase() !== "image") return ""
  const values = [
    segment.url,
    segment.file,
    segment.data?.url,
    segment.data?.file,
  ]
  return values.find(value => typeof value === "string" && value.trim())?.trim() || ""
}

/**
 * 捕获到的回复可能是普通消息段、消息数组，也可能是 Bot.makeForwardMsg
 * 生成的多层 node。这里只沿消息容器字段递归，避免遍历适配器对象的其他状态。
 */
export function extractGuideImageSources(value) {
  const sources = []
  const sourceSet = new Set()
  const visited = new Set()
  let walked = 0

  const visit = (item, depth) => {
    if (depth > MAX_WALK_DEPTH || walked >= MAX_WALK_NODES || item == null) return
    walked++

    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1)
      return
    }
    if (typeof item !== "object") return
    if (visited.has(item)) return
    visited.add(item)

    const source = sourceFromImageSegment(item)
    if (source && !sourceSet.has(source)) {
      sourceSet.add(source)
      sources.push({ source, size: null })
      return
    }

    for (const [key, child] of Object.entries(item)) {
      if (CONTAINER_KEYS.has(key)) visit(child, depth + 1)
    }
  }

  visit(value, 0)
  return sources
}

function isRemoteOrInline(source) {
  return /^(?:https?:|data:|base64:\/\/)/i.test(source)
}

function pathIsWithin(root, target) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function resolveLocalPath(source, root) {
  let target
  try {
    if (/^file:\/\/\.\.?\//i.test(source)) {
      // Yunzai-genshin 与 StarRail-plugin 会生成 file://./temp/...。
      // 这不是标准 file URL，但语义明确为相对 Yunzai 工作目录。
      target = path.resolve(
        root,
        decodeURIComponent(source.slice("file://".length)),
      )
    } else {
      target = source.startsWith("file:")
        ? fileURLToPath(new URL(source))
        : path.resolve(root, source)
    }
  } catch {
    throw new ImageInputError("invalid_local_path", "攻略图片路径无效")
  }

  let realRoot
  let realTarget
  try {
    ;[realRoot, realTarget] = await Promise.all([
      fs.realpath(root),
      fs.realpath(target),
    ])
  } catch {
    throw new ImageInputError("local_image_unavailable", "攻略图片文件不存在")
  }

  if (!pathIsWithin(realRoot, realTarget)) {
    throw new ImageInputError(
      "unsafe_local_path",
      "攻略图片不在 Yunzai 工作目录内",
    )
  }
  return realTarget
}

async function readLocalImage(source, config) {
  const target = await resolveLocalPath(source, config.root)
  const stat = await fs.stat(target)
  if (!stat.isFile()) {
    throw new ImageInputError("local_image_unavailable", "攻略图片不是普通文件")
  }
  if (stat.size > config.maxBytesPerImage) {
    throw new ImageInputError("image_too_large", "攻略图片超过大小限制")
  }
  return checkedImage(await fs.readFile(target), config.maxBytesPerImage)
}

async function prepareGuideSource(fetchImpl, item, config) {
  if (isRemoteOrInline(item.source)) {
    return prepareSource(fetchImpl, item, config)
  }
  return readLocalImage(item.source, config)
}

export class GuideImageInput {
  constructor({
    root = process.cwd(),
    fetchImpl = globalThis.fetch,
    logger = console,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("当前 Node.js 环境没有可用的 fetch")
    }
    this.root = path.resolve(root)
    this.fetch = fetchImpl
    this.logger = logger
  }

  async prepare(capturedReplies, config) {
    const sources = extractGuideImageSources(capturedReplies)
    if (!sources.length) {
      return { hadImages: false, images: [], failures: [], sourceCount: 0 }
    }

    const effectiveConfig = {
      root: this.root,
      maxBytesPerImage: config.maxBytesPerImage,
      timeoutMs: config.timeoutMs,
      allowInsecureHttp: Boolean(config.allowInsecureHttp),
    }
    const images = []
    const failures = []
    const limitedSources = sources.slice(0, config.maxImages)

    const results = await Promise.all(
      limitedSources.map(async item => {
        try {
          const image = await prepareGuideSource(
            this.fetch,
            item,
            effectiveConfig,
          )
          return { image }
        } catch (error) {
          return {
            code:
              error?.name === "AbortError"
                ? "download_timeout"
                : error instanceof ImageInputError
                  ? error.code
                  : "guide_image_unavailable",
          }
        }
      }),
    )

    for (const result of results) {
      if (result.image) {
        const { bytes, mimeType } = result.image
        const size = detectImageDimensions(bytes, mimeType)
        images.push({
          dataUrl: toDataUrl(result.image),
          mimeType,
          byteLength: bytes.length,
          width: size?.width ?? null,
          height: size?.height ?? null,
          hash: crypto
            .createHash("sha256")
            .update(bytes)
            .digest("hex")
            .slice(0, 16),
        })
      } else {
        failures.push({ code: result.code })
        this.logger.warn?.(
          `[aiEnhance-plugin] 攻略图片读取失败 code=${result.code}`,
        )
      }
    }

    if (sources.length > limitedSources.length) {
      failures.push({
        code: "too_many_guide_images",
        count: sources.length - limitedSources.length,
      })
    }

    return {
      hadImages: true,
      images,
      failures,
      sourceCount: sources.length,
    }
  }
}

export {
  MAX_WALK_DEPTH,
  MAX_WALK_NODES,
  pathIsWithin,
  readLocalImage,
  resolveLocalPath,
  sourceFromImageSegment,
}
