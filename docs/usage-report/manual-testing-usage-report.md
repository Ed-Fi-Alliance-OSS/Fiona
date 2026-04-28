# Manual Test Plan: Usage Report Function

Verifies the end-to-end flow from data generation in Fiona to the weekly report output.

## Prerequisites

- Cosmos DB Emulator installed and running (see [testing-with-cosmos-emulator.md](testing-with-cosmos-emulator.md))
- Azurite installed (`npm install -g azurite`)
- Azure Functions Core Tools v4 installed (`winget install Microsoft.Azure.FunctionsCoreTools`)
- A Slack workspace where you can interact with Fiona
- fiona-slack configured and able to run locally

---

## Step 1 — Start background services

Open two terminals and leave them running throughout testing.

**Terminal 1 — Azurite:**

```bash
azurite
```

**Terminal 2 — Cosmos DB Emulator:**
Start via the Windows Start menu or system tray. Confirm it is running by visiting `https://localhost:8081/_explorer/index.html`.

All following shell commands are in Terminal 2.

---

## Step 2 — Create Cosmos DB containers

Run this once. It creates the `fiona` database and the `interactions` and `feedback` containers in the emulator.

```bash
cd apps/fiona-slack
npm run setup:emulator
```

Confirm in the Data Explorer (`https://localhost:8081/_explorer/index.html`) that the `fiona` database with `interactions` and `feedback` containers exists.

---

## Step 3 — Configure and start fiona-slack

Copy the sample env file and configure it to use the local emulator:

```bash
cd apps/fiona-slack
cp .env.sample .env
```

Edit `.env` and set the following values (double check in Cosmos DB emulator that this is the correct connection string):

```env
DEPLOYMENT_TYPE=local
COSMOS_CONNECTION_STRING=AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==
```

Also configure the Perplexity API key and Slack app credentials as needed.

Start `fiona-slack` following its README, then confirm it connects to Slack, e.g. `npm run slack:unsafe` or `slack run` depending on your setup.

---

## Step 4 — Generate test data in Slack

Interact with Fiona to produce data across all KPIs in the report. Use at least **two different Slack users** to exercise the distinct-users count.

### Interactions (User 1)

Send at least three messages to Fiona and wait for responses:

- [ ] Ask a general question (e.g. "What is Ed-Fi?")
- [ ] Ask a follow-up in the same thread (same session)
- [ ] Start a new thread and ask another question (new session)

### Interactions (User 2)

Switch to a second Slack account or have a colleague:

- [ ] Ask at least one question in a new thread

### Feedback

After receiving responses, submit feedback using Fiona's feedback buttons:

- [ ] Give at least two "good" feedback responses (👍)
- [ ] Give at least one "bad" feedback response (👎)

### Verify data was recorded

Open the Cosmos DB Data Explorer and confirm:

- `interactions` container has documents with `deploymentType: "local"` and recent `timestamp` values
- `feedback` container has documents with `deploymentType: "local"` and `value` field set to `"good-feedback"` or `"bad-feedback"`

---

## Step 5 — Configure and run the usage report function

```bash
cd apps/usage-report-function
cp local.settings.json.example local.settings.json
```

Confirm `local.settings.json` contains:

```json
{
  "Values": {
    "COSMOS_ENDPOINT": "https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
    "COSMOS_DATABASE": "fiona",
    "DEPLOYMENT_TYPE": "local",
    "SLACK_DRY_RUN": "true",
    "REPORT_SCHEDULE": "* * * * * *"
  }
}
```

Install dependencies and start the function:

```bash
npm install
func start
```

---

## Step 6 — Verify the report output

Watch the terminal. Within a second you should see:

```
[...] Weekly report function triggered
[...] Querying KPIs from Cosmos DB...
[...] Session Count: X, Total Interactions: X, Distinct Users: X
[...] Error Count: X, Rate Limited Count: X
[...] Dry-run mode — skipping Slack post. Full report:
📊 *Fiona Usage Report* — Week of ...
```

Check each line of the report against the data you generated:

| KPI | Expected |
|-----|----------|
| Unique users | ≥ 2 (you used two Slack accounts) |
| Sessions | ≥ 3 (you started multiple threads) |
| Total interactions | ≥ 4 |
| Good feedback | ≥ 2 |
| Bad feedback | ≥ 1 |
| Feedback ratio | > 0% |
| Avg interactions/user | > 0 |
| Feedback response rate | > 0% |

Press **Ctrl+C** to stop the function host once you have confirmed the output.
