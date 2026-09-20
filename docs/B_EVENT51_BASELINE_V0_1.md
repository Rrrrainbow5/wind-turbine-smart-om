# B Event 51 Baseline v0.1

## Case

- Dataset: CARE to Compare Version 6
- Wind farm: Wind Farm A
- Event: 51
- Asset: 21
- Official event description: `Gearbox bearings damaged`
- System IDs for integration: `WT02` / `WT02_COMPONENT_01`
- Data origin: `DERIVED`

The system component ID remains neutral until the team completes the formal CARE-to-system mapping.

## Model

Model version: `robust-z-v0.1.0`

The baseline fits robust location and scale statistics on the first 60% of the chronological `train` rows. The next 20% is validation data and the final 20% is a time-ordered holdout. For each row, the anomaly score is the maximum absolute robust z-score across the selected signals. The alert threshold is the 99th percentile of validation scores.

Selected features:

- `sensor_11_avg`
- `sensor_12_avg`
- `sensor_18_avg`
- `sensor_52_avg`
- `power_29_avg`
- `wind_speed_3_avg`

The first two signals were prioritized because their official field dictionary gives engineering descriptions related to the current candidate case. The other four signals provide operating context.

Missing values were handled by the fit-window median. The fit-window median absolute deviation was scaled by 1.4826; zero or unavailable scales fall back to the fit-window standard deviation. No post-event rows were used to fit the baseline.

## Validation result

Using the Event 51 prediction interval and labeling rows between the official event start and end as event-positive:

- Fit rows: 31,225
- Validation rows: 10,409
- Holdout rows: 10,409
- Threshold: `4.5908547478`
- Precision: `0.5682`
- Recall: `0.0149`
- F1: `0.0291`
- ROC AUC: `0.4659`
- First pre-event threshold crossing: `2023-10-04T12:30:00`

These metrics are weak and are not evidence of a reliable early-warning model. The baseline is useful as a reproducible reference and integration artifact, but it needs a better time-window feature design and/or a labeled cross-event evaluation before it can be used as the project's final model.

## Score definition

For the integration JSON, `anomaly_score` and `failure_risk` are relative normalized scores derived from the robust-z baseline. They are not calibrated probabilities. The current risk score is defined as:

`clip(max_robust_z / (2 * validation_threshold), 0, 1)`

The Event 51 start-time row has a robust score of approximately `1.9877`, giving a relative risk score of approximately `0.2165`, a health index of approximately `78.3`, and warning level `LOW` under the current assumed thresholds. This low warning level is consistent with the weak baseline and should not be interpreted as evidence that the event was safe.
