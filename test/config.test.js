import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { ConfigManager, redactUrl } from "../src/config/ConfigManager.js"
import {
  GUIDE_AUTO_EXECUTE_IDS,
  LEGACY_DEFAULT_AUTO_EXECUTE_ALLOWLIST,
} from "../src/config/defaults.js"

const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

test("ConfigManager creates, merges, normalizes, and validates configuration", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-enhance-config-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const configPath = path.join(directory, "config", "aiEnhance.yaml")
  const manager = new ConfigManager({
    cwd: directory,
    pluginRoot,
    configPath,
    env: { TEST_AI_KEY: "from-env" },
    logger: { info() {} },
  })

  const initial = await manager.load()
  assert.equal(initial.api.model, "")
  assert.ok((await fs.stat(configPath)).isFile())

  const source = YAML.parse(await fs.readFile(configPath, "utf8"))
  source.api.model = "model"
  source.api.apiKeyEnv = "TEST_AI_KEY"
  source.api.timeoutMs = 1
  source.api.extraHeaders = { "x-provider": "value" }
  source.vision.maxImages = 99
  source.vision.maxBytesPerImage = 1
  source.vision.timeoutMs = 100
  source.vision.detail = "unsupported"
  source.routing.autoExecuteConfidence = 2
  source.unknown = "ignored"
  await fs.writeFile(configPath, YAML.stringify(source), "utf8")

  const loaded = await manager.load({ force: true })
  assert.equal(loaded.api.timeoutMs, 1_000)
  assert.equal(loaded.vision.maxImages, 10)
  assert.equal(loaded.vision.maxBytesPerImage, 65_536)
  assert.equal(loaded.vision.timeoutMs, 1_000)
  assert.equal(loaded.vision.detail, "auto")
  assert.equal(loaded.routing.autoExecuteConfidence, 1)
  assert.equal(loaded.api.extraHeaders["x-provider"], "value")
  assert.equal("unknown" in loaded, false)
  assert.equal(manager.resolveApiKey(loaded), "from-env")
  assert.deepEqual(manager.validate(loaded), [])
})

test("ConfigManager rejects non-loopback insecure HTTP by default", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-enhance-config-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const configPath = path.join(directory, "aiEnhance.yaml")
  await fs.writeFile(
    configPath,
    YAML.stringify({
      api: {
        baseUrl: "http://example.com/v1",
        model: "model",
        apiKey: "secret",
      },
    }),
    "utf8",
  )
  const manager = new ConfigManager({
    cwd: directory,
    pluginRoot,
    configPath,
    logger: { info() {} },
  })
  const config = await manager.load()
  assert.match(manager.validate(config).join(" "), /allowInsecureHttp/)
})

test("ConfigManager only migrates an unchanged legacy default allowlist", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-enhance-config-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const configPath = path.join(directory, "aiEnhance.yaml")
  await fs.writeFile(
    configPath,
    YAML.stringify({
      commands: {
        autoExecuteAllowlist: LEGACY_DEFAULT_AUTO_EXECUTE_ALLOWLIST,
      },
    }),
    "utf8",
  )
  const messages = []
  const manager = new ConfigManager({
    cwd: directory,
    pluginRoot,
    configPath,
    logger: { info(message) { messages.push(message) } },
  })

  const migrated = await manager.load()
  for (const id of GUIDE_AUTO_EXECUTE_IDS) {
    assert.equal(migrated.commands.autoExecuteAllowlist.includes(id), true)
  }
  assert.match(messages.join(" "), /旧版默认自动执行白名单/)

  const customized = YAML.parse(await fs.readFile(configPath, "utf8"))
  customized.commands.autoExecuteAllowlist =
    LEGACY_DEFAULT_AUTO_EXECUTE_ALLOWLIST.slice(1)
  await fs.writeFile(configPath, YAML.stringify(customized), "utf8")
  const narrowed = await manager.load({ force: true })
  for (const id of GUIDE_AUTO_EXECUTE_IDS) {
    assert.equal(narrowed.commands.autoExecuteAllowlist.includes(id), false)
  }
})

test("public status URL redacts credentials and query parameters", () => {
  assert.equal(
    redactUrl("https://user:password@example.com/v1?api_key=secret"),
    "https://%5Bredacted%5D:%5Bredacted%5D@example.com/v1?[redacted]",
  )
  assert.equal(redactUrl("/chat/completions?key=secret"), "/chat/completions?[redacted]")
})
