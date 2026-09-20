# Logging (R28)

One helper, `src/lib/observability/report.ts`, for everything that is logged or reported.

## Rules
1. **No private content in logs or in Sentry.** Never log a message, subject, sender, address, query text, model input or an error's message (it can hold any of those). Log the event name and small plain fields: a provider, an operation, a status, a version, a count.
2. `logEvent(level, event, fields)` writes `event {"field":value}` and is used for ordinary structured lines (`provider_call`, `model_call`, `router`, `google_token_renewed`).
3. `reportFailure(event, error, fields, { level, userId })` is for a failure the code **handles itself** (a fallback, a skipped step, a service being unavailable). It always logs, and it sends one scrubbed event to Sentry: grouped by event and error type, message replaced, at most once a minute per group. It never throws. **A catch block that swallows an error must call it.** A bare `catch {}` is only for a cache that is optional.
4. Unhandled errors are captured by Sentry itself (`onRequestError`, the error boundaries). Do not report those twice.
5. Model calls made outside a chat request (Perch, background checks) pass `{ userId }` to `callClaude`, so they count against that user's daily token budget, are saved to `model_usage_events`, and log a real cost.

## Events
| Event | Level | Means | Fields |
| --- | --- | --- | --- |
| `provider_call` | info | One call to Google, Tavily or Maps | provider, attempt, status, durationMs, outcome |
| `provider_call_failed` | warn, Sentry | A provider call used up its attempts | provider, errorName, status |
| `provider_circuit_opened` | warn, Sentry | Three failures in a row: calls to that provider are refused for 30 s | provider |
| `model_call` | info / warn | One Anthropic call (tokens, cost) or a failed attempt | operation, model, inputTokens, outputTokens, actualCostUsd, durationMs |
| `model_call_failed` | warn, Sentry | A model call used up its attempts | operation, model, errorName, status |
| `model_budget_reservation_failed`, `model_usage_persist_failed`, `query_telemetry_persist_failed` | warn, Sentry | Usage or telemetry could not be saved | requestId, code |
| `router`, `orchestrator_budget`, `query_complete` | info | One chat request's routing, budget and outcome | requestId, operation, confidence |
| `router_unavailable`, `email_interpreter_unavailable`, `time_interpreter_unavailable`, `reply_judge_unavailable` | warn, Sentry | A model reading was not available; Daylark said so and did nothing | version, errorName |
| `waiting_replies_failed`, `waiting_replies_partial` | warn, Sentry | The reply card could not check mail, or skipped some messages | failed, checkedNew, errorName, status |
| `google_token_renewed` | info | Google rejected an access token and a new one was fetched | capability, cause |
| `google_token_renew_failed`, `google_credential_store_failed` | warn / error, Sentry | The saved Google connection could not be renewed or stored | capability |
| `receipt_preview_failed`, `home_list_conversations_failed` | error, Sentry | A page or route step failed | |
| `home_no_user_claims` | error | A signed-in page had no user id | hasClaims, claimKeys |
| `page_render_failed` | error, Sentry | A page failed to render (digest only) | |
| `chat_request_failed` | error, Sentry | A chat request failed (reported by the chat route itself) | requestId |

Monitoring (alerts, SLO checks on a schedule, a deeper health check) is the next piece of work and is not part of this.
