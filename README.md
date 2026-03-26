# Fiona

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Ed-Fi-Alliance-OSS/Fiona/badge)](https://securityscorecards.dev/viewer/?uri=github.com/Ed-Fi-Alliance-OSS/Fiona)

Fiona is an AI-powered Slack assistant built by the [Ed-Fi
Alliance](https://www.ed-fi.org) that helps the Ed-Fi community navigate
documentation, standards, APIs, and implementation guidance through natural
language conversation.

## Features

- **Slack-native** — Available via @-mentions, direct messages, and the Slack
  Assistant side panel.
- **Real-time web search** — Queries Ed-Fi documentation sites through
  Perplexity with configurable domain filtering.
- **Streaming responses** — Text streams progressively so users don't wait for a
  complete answer.
- **User feedback** — Thumbs-up/down buttons on every response, optionally
  persisted to Azure Cosmos DB for analytics.
- **Rate limiting** — Per-user sliding-window rate limiter to prevent abuse.
- **Socket Mode** — Outbound WebSocket only; no public URL or ingress required.

## Repository Structure

```none
.
└── .github/workflows/           # CI/CD pipelines
└── apps/fiona-slack/            # Slack bot application (Node.js / Slack Bolt)
    ├── manifest.json            # Slack app manifest (permissions, features, events)
    ├── slack.json               # Slack CLI hooks (get-hooks, start)
    ├── .env.sample              # Environment variable template
    └── src/app.js               # Application entry point
└── infra/azure/                 # Azure Bicep templates for deployment
    ├── shared.bicep             # Shared resources (Container Registry, Log Analytics)
    ├── fiona-slack-container/   # Container App definition
└── docs/                        # Product requirements and design documents
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Slack CLI](https://docs.slack.dev/tools/slack-cli/) installed and authenticated
- A [Slack app](https://api.slack.com/apps) configured with Socket Mode (or use
  `slack run` to create one automatically from the manifest)
- An LLM provider API key (Perplexity, OpenAI, or Azure)

### Slack App Configuration

The [`apps/fiona-slack/manifest.json`](apps/fiona-slack/manifest.json) file is
the single source of truth for the Slack app's permissions, features, and event
subscriptions. It declares:

- **Assistant side panel** — AI assistant panel with `assistant:write` scope and
  `assistant_thread_started` / `assistant_thread_context_changed` events.
- **@-mentions and DMs** — `app_mentions:read`, `im:history`, `channels:history`,
  and `groups:history` scopes with matching event subscriptions.
- **Interactive components** — Interactivity enabled for feedback buttons.
- **Socket Mode** — No public URL or ingress required.

Use `slack manifest validate` to verify the manifest before deploying.

### Local Development

1. Clone this repository.
1. Copy the environment template and fill in your credentials:

   ```shell
   cd apps/fiona-slack
   cp .env.sample .env
   ```

1. Install dependencies:

   ```bash
   npm ci
   ```

1. Start the bot locally via the Slack CLI (recommended):

   ```bash
   slack run
   ```

   The CLI reads [`slack.json`](apps/fiona-slack/slack.json) for hook definitions
   and [`manifest.json`](apps/fiona-slack/manifest.json) for app configuration.
   On first run it will create (or link) a Slack app in your workspace.

   Or run directly with Node (requires `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in
   `.env`):

   ```bash
   npm start
   ```

See [`apps/fiona-slack/.env.sample`](apps/fiona-slack/.env.sample) for the full
list of configuration options.

### Running Tests

```bash
cd apps/fiona-slack
npm test
```

## Deployment

Fiona deploys to **Azure Container Apps** via GitHub Actions. Two workflows are
provided:

| Workflow                           | Trigger                        | Method                                      |
| ---------------------------------- | ------------------------------ | ------------------------------------------- |
| `deploy-fiona-slack-container.yml` | Manual dispatch                | Docker build → ACR → Bicep → Container Apps |
| `deploy-fiona-slack.yml`           | Push to `main` / `insiders-**` | Slack CLI `slack deploy`                    |

See [`docs/fiona-slack-prd.md`](docs/fiona-slack-prd.md) for the full product
requirements document, architecture details, and roadmap.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting
changes.

## License

Copyright (c) Ed-Fi Alliance, LLC and contributors.

Licensed under the [Apache License, Version 2.0](LICENSE) (the "License").

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

See [NOTICES](NOTICES.md) for additional copyright and license notifications.
