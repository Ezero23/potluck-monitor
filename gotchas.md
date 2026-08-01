# Project gotchas

- Never size the expanded view-switcher menu from the compact footer button; verify the opened menu at the real narrow widget width with Chinese labels and drag handles visible.
- Potluck Monitor must treat `21023` as Potluck's canonical default port. Do not auto-discover or preserve the retired `20129`/`20131` defaults during settings migration.
- A live `cloudflared` process is not proof that the fixed tunnel URL works. Verify both the direct Quick Tunnel URL and the `abc-tunnel.us` public URL, and do not report healthy status from stale synced metadata.
