# OpenClaw Auditor Contract

Contract version: `1.0.0`

## Guarantee

When a human selects **Request Audit**, Tripp.Scenes creates a durable audit request for an immutable snapshot of the current project revision. The request remains queued until OpenClaw claims it. Closing the browser or restarting the app does not remove it.

OpenClaw can receive work in either of two ways:

1. Poll `GET /api/agent/audits/inbox` using its agent token.
2. Receive a localhost webhook configured through `OPENCLAW_WEBHOOK_URL`, then fetch the request from the inbox.

The webhook is a wake-up notification, not the source of truth. If delivery fails, the request stays in the polling inbox.

## Lifecycle

```text
queued → claimed → completed
                 ↘ stale
```

- `queued`: persisted and available to OpenClaw.
- `claimed`: leased to OpenClaw for ten minutes.
- `completed`: schema-valid result returned for the same project revision.
- `stale`: OpenClaw completed the audit, but the project changed after the request was created.

An expired claim returns to the inbox automatically. Duplicate requests for the same project snapshot and scope are deduplicated while queued or claimed.

## Request envelope

Every request contains:

- Contract version
- Project ID and revision
- SHA-256 snapshot hash
- Requested scope
- Human focus note
- Required checks
- Deterministic hard lines
- Immutable project snapshot

The snapshot contains the script, scenes, shots, output settings, policies, publishing metadata, and collaboration mode relevant to the audit.

## OpenClaw flow

### 1. Fetch inbox

```http
GET /api/agent/audits/inbox
Authorization: Bearer TRIPP_OPENCLAW_TOKEN
```

### 2. Claim work

```http
POST /api/agent/audits/:requestId/claim
Authorization: Bearer TRIPP_OPENCLAW_TOKEN
```

### 3. Complete work

```http
POST /api/agent/audits/:requestId/complete
Authorization: Bearer TRIPP_OPENCLAW_TOKEN
Content-Type: application/json
```

```json
{
  "decision": "warn",
  "summary": "Two factual claims need primary sources before publication.",
  "findings": [
    {
      "severity": "warn",
      "code": "UNSOURCED_RELEASE_CLAIM",
      "message": "The release-date claim has no primary source attached.",
      "targetType": "block",
      "targetId": "3",
      "suggestedFix": "Attach the official announcement or rewrite as an opinion."
    }
  ],
  "checkedHardLines": [
    "NO_UNAPPROVED_PUBLISH",
    "NO_UNAPPROVED_SPEND",
    "FACTS_REQUIRE_PRIMARY_SOURCES",
    "NO_SECRET_EXPOSURE",
    "NO_SILENT_APPROVED_OVERWRITE",
    "SYNTHETIC_MEDIA_DISCLOSURE"
  ],
  "evidence": []
}
```

Tripp.Scenes rejects malformed decisions. A `pass` result cannot contain blocking findings.

## Default hard lines

- No public publishing without explicit human approval.
- No billable generation without explicit human approval.
- Material factual or benchmark claims require primary sources.
- Secrets and private data cannot enter content, prompts, exports, or logs.
- Approved work cannot be silently overwritten.
- Synthetic-media disclosure must remain in publishing packages.

The user's real OpenClaw rules should be added to `DEFAULT_HARD_LINES` or the project's policy. Prompt-only instructions are not considered sufficient for non-negotiable behavior.

## Important limitation

Tripp.Scenes can guarantee durable dispatch and visible status. It cannot guarantee that an external OpenClaw process is alive. To make audit requests wake the process immediately, configure a local OpenClaw webhook. Without a webhook, OpenClaw must poll the inbox on a schedule.

