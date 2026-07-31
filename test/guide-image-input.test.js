import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  GuideImageInput,
  extractGuideImageSources,
} from "../src/media/GuideImageInput.js"
import {
  detectImageDimensions,
  isGuideImageUsable,
  selectGuideImagesForVision,
  selectUsableGuideImages,
} from "../src/media/ImageDimensions.js"

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

function jpegWithSize(width, height) {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ])
}

function config() {
  return {
    maxImages: 2,
    maxBytesPerImage: 1024,
    timeoutMs: 1_000,
    allowInsecureHttp: false,
  }
}

test("guide images are extracted from nested forwarded-message nodes", () => {
  const message = {
    type: "node",
    data: [
      { message: "来自攻略作者" },
      {
        message: [
          {
            type: "image",
            file: "file:///yunzai/plugins/guide.jpg",
          },
        ],
      },
    ],
  }

  assert.deepEqual(extractGuideImageSources(message), [
    {
      source: "file:///yunzai/plugins/guide.jpg",
      size: null,
    },
  ])
})

test("local guide images inside the Yunzai root become bounded data URLs", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-guide-root-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const imagePath = path.join(root, "temp", "strategy", "nahida.png")
  await fs.mkdir(path.dirname(imagePath), { recursive: true })
  await fs.writeFile(imagePath, PNG_SIGNATURE)

  const input = new GuideImageInput({
    root,
    fetchImpl: async () => {
      throw new Error("local guide must not use the network")
    },
    logger: { warn() {} },
  })
  const result = await input.prepare(
    [
      {
        message: [
          {
            type: "image",
            file: pathToFileURL(imagePath).href,
          },
        ],
      },
    ],
    config(),
  )

  assert.equal(result.images.length, 1)
  assert.equal(
    result.images[0].dataUrl,
    `data:image/png;base64,${PNG_SIGNATURE.toString("base64")}`,
  )
  assert.equal(result.images[0].byteLength, PNG_SIGNATURE.length)
  assert.match(result.images[0].hash, /^[a-f0-9]{16}$/)
})

test("upstream file://./ relative guide URLs resolve inside Yunzai", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-guide-root-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const imagePath = path.join(root, "temp", "strategy", "1", "纳西妲.jpg")
  await fs.mkdir(path.dirname(imagePath), { recursive: true })
  await fs.writeFile(imagePath, PNG_SIGNATURE)

  const input = new GuideImageInput({
    root,
    fetchImpl: async () => {
      throw new Error("local guide must not use the network")
    },
    logger: { warn() {} },
  })
  const result = await input.prepare(
    [
      {
        message: {
          type: "image",
          file: "file://./temp/strategy/1/%E7%BA%B3%E8%A5%BF%E5%A6%B2.jpg",
        },
      },
    ],
    config(),
  )

  assert.equal(result.images.length, 1)
  assert.equal(result.failures.length, 0)
})

test("captured plugins cannot make guide vision read files outside Yunzai", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-guide-root-"))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ai-guide-outside-"))
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  })
  const imagePath = path.join(outside, "outside.png")
  await fs.writeFile(imagePath, PNG_SIGNATURE)

  const input = new GuideImageInput({
    root,
    fetchImpl: async () => {
      throw new Error("should not fetch")
    },
    logger: { warn() {} },
  })
  const result = await input.prepare(
    [{ message: { type: "image", file: imagePath } }],
    config(),
  )

  assert.deepEqual(result.images, [])
  assert.deepEqual(result.failures, [{ code: "unsafe_local_path" }])
})

test("oversized long guides are skipped in favor of a display-safe image", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-guide-root-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const longPath = path.join(root, "plugins", "waves", "long.jpg")
  const safePath = path.join(root, "plugins", "waves", "safe.jpg")
  await fs.mkdir(path.dirname(longPath), { recursive: true })
  await fs.writeFile(longPath, jpegWithSize(2_250, 18_467))
  await fs.writeFile(safePath, jpegWithSize(1_080, 2_470))

  const input = new GuideImageInput({
    root,
    fetchImpl: async () => {
      throw new Error("local guide must not use the network")
    },
    logger: { warn() {} },
  })
  const result = await input.prepare(
    [
      {
        message: [
          { type: "image", file: pathToFileURL(longPath).href },
          { type: "image", file: pathToFileURL(safePath).href },
        ],
      },
    ],
    config(),
  )

  assert.deepEqual(detectImageDimensions(jpegWithSize(640, 480), "image/jpeg"), {
    width: 640,
    height: 480,
  })
  assert.equal(result.images[0].width, 2_250)
  assert.equal(result.images[0].height, 18_467)
  assert.equal(isGuideImageUsable(result.images[0]), false)
  assert.deepEqual(selectUsableGuideImages(result.images, 2), [result.images[1]])
  assert.deepEqual(selectGuideImagesForVision(result.images, 2), [result.images[1]])
  assert.deepEqual(selectGuideImagesForVision([result.images[0]], 2), [
    result.images[0],
  ])
})
