---
name: release-check
description: Pre-release checklist for a backend deploy or a TestFlight build. Use before tagging a release.
allowed-tools: Read, Bash, Grep, Glob
---

# Release check

Backend:
- [ ] `./scripts/verify.sh` green on `main`.
- [ ] Migrations reviewed by `db-migration-guard`; each is safe with the previous app version running.
- [ ] `security-auditor` run since the last release, findings closed.
- [ ] `api-contract-guard` verdict SAFE — no breaking change for shipped iOS versions.
- [ ] New env vars added to Vercel for **both** Preview and Production.
- [ ] Prompt changes have an eval entry in `docs/prompts/CHANGELOG.md`.
- [ ] Rate limits and the Claude spend alert still configured.

iOS:
- [ ] `ios-reviewer` verdict APPROVE.
- [ ] Build number bumped; release notes written.
- [ ] Tested against the Production API, not Preview.
- [ ] Verified against the **oldest supported** backend contract, and offline/airplane mode behaves.

Post-deploy:
- [ ] `/health` green; error rate and p95 latency watched for 30 minutes.
- [ ] One real receipt parsed end to end in production.
