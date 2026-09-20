# A Status And Handover V0 1

## Work report

The A-team engineering and data review for the v0.1 trial version is complete.

CARE Version 6 has been downloaded and its official MD5 has been checked:

```text
2547b58c21ac8c242d13232860cf500c
```

The current recommended MVP case is:

```text
dataset = CARE to Compare Version 6
farm = Wind Farm A
scene_type = ONSHORE
event_id = 51
asset = 21
system turbine_id = WT02
system component_id = WT02_COMPONENT_01
```

Event 51 is traceable to the official event metadata and data file. Its description is `Gearbox bearings damaged`. The system identifier remains neutral until the team approves the CARE-to-system mapping.

Completed A deliverables:

1. CARE data asset register and source boundary
2. Wind Farm A/B/C event register with 95 records
3. Wind Farm A/B/C field dictionary
4. Event 51 evidence report
5. A engineering review log for the D backend
6. Engineering decision register separating facts, recommendations, and assumptions
7. Initial KPI and maintenance-rule review materials

Repository files:

- `docs/data/care-dataset-register.md`
- `docs/data/event-register.csv`
- `docs/data/field-dictionary.csv`
- `docs/data/care-event-51-evidence.md`
- `docs/engineering/decision-register.md`
- `docs/integration/a-review-log.md`

## Tasks still required from A

1. Obtain team approval for the four v0.1 decisions: Event 51 as the MVP case, `ONSHORE` scene type, neutral component ID, and B's first candidate fields.
2. Confirm with B whether `sensor_11_avg` and `sensor_12_avg` pass missing-value, outlier, and time-split checks.
3. Review B's model result JSON: data version, feature list, time split, model version, score definition, and validation metrics.
4. Mark the 0.45 and 0.75 thresholds as `ASSUMED` until B provides validation evidence, or replace them with an evidence-based threshold proposal.
5. After the full integration run, record actual KPI values and unresolved issues in the A review log.
6. Upload the A documents to the shared GitHub repository and tell the team which commit contains them.

## Items for B

- Produce one real CARE-derived model result that follows `docs/api-contract.md`.
- State whether `failure_risk` is a relative risk score or calibrated probability.
- Provide the data split, model version, selected features, and validation metrics.
- Do not label the result `REAL` if it is only a simulated example; use `DERIVED` for a result calculated from CARE data.

## Items for C

- Read status, risk, and maintenance plans from D's API.
- Do not hard-code risk values, warning levels, or maintenance plans in the frontend.
- Show data origin, model version, timestamp, and the neutral component ID.
- Show an explicit empty/error state when the API has no result.

## Items for D

- Keep the shared test IDs unchanged during the first integration.
- Preserve the original plan when replanning and record the trigger condition.
- Add or document rule version, input conditions, confirmation user, and confirmation time where supported.
- Keep simulated staffing, windows, and post-maintenance effects labelled `SIMULATED`.

## First integration handover

```text
B produces a CARE-derived JSON
  -> D stores the JSON
  -> C reads and displays status and risk from D
  -> D creates a maintenance plan
  -> C displays the plan and the data-origin label
  -> team records the KPI result and any mismatch
```

## Evidence boundary

The competition documents do not provide the project's numerical risk thresholds, staffing units, weather-window values, maintenance effect, or CARE-to-system identifier mapping. Until approved or validated, these remain `ASSUMED`, `SIMULATED`, or `UNVERIFIED` and must not be reported as official competition rules or real-world probabilities.
