# Project gotchas

- Never size the expanded view-switcher menu from the compact footer button; verify the opened menu at the real narrow widget width with Chinese labels and drag handles visible.
- Potluck Monitor must treat `21023` as Potluck's canonical default port. Do not auto-discover or preserve the retired `20129`/`20131` defaults during settings migration.
- A live `cloudflared` process is not proof that the fixed tunnel URL works. Verify both the direct Quick Tunnel URL and the `abc-tunnel.us` public URL, and do not report healthy status from stale synced metadata.
- Normalizing a legacy gateway port in memory is incomplete; verify `settings.json` is rewritten to `21023` after an installed-app restart.
- Release signing steps must branch on credential availability. Never pass empty signing secrets to electron-builder or claim unsigned artifacts are signed.
- The Monitor gateway card must use the same endpoint preference as Potluck Web: `publicUrl || tunnelUrl`. Never prefer the temporary `trycloudflare.com` URL over the displayed `abc-tunnel.us` endpoint.
- A production app icon must remain a simple, symbolic mark that reads at 32 px. Do not substitute a detailed food illustration or marketing image for an icon.
- A Potluck provider connection can exist while its latest health check is unauthorized or unavailable. Account presence, credential health, and quota availability are separate states; never turn a failed check into “not connected.”
- GLM Coding Plan usage endpoints expect the official raw `Authorization` token, while the OpenAI-compatible model endpoint uses Bearer auth. Do not reuse model-call authentication rules for quota polling.
- Provider identity on multi-account Home limit rows must never rest on a 16px mask icon alone; always prefix the provider name. An opt-in "show provider names" setting fails the users who never find it.
