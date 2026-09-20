type ContextMessage = { role: "user" | "assistant"; content: string };

export function resolveRetryMessage(requestedMessage: string, isRetry: boolean, context: ContextMessage[]) {
  if (!isRetry) return requestedMessage;
  return [...context].reverse().find((message) => message.role === "user")?.content ?? requestedMessage;
}
