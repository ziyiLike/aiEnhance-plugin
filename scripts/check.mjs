import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { DEFAULT_CONFIG } from "../src/config/defaults.js"
import { CommandCatalog, regexMatches } from "../src/catalog/CommandCatalog.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const excludedDirectories = new Set([".git", "node_modules", "coverage"])

function walk(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(absolute))
    else files.push(absolute)
  }
  return files
}

const failures = []
const javascriptFiles = walk(root).filter(file => file.endsWith(".js") || file.endsWith(".mjs"))
const packagePath = path.join(root, "package.json")
const readmePath = path.join(root, "README.md")

let packageJson
try {
  packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"))
} catch (error) {
  failures.push(`package.json 无法解析：${error.message}`)
}

if (packageJson?.name !== "aienhance-plugin") {
  failures.push("package.json 的 name 必须是 aienhance-plugin")
}
if (
  packageJson?.repository?.url !==
  "git+https://github.com/ziyiLike/aiEnhance-plugin.git"
) {
  failures.push("package.json 的 repository 未指向 ziyiLike/aiEnhance-plugin")
}

let readme = ""
try {
  readme = fs.readFileSync(readmePath, "utf8")
} catch (error) {
  failures.push(`README.md 无法读取：${error.message}`)
}
if (!readme.startsWith("# aiEnhance-plugin\n")) {
  failures.push("README.md 标题必须是 aiEnhance-plugin")
}
if (!readme.includes("plugins/aiEnhance-plugin")) {
  failures.push("README.md 缺少标准插件安装路径")
}

const legacyNames = [
  ["yunzai", "aiEnhance-plugin"].join("-"),
  ["yunzai", "ai-enhance-plugin"].join("-"),
]
for (const file of walk(root)) {
  if (!/\.(?:js|mjs|json|md|yaml|yml|txt)$/.test(file)) continue
  const content = fs.readFileSync(file, "utf8")
  for (const legacyName of legacyNames) {
    if (content.includes(legacyName)) {
      failures.push(
        `${path.relative(root, file)} 仍包含旧项目名：${legacyName}`,
      )
    }
  }
}

for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  })
  if (result.status !== 0) {
    failures.push(`${path.relative(root, file)}\n${result.stderr || result.stdout}`)
  }
}

const defaultYamlPath = path.join(root, "config", "default.yaml")
let yamlConfig
try {
  yamlConfig = YAML.parse(fs.readFileSync(defaultYamlPath, "utf8"))
} catch (error) {
  failures.push(`config/default.yaml 无法解析：${error.message}`)
}

if (yamlConfig?.api?.apiKey) {
  failures.push("config/default.yaml 不得包含 API Key")
}

if (yamlConfig && JSON.stringify(yamlConfig) !== JSON.stringify(DEFAULT_CONFIG)) {
  failures.push("config/default.yaml 与 src/config/defaults.js 不一致")
}

const catalog = new CommandCatalog()
catalog.configure(DEFAULT_CONFIG.commands)
const seenIds = new Set()

for (const candidate of catalog.candidates) {
  if (seenIds.has(candidate.id)) failures.push(`重复候选 ID：${candidate.id}`)
  seenIds.add(candidate.id)

  if (!candidate.description) failures.push(`${candidate.id} 缺少 description`)
  if (!candidate.runtimeAliases?.length) failures.push(`${candidate.id} 缺少 runtimeAliases`)

  for (const example of candidate.commandExamples) {
    if (!regexMatches(candidate.validateCommand, example)) {
      failures.push(`${candidate.id} 的示例命令未通过模板校验：${example}`)
    }
  }
}

for (const id of DEFAULT_CONFIG.commands.autoExecuteAllowlist) {
  const candidate = catalog.find(id)
  if (!candidate) {
    failures.push(`自动执行白名单引用了不存在的候选：${id}`)
  } else if (candidate.risk !== "read" || candidate.autoExecute !== true) {
    failures.push(`自动执行白名单包含非只读候选：${id}`)
  }
}

if (failures.length) {
  console.error(failures.join("\n\n"))
  process.exit(1)
}

console.log(
  `检查通过：${javascriptFiles.length} 个 JavaScript 文件，${catalog.size} 个内置命令候选。`,
)
