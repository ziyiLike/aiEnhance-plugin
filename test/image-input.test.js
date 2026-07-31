import test from "node:test"
import assert from "node:assert/strict"
import {
  ImageInput,
  extractImageSources,
  validateRemoteUrl,
} from "../src/media/ImageInput.js"

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

test("QQ image segments are extracted without parsing raw_message URLs", () => {
  const event = {
    raw_message:
      "图中有什么<image,url=https://example.com/raw-should-not-be-used.png>",
    message: [
      { type: "text", text: "图中有什么" },
      {
        type: "image",
        url: "https://multimedia.nt.qq.com.cn/download?rkey=secret",
        size: 37_690,
      },
      {
        type: "image",
        url: "https://multimedia.nt.qq.com.cn/download?rkey=secret",
        size: 37_690,
      },
    ],
  }

  assert.deepEqual(extractImageSources(event), [
    {
      source: "https://multimedia.nt.qq.com.cn/download?rkey=secret",
      size: 37_690,
    },
  ])
})

test("remote images are downloaded and converted to bounded data URLs", async () => {
  let capturedUrl
  let capturedOptions
  const imageInput = new ImageInput({
    async fetchImpl(url, options) {
      capturedUrl = url
      capturedOptions = options
      return new Response(PNG_SIGNATURE, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(PNG_SIGNATURE.length),
        },
      })
    },
    logger: { warn() {} },
  })

  const result = await imageInput.prepare(
    {
      message: [
        {
          type: "image",
          url: "https://multimedia.nt.qq.com.cn/download?rkey=secret",
        },
      ],
    },
    {
      enabled: true,
      maxImages: 3,
      maxBytesPerImage: 1024,
      timeoutMs: 1000,
      allowInsecureHttp: false,
    },
  )

  assert.equal(capturedUrl.hostname, "multimedia.nt.qq.com.cn")
  assert.equal(capturedOptions.redirect, "manual")
  assert.equal(result.images.length, 1)
  assert.equal(
    result.images[0].dataUrl,
    `data:image/png;base64,${PNG_SIGNATURE.toString("base64")}`,
  )
  assert.equal(result.images[0].byteLength, PNG_SIGNATURE.length)
})

test("declared oversized images are rejected before any network request", async () => {
  let requests = 0
  const imageInput = new ImageInput({
    async fetchImpl() {
      requests++
      throw new Error("should not fetch")
    },
    logger: { warn() {} },
  })

  const result = await imageInput.prepare(
    {
      message: [
        {
          type: "image",
          url: "https://example.com/large.png",
          size: 2048,
        },
      ],
    },
    {
      enabled: true,
      maxImages: 3,
      maxBytesPerImage: 1024,
      timeoutMs: 1000,
      allowInsecureHttp: false,
    },
  )

  assert.equal(requests, 0)
  assert.deepEqual(result.images, [])
  assert.deepEqual(result.failures, [{ code: "image_too_large" }])
})

test("inline base64 images are accepted without a network request", async () => {
  const imageInput = new ImageInput({
    async fetchImpl() {
      throw new Error("should not fetch")
    },
    logger: { warn() {} },
  })
  const dataUrl = `data:image/png;base64,${PNG_SIGNATURE.toString("base64")}`

  const result = await imageInput.prepare(
    { message: [{ type: "image", file: dataUrl }] },
    {
      enabled: true,
      maxImages: 1,
      maxBytesPerImage: 1024,
      timeoutMs: 1000,
      allowInsecureHttp: false,
    },
  )

  assert.equal(result.images[0].dataUrl, dataUrl)
})

test("local and insecure remote addresses are rejected by default", () => {
  assert.throws(
    () =>
      validateRemoteUrl("https://[::1]/private.png", {
        allowInsecureHttp: false,
      }),
    /私有网络/,
  )
  assert.throws(
    () =>
      validateRemoteUrl("https://user:password@example.com/image.png", {
        allowInsecureHttp: false,
      }),
    /登录凭据/,
  )
  assert.throws(
    () =>
      validateRemoteUrl("https://127.0.0.1/private.png", {
        allowInsecureHttp: false,
      }),
    /私有网络/,
  )
  assert.throws(
    () =>
      validateRemoteUrl("http://example.com/image.png", {
        allowInsecureHttp: false,
      }),
    /协议不受支持/,
  )
})
