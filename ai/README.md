# B AI Module

## Scope

This module audits CARE to Compare data and generates the v0.1 Event 51 baseline result used by the D backend. It does not contain the full CARE archive.

Install AI dependencies:

```powershell
python -m pip install -r requirements-ai.txt
```

Generate the API payload and evaluation record:

```powershell
python -m ai.event51_baseline `
  "E:\CARE_To_Compare\CARE_To_Compare\Wind Farm A" `
  --output examples\ai-result-derived-event51.json `
  --metrics-output examples\event51-baseline-metrics.json `
  --source-timezone UTC
```

Submit the generated result after the backend starts:

```powershell
python examples\b_submit_ai_result.py `
  --input examples\ai-result-derived-event51.json
```

`ai.inference.predict(farm_dir)` is the stable Python entry point. It returns a dictionary conforming to `POST /api/ai-results`.

CARE timestamps are anonymized and timezone-naive. The v0.1 integration output explicitly localizes them to UTC so the API timestamp is unambiguous; this is a system convention, not a claim about the source wind farm's original timezone.
