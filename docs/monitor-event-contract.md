# Potluck → Monitor Event Contract

Potluck Web owns credentials, quota probes, request execution and routing decisions. Potluck Monitor consumes sanitized snapshots and events for display and diagnosis. Monitor does not receive upstream secrets and does not execute routing.

The existing `/api/ingest` device payload may contain a top-level `monitor` envelope with `schemaVersion: 1`, `generatedAt`, `health`, `events` and `capabilities`. Unknown fields are ignored. Event IDs make retries idempotent, and Monitor keeps a bounded history.

The first event types are `quota_attempt`, `health_event` and `routing_attempt`. Safe fields include `requestId`, `attemptId`, opaque `connectionKey`, `provider`, `model`, selected provider/model, `reasonCode`, timestamps, latency, HTTP status and fallback count.

The envelope MUST NOT contain API keys, OAuth tokens, cookies, authorization headers, provider raw responses, prompt text, model responses, proxy URLs, passwords or raw exception stacks. Human-readable reasons are normalized and truncated; URLs and secret-like values are discarded.

Potluck keeps unsent events until a successful ingest response acknowledges their IDs. Monitor normalizes the envelope, rejects unsafe fields, deduplicates event IDs and retains the newest bounded history.
