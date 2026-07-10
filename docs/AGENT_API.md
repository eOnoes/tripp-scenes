# Tripp.Scenes Agent API

Tripp.Scenes exposes a localhost-only collaboration API for Hermes and OpenClaw. Each agent receives a separate bearer token and a fixed capability set.

## Initialize credentials

```powershell
npm run agents:init
npm start
```

The initializer adds three secrets to `.env` without printing them:

- `TRIPP_HERMES_WRITER_TOKEN`
- `TRIPP_HERMES_DIRECTOR_TOKEN`
- `TRIPP_OPENCLAW_TOKEN`

## Roles

### Hermes Writer

Reads projects and creates tasks, comments, and script/scene proposals.

### Hermes Director

Adds visual-direction proposals, reads assets, and requests generation approval. It cannot directly start billable work.

### OpenClaw Auditor

Creates audit records, findings, and blocking decisions. It cannot draft creative proposals or start generation.

## Authentication

```http
Authorization: Bearer AGENT_TOKEN
Content-Type: application/json
```

Verify identity:

```http
GET /api/agent/me
```

## Core routes

```text
GET    /api/agent/projects
GET    /api/agent/projects/:projectId
POST   /api/agent/projects/:projectId/tasks
PATCH  /api/agent/tasks/:taskId
POST   /api/agent/projects/:projectId/comments
POST   /api/agent/projects/:projectId/proposals
POST   /api/agent/projects/:projectId/audits
POST   /api/agent/projects/:projectId/generation-requests
```

## Script proposal

```json
{
  "type": "script_revision",
  "summary": "Replace the opening hook",
  "reason": "The current version takes too long to establish tension.",
  "payload": {
    "blocks": [
      {
        "id": 1,
        "char": "Nova",
        "text": "OpenAI just changed the AI race."
      }
    ]
  }
}
```

Supported proposal types:

- `script_revision`
- `scene_update`
- `shot_plan`
- `metadata_update`

Proposals never overwrite the live project until a human accepts them in Tripp.Scenes.

## OpenClaw audit

For durable human-requested audits, use the inbox/claim/complete contract documented in [`AUDITOR_CONTRACT.md`](AUDITOR_CONTRACT.md). Direct audit creation below is reserved for unsolicited or scheduled auditor observations.

```json
{
  "decision": "block",
  "summary": "Unverified factual claim",
  "findings": [
    "The script claims a benchmark result without a source."
  ],
  "hardLineIds": ["FACTS_REQUIRE_SOURCES"]
}
```

Decisions are `pass`, `warn`, or `block`. An OpenClaw prompt should contain the user's actual hard lines, but high-impact rules should also be added to `lib/policy.js` so they cannot be bypassed through prompting.

## Generation request

```json
{
  "type": "image",
  "provider": "fal",
  "model": "fal-ai/flux/dev",
  "takes": 2,
  "estimatedMaximumCost": 0.25,
  "sceneId": "scene-1",
  "shotId": "shot-1",
  "prompt": "Vertical cinematic technology editorial image"
}
```

This creates a pending human approval. It does not call the provider.

## Recommended agent loop

1. Read the project and collaboration state.
2. Claim or create a task.
3. Move the task to `working`.
4. Submit work as a proposal or audit.
5. Move the task to `review`.
6. Wait for human approval or revision feedback.
7. Mark the task `complete` only after the accepted outcome is visible.

Agents should use stable task and proposal IDs and must not retry billable requests automatically.
