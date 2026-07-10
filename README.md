# Tripp.Scenes

Tripp.Scenes is a local-first AI storyboard and media studio. It keeps the original dialogue-block workflow while adding durable projects, image/video generation jobs, an asset vault, and YouTube-ready render packages.

## Run

```powershell
npm start
```

The app starts at `http://localhost:3000`. If that port is occupied and `PORT` is not explicitly configured, it selects the next available port and prints the final URL.

## Provider setup

Copy `.env.example` to `.env` and add any providers you want to use:

```dotenv
FAL_KEY=
VENICE_API_KEY=
OPENAI_API_KEY=
```

Keys are read only by the local Express server and are never sent to browser code. Fal and Venice support both image and video jobs. OpenAI is enabled for image generation; video remains behind the provider capability boundary so the application does not depend on a changing video API.

## Workflow

1. Write and assign dialogue in the existing editor.
2. Choose Short, Long, or Square output in the toolbar.
3. Save the project to the Story Vault.
4. Select **Generate**, review the visual prompt, and choose image or video.
5. Follow queued work and generated takes in **Assets**.
6. Use **Render Package** to produce a versioned manifest, draft SRT captions, YouTube metadata, and an MP4 when an image take is available.

Project records are stored under `data/`; render packages are stored under `exports/`. Both directories are intentionally excluded from Git.

## Tests

```powershell
npm test
```

## Agent collaboration

Tripp.Scenes supports human-led, agent-led, and collaborative creation modes. Initialize separate local credentials for the two Hermes roles and the OpenClaw auditor:

```powershell
npm run agents:init
```

Restart the app afterward. See [`docs/AGENT_API.md`](docs/AGENT_API.md) for roles, permissions, routes, proposal examples, audit records, and the recommended agent loop.
