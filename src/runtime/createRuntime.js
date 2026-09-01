import { ConfigManager } from "../config/ConfigManager.js"
import { OpenAICompatibleClient } from "../api/OpenAICompatibleClient.js"
import { IntentRouter } from "../routing/IntentRouter.js"
import { CommandCatalog } from "../catalog/CommandCatalog.js"
import { SecretDetector } from "../security/SecretDetector.js"
import { PolicyEngine } from "../security/PolicyEngine.js"
import { MemoryStore } from "./MemoryStore.js"
import { RequestGate } from "./RequestGate.js"
import { SafeDispatcher } from "./SafeDispatcher.js"
import { AiEnhanceService } from "./AiEnhanceService.js"
import { ImageInput } from "../media/ImageInput.js"
import { GuideImageInput } from "../media/GuideImageInput.js"
import { KnowledgeAnswerer } from "../knowledge/KnowledgeAnswerer.js"
import { WebSearchService } from "../search/WebSearchService.js"
import { CharacterKnowledgeService } from "./CharacterKnowledgeService.js"
import { createLogger } from "../utils/logger.js"

export function createRuntime({
  pluginRoot,
  cwd = process.cwd(),
  pluginLoader,
  redis = globalThis.redis,
  segment = globalThis.segment,
  Bot = globalThis.Bot,
  baseLogger = globalThis.logger,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  if (!pluginRoot) throw new TypeError("createRuntime 缺少 pluginRoot")

  const logger = createLogger({ logger: baseLogger, Bot })
  const configManager = new ConfigManager({
    cwd,
    pluginRoot,
    env,
    logger,
  })
  const catalog = new CommandCatalog({ logger, cwd })
  const client = new OpenAICompatibleClient({ fetchImpl, logger })
  const imageInput = new ImageInput({ fetchImpl, logger })
  const guideImageInput = new GuideImageInput({ root: cwd, fetchImpl, logger })
  const router = new IntentRouter({ client, logger })
  const policy = new PolicyEngine()
  const secretDetector = new SecretDetector()
  const memory = new MemoryStore({ redis, logger })
  const gate = new RequestGate()
  const dispatcher = new SafeDispatcher({ pluginLoader, logger })
  const answerer = new KnowledgeAnswerer({ client, logger })
  const webSearch = new WebSearchService({
    fetchImpl,
    logger,
  })
  const knowledgeService = new CharacterKnowledgeService({
    catalog,
    dispatcher,
    guideImageInput,
    answerer,
    webSearch,
    configManager,
    pluginLoader,
    segment,
    logger,
  })
  const service = new AiEnhanceService({
    configManager,
    catalog,
    router,
    policy,
    secretDetector,
    memory,
    gate,
    dispatcher,
    imageInput,
    knowledgeService,
    pluginLoader,
    segment,
    logger,
  })

  return {
    service,
    configManager,
    catalog,
    logger,
    async reload() {
      configManager.invalidate()
      const config = await configManager.load({ force: true })
      await catalog.prepare({ force: true })
      catalog.configure(config.commands)
      return config
    },
    async status() {
      const config = await configManager.load()
      catalog.configure(config.commands)
      return {
        ...configManager.publicStatus(config),
        candidateCount: catalog.size,
        autoExecuteEnabled: config.routing.autoExecuteEnabled,
        autoExecuteConfidence: config.routing.autoExecuteConfidence,
        confirmConfidence: config.routing.confirmConfidence,
        memoryTtlSeconds: config.memory.ttlSeconds,
        memoryTurns: config.memory.maxTurns,
        knowledgeEnabled: config.knowledge.enabled,
        knowledgeGuideVisionEnabled: config.knowledge.guideVisionEnabled,
        webSearchEnabled: config.knowledge.webSearch.enabled,
      }
    },
  }
}
