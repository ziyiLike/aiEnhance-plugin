import test from "node:test"
import assert from "node:assert/strict"
import {
  canResolveQuotedMessage,
  resolveQuotedMessage,
} from "../src/runtime/QuotedMessage.js"

test("QQ embedded quote resolves document-style content without getMsg", async () => {
  const event = {
    raw: {
      // qq-group-bot 会把 API 的数值 message_type 覆盖成 group，引用信号以 ext 为准。
      message_type: "group",
      message_scene: {
        ext: [
          "msg_idx=REFIDX_current==",
          "auth_token=must-not-be-used",
          "ref_msg_idx=TMP_quoted==",
        ],
      },
      // 官方示例中的元素没有 msg_idx，此时应使用引用事件携带的全部元素。
      msg_elements: [{ content: "重启成功，用时5秒891" }],
    },
  }

  assert.equal(canResolveQuotedMessage(event), true)
  assert.deepEqual(await resolveQuotedMessage(event), {
    message_id: "TMP_quoted==",
    message: [{ type: "text", text: "重启成功，用时5秒891" }],
  })
})

test("ordinary msg_elements are not mistaken for a quoted message", async () => {
  const event = {
    raw: {
      message_type: "group",
      message_scene: { ext: ["msg_idx=REFIDX_current=="] },
      msg_elements: [{ content: "普通并行消息" }],
    },
  }

  assert.equal(canResolveQuotedMessage(event), false)
  assert.equal(await resolveQuotedMessage(event), null)
})
