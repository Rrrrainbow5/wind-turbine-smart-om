# Engineering Decision Register

This register separates source-backed facts from project recommendations and temporary assumptions. It prevents a trial implementation from being presented as an official rule or a validated engineering result.

## Confirmed by supplied documents or official dataset metadata

| Item | Status | Evidence |
| --- | --- | --- |
| The competition values a complete engineering chain, practical value, scenario realism, stable operation, and useful interaction | Confirmed requirement | Supplied competition PDFs |
| The project team has four roles: A engineering/data/KPI control, B model, C interaction, D backend/integration | Confirmed project division | Supplied CARE/project Word document |
| CARE Version 6 contains Wind Farm A, B, and C with event and feature metadata | Confirmed dataset fact | CARE Version 6 README and metadata files |
| Wind Farm A is an onshore Portuguese farm; Wind Farm B/C are offshore German farms | Confirmed dataset fact | CARE dataset description |
| Event 51 in Wind Farm A is asset 21, labelled anomaly, with the description Gearbox bearings damaged | Confirmed dataset fact | Wind Farm A event_info.csv |
| Wind Farm A sensor_11 and sensor_12 have the documented meanings used in the evidence report | Confirmed dataset fact | Wind Farm A feature_description.csv |

## Evidence-based project recommendations

These are not wording from the competition rules. They are A's recommendations because they keep the MVP traceable and demonstrable.

| Decision | Recommendation | Why |
| --- | --- | --- |
| v0.1 scenario | Use Wind Farm A / Event 51 and label it `ONSHORE` | It has a traceable event, asset, time range, data file, and field descriptions |
| System identifier | Keep `WT02_COMPONENT_01` until formal mapping is approved | Avoids silently changing the shared D/C contract |
| First candidate features | Let B evaluate `sensor_11_avg` and `sensor_12_avg` first | Their meanings are documented; B still must perform quality checks |
| Repository contents | Store metadata and small reproducible samples, not the full archive | Keeps the repository usable and preserves source traceability |

## Items that are assumptions or require team approval

These must not be described as facts from the PDFs or CARE data.

| Item | Current trial value | Classification | Alternative to keep available | Confirmation owner |
| --- | --- | --- | --- | --- |
| Risk thresholds | 0.45 and 0.75 | `ASSUMED` configurable demo rule | Choose thresholds from B's validation curve or report a three-level relative score | A + B |
| Risk wording | `failure_risk` shown as risk score | Engineering safeguard | Call it calibrated probability only after B supplies calibration evidence | A + B |
| Staff capacity | Inspection 1 unit, maintenance 2 units | `SIMULATED`/`ASSUMED` | Use explicit crew roles and hours if the team has a source | A + D |
| Maintenance window | Boolean available/unavailable | `SIMULATED` | Use a time interval with weather and safety constraints | A + D |
| Maintenance effect | Simulated post-maintenance health/risk change | `SIMULATED` | Use a replayed CARE segment or a documented engineering response model | B + D |
| CARE-to-system mapping | Candidate mapping to `WT02_COMPONENT_01` | `UNVERIFIED` | Add a formal mapping table approved by all members | A + D |
| MVP model performance | Not yet claimed | Pending | Report precision/recall/F1/AUC with a declared time split | B |

## Decision rule for the team

Until an item in the last table has evidence or an explicit approval, label it `ASSUMED`, `SIMULATED`, or `UNVERIFIED` in documents and UI. Do not present it as a competition rule, a CARE fact, or a calibrated real-world probability.

