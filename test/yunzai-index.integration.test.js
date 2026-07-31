import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

async function writeYunzaiStubs(fixtureRoot) {
  const libDirectory = path.join(fixtureRoot, "lib", "plugins")
  await fs.mkdir(libDirectory, { recursive: true })
  await fs.writeFile(
    path.join(libDirectory, "plugin.js"),
    `export default class plugin {
      constructor(config) { Object.assign(this, config) }
      reply(message) { return message }
    }\n`,
    "utf8",
  )
  await fs.writeFile(
    path.join(libDirectory, "loader.js"),
    "export default { priority: [], async deal() {} }\n",
    "utf8",
  )
}

test("plugin index imports from a real Yunzai plugins/<name> directory layout", async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-enhance-yunzai-"))
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }))
  await writeYunzaiStubs(fixtureRoot)

  const pluginDirectory = path.join(
    fixtureRoot,
    "plugins",
    "aiEnhance-plugin",
  )
  await fs.cp(projectRoot, pluginDirectory, {
    recursive: true,
    filter(source) {
      const relative = path.relative(projectRoot, source)
      if (!relative) return true
      const first = relative.split(path.sep)[0]
      return ![".git", "node_modules", "test", "coverage"].includes(first)
    },
  })

  const fixtureNodeModules = path.join(fixtureRoot, "node_modules")
  await fs.mkdir(fixtureNodeModules, { recursive: true })
  const yamlTarget = await fs.realpath(path.join(projectRoot, "node_modules", "yaml"))
  await fs.symlink(yamlTarget, path.join(fixtureNodeModules, "yaml"), "dir")

  const module = await import(
    `${pathToFileURL(path.join(pluginDirectory, "index.js")).href}?fixture=${Date.now()}`
  )
  const control = new module.AiEnhanceControl()
  const entry = new module.AiEnhanceEntry()

  assert.equal(control.name, "aiEnhance-plugin 管理")
  assert.equal(control.priority, 10)
  assert.equal(control.rule.length, 4)
  assert.equal(entry.name, "aiEnhance-plugin 兜底")
  assert.equal(entry.priority, 999_999_999)
  assert.equal(entry.rule[0].reg, "^[\\s\\S]*$")
})
