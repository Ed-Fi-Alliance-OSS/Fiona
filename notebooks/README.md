# Fiona Question Bank — Notebooks

This folder contains the data pipeline and knowledge artifacts for Fiona's question bank: a system for evaluating response quality, identifying documentation gaps, and tracking improvement over time.

## Pipeline Overview

The notebooks are numbered to reflect the intended run order. Each stage feeds the next.

| Notebook | Stage | Status | Description |
|---|---|---|---|
| `01_sitemap_analysis.ipynb` | Ingest | Done | Parses the Ed-Fi docs sitemap (local build or live site) and produces a tagged URL list by section and product. Output: `data/processed/edfi_doc_urls.csv` |
| `02_feedback_ingestion.ipynb` | Ingest | TODO | Queries Cosmos DB for chatbot interactions and feedback records, normalizes them, and writes exports to `data/raw/`. Replaces the manual CSV export step. |
| `03_eval_comparison.ipynb` | Evaluate | Planned | For each question in the bank, queries the relevant NotebookLM / Gemini notebook and scores the result against the existing Fiona response on three dimensions: correctness, concept recall, and source recall. |
| `04_doc_change_impact.ipynb` | Regression | Planned | Re-runs a subset of eval questions after a doc update and diffs the scores against the baseline. Answers: "did this doc change improve Fiona's answer quality?" |

## Folder Structure

```
notebooks/
  01_sitemap_analysis.ipynb       # Stage 1 — parse docs sitemap
  02_feedback_ingestion.ipynb     # Stage 2 — pull from Cosmos DB (TODO)
  03_eval_comparison.ipynb        # Stage 3 — score Fiona vs Gemini (planned)
  04_doc_change_impact.ipynb      # Stage 4 — regression after doc updates (planned)

  data/
    raw/                          # Source data — gitignored (*.csv rule)
      chatbot_feedback.csv        # Cosmos DB feedback export
      chatbot_interactions.csv    # Cosmos DB interactions export
    processed/                    # Notebook outputs — gitignored
      edfi_doc_urls.csv           # Sitemap URL list with section tags

  concepts/                       # Curated knowledge artifacts — committed
    concept_scan_results.md       # 38 canonical Ed-Fi concepts with confidence ratings and source paths
    concept_faqs.md               # Persona-specific FAQs per concept — seeds the question bank

  question_bank/                  # Question bank entries (format TBD — see AI-24)
    eval_results/                 # Per-run evaluation outputs from 03_eval_comparison
```

## Desired End State

The goal is a **fully automated evaluation pipeline** that connects Fiona's live feedback stream to the documentation improvement workflow:

1. **Automated ingestion** (`02`): Cosmos DB feedback is queried on a schedule. New bad-feedback entries are automatically staged as question bank candidates — no manual CSV export.

2. **Automated evaluation** (`03`): Each staged question is sent to a Gemini File Search store (replacing the manual NotebookLM approach) and scored against Fiona's response. Results are written to `question_bank/eval_results/` with a timestamp and question ID.

3. **Doc-change regression** (`04`): When a documentation change is merged to `docs.ed-fi.org`, the pipeline re-runs the affected question bank entries and produces a before/after score diff. This closes the loop: doc updates can be validated quantitatively before Perplexity re-indexes them.

4. **SME review integration**: Low-scoring or newly flagged entries are surfaced to SMEs through a lightweight review interface (format TBD). Once an SME approves a canonical answer, the question graduates from candidate to regression bank entry.

The NotebookLM notebooks (11 subject-matter notebooks) serve as the evaluation reference during the manual phase. Once Gemini File Search is integrated programmatically, they become the source-of-truth corpus for automated scoring.

## Data Notes

- `data/raw/` and `data/processed/` are gitignored via the root `*.csv` rule. Regenerate from Cosmos DB or by re-running the notebooks.
- `concepts/` files are committed — they are curated artifacts, not pipeline outputs.
- `question_bank/` entries will be committed once a storage format is decided (see AI-24 next steps).
