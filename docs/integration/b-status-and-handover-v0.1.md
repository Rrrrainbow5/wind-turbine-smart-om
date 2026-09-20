# B Status and Handover v0.1

## Completion report

- Member: B
- Dataset: CARE to Compare Version 6, Wind Farm A, Event 51
- System IDs: `WT02` / `WT02_COMPONENT_01`
- Model version: `robust-z-v0.1.0`
- Data origin: `DERIVED`
- API: `POST /api/ai-results`

## Delivered work

1. Added a reproducible read-only CARE audit.
2. Added a robust-z Event 51 baseline and stable `ai.inference.predict` entry point.
3. Added a separate `requirements-ai.txt` dependency file.
4. Added audit and baseline contract tests.
5. Generated a timezone-aware API payload and machine-readable evaluation record.
6. Verified AI submission, state query, and maintenance-plan generation against the D backend.

## Features and time split

Features:

- `sensor_11_avg`
- `sensor_12_avg`
- `sensor_18_avg`
- `sensor_52_avg`
- `power_29_avg`
- `wind_speed_3_avg`

The existing CARE `train` rows are split chronologically: 60% fit, 20% validation, and 20% holdout. Event prediction rows are not used to fit the baseline. Missing or nonnumeric values use fit-window median imputation. The baseline uses median/MAD scaling and does not apply unverified physical clipping.

## Scoring and validation

The anomaly/risk value is a relative score:

`clip(robust_z / (2 * validation_p99), 0, 1)`

It is not a calibrated failure probability.

- Precision: `0.5682`
- Recall: `0.0149`
- F1: `0.0291`
- ROC AUC: `0.4659`

These results are weak. The baseline is suitable for reproducibility and interface integration, not as the final early-warning model.

## Integration result

Integration used an isolated local SQLite database.

| Step | Result |
| --- | --- |
| Submit `examples/ai-result-derived-event51.json` | HTTP `201` |
| Query `GET /api/turbines/WT02/state` | HTTP `200` |
| Generate `POST /api/maintenance/optimize` | HTTP `201` |
| Stored model version | `robust-z-v0.1.0` |
| Stored data origin | `DERIVED` |
| Latest relative risk | `0.216481` |
| Trial-rule action | `CONTINUE_MONITORING` |

The maintenance rule, personnel availability, and maintenance window remain `ASSUMED` or `SIMULATED` inputs owned by A and D. The low v0.1 risk must not be interpreted as evidence that Event 51 was safe.

## Test result

`python -m pytest -q`: 12 tests passed.

## Unresolved work

1. Improve the baseline with operating-condition normalization and rolling trend features.
2. Evaluate across multiple anomaly and normal events rather than only Event 51 time points.
3. Calibrate risk only if a suitable cross-event validation design supports probability claims.
4. Keep `WT02_COMPONENT_01` neutral until A records the formal CARE-to-system mapping.
