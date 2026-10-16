# Actual three-branch hybrid experiment

This is a laboratory research implementation, not a validated wind-turbine diagnosis.
The earlier NumPy contract baseline remains available and is not renamed as a CNN.

## First fixed-parameter real-data run

Measured on 115 valid source records (five excluded), seed 7, 12 epochs:

| Configuration | Pooled Macro-F1 |
| --- | ---: |
| Gated actual three-branch hybrid | 0.2792 |
| XGBoost engineering only | 0.1940 |
| Raw 1D CNN only | 0.1475 |
| STFT CNN only | 0.2792 |
| Without engineering | 0.2792 |
| Without raw | 0.2792 |
| Without time-frequency | 0.2792 |

Accuracy: 0.3478; ECE: 0.6303; multiclass Brier: 1.2642. Fold Macro-F1:
0.1688 / 0.1754. Pooled and per-fold F1 are different aggregations and must not
be treated as interchangeable. Rounded identical ablation F1 values do not
mean that their probability vectors or calibration metrics are identical.

Training CNN losses fall strongly, but held-out predictions never select the
inner-race class (recall zero). The average gate weight is 97.65% STFT, 1.91%
engineering, 0.45% raw. These are observable signs of poor cross-bearing
generalization and gate collapse, not successful fusion or calibrated certainty.
The earlier contract baseline scored 0.3342 Macro-F1, so this experimental model
does not improve it. Preprocessing and channel inputs also differ, preventing a
controlled architecture-only comparison. Do not promote these fold weights to
deployment or change the existing backend's default inference behavior.

Full measured evidence: `examples/paderborn-neural-evaluation-v0.2.json`.
Both saved-fold inference round trips were verified against held-out predictions.
No test-driven retraining/hyperparameter search was performed after this run.
The next prerequisite is more independent physical bearings for a grouped inner
validation/OOF gate, followed by train-only preprocessing/model selection.

## Reproduce

Before attempting a leakage-safe learned gate, run:

```powershell
python -m ai.models.grouped_validation --output examples/bearing-validation-readiness-v0.2.json
```

The current manifest is `BLOCKED_INSUFFICIENT_BEARINGS`: at least one additional
independently labelled physical bearing for **each** of healthy, outer-race and
inner-race classes is needed even for the structural minimum of nested OOF.
Extra runs/operating conditions from the existing bearings do not count.
New bearing labels must be supported by official documentation before adapter
registration; do not guess labels from filenames. Three bearings/class is not
a promise of reliable performance or independent calibration.

`nested_bearing_plan` implements deterministic outer physical-bearing holdouts
and inner physical-bearing OOF plans, including unequal class group counts.
Tests check complete once-only coverage and no group overlap at either level.
It rejects fewer than three bearings/class. This is a tested split planner,
**not yet a nested training implementation**. The older experimental training
CLI below still uses its documented in-sample gate; it is preserved for
reproduction and must not be called leakage-safe OOF gate training.

Install `requirements-ai-training.txt` in an isolated Python environment, then run
from the repository root:

```powershell
python -m ai.models.train_paderborn_hybrid --raw-root "PATH_TO_PADERBORN_RAW" --output examples/paderborn-neural-evaluation-v0.2.json --artifact-dir artifacts/ai/paderborn-neural-v02 --epochs 12 --seed 7
python -m pytest -q
```

Training dependencies are optional for API-only development; neural tests skip if
they are not installed. All raw MAT files and local weights remain outside Git.
The report records exact runtime versions, input manifest hash, source hashes,
sample identities, train/test bearings, optimizer settings and artifact hashes.

## Architecture and processing

All three synchronous channels (vibration, phase current 1 and phase current 2)
share eight deterministic non-overlapping 4096-point segments at 64 kHz per
measurement. There is no waveform decimation; each segment is linearly detrended.
The adapter's audited source-timebase resampling still applies. Segments cover
only part of each record, and retain the parent source's sample identity.

- Engineering: eight statistics and sixteen log-power bands per channel (72
  features); XGBoost, 80 depth-3 trees, learning rate 0.05, histogram training.
- Raw: Conv1D 3→12→24→32, kernels 17/9/5, strides 4/4/2, ReLU, global average
  pooling and a three-class linear output. These are learned convolutions, not
  interpolation features.
- Time-frequency: 128-point Hann STFT, 64-point hop, no padding, log-power input;
  Conv2D 3→12→24→32 with 3×3 kernels, ReLU, average pooling and global pooling.
  Frequency-bin spacing is 500 Hz, so this branch cannot resolve low-frequency
  bearing sidebands and is not a substitute for high-resolution envelope spectra.
- Fusion: branch probability vectors feed a 9→12→3 MLP softmax gate. The weighted
  branch probabilities are averaged over eight windows to obtain one prediction
  per original sample. Ablations mask branches and renormalize the gate; they are
  inference-time ablations, not independently retrained alternative architectures.

CNN scaling parameters use training windows only, separately per channel and
branch. Fixed 12 epochs, Adam 0.001, batch size 32, class-weighted cross entropy.
Gate: Adam 0.01 for 100 full-batch steps. CPU execution, two threads, seeded
initialization and batch order, deterministic PyTorch algorithms.

## Evaluation boundaries

Manifest audits exclude five source-gap records; 115 records remain. In each
complementary fold one entire physical bearing per class is held out. No adjacent
window, repeat run or physical bearing crosses the fold boundary. Metrics are
computed per source record, never pretending that 920 windows are independent
test specimens. Both folds and pooled out-of-fold predictions are reported.

Only two physical bearings per class exist locally. There is no independent
validation/calibration set. Gate training uses in-sample branch predictions and
may overfit. Hyperparameters and epoch count are fixed before this run; test
results must not be used to select them. Earlier baseline test results were
already inspected, so this is exploratory evaluation, not a blinded benchmark.
More physical bearings are needed for inner-group out-of-fold gate training and
independent model selection. Confidence is an uncalibrated model score; entropy
is predictive ambiguity, not a complete estimate of epistemic uncertainty.

Saved fold weights can be reloaded via `SavedHybridPredictor(folder).predict(sample)`
where `sample` comes from `load_paderborn_sample`. The CLI checks one held-out
prediction after artifact reload for each fold. Use only trusted local artifacts,
check their report hashes before transferring, and do not treat fold models as
an all-data production model. The predictor preserves `sample_id`, source hash
and origin. `component_key` stays null (`UNMAPPED`) until a verified component
mapping exists; no arbitrary 3D bearing highlight is produced.

This work does not finish the physical simulator, robust-z comparison, t-SNE
artifact, backend deployment integration, independent calibration or field
validation. Those remain explicit B/integration deliverables.
