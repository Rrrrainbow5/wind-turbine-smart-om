"""Export genuine saved-checkpoint inference for existing CARE replay windows."""
import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import torch
from xgboost import XGBClassifier
from ai.care_multifault import SIGNALS, sha256
from ai.care_scada_three_branch import CLASSES, Temporal, Relations, Gate, relations


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--farm', type=Path, required=True)
    parser.add_argument('--experiment', type=Path, required=True)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(4)
    report_path = args.experiment / 'report.json'
    report = json.loads(report_path.read_text(encoding='utf-8'))
    checkpoint = args.experiment / 'all-data-research'
    saved = torch.load(checkpoint / 'neural.pt', map_location='cpu', weights_only=True)
    assert saved['classes'] == CLASSES and saved['channels'] == len(SIGNALS)
    temporal, relation, gate = Temporal(len(SIGNALS), len(CLASSES)), Relations(780, len(CLASSES)), Gate(len(CLASSES))
    temporal.load_state_dict(saved['temporal']); relation.load_state_dict(saved['relations'])
    gate.load_state_dict(torch.load(checkpoint / 'gate.pt', map_location='cpu', weights_only=True))
    temporal.eval(); relation.eval(); gate.eval()
    tree = XGBClassifier(); tree.load_model(checkpoint / 'statistics-xgboost.json')
    seq_imp, scaler, feat_imp = joblib.load(checkpoint / 'preprocessors.joblib')
    predictions = {p['sample_id']: p for p in report['predictions']}
    result = {}
    for case in json.loads(args.cases.read_text(encoding='utf-8'))['cases']:
        if case['label'] not in CLASSES:
            continue
        source = args.farm / 'datasets' / f"{case['event_id']}.csv"
        assert sha256(source) == case['source_sha256'], 'Source hash mismatch'
        frame = pd.read_csv(source, sep=';', usecols=['time_stamp', *SIGNALS])
        frame['time_stamp'] = pd.to_datetime(frame['time_stamp'])
        frame = frame.sort_values('time_stamp').drop_duplicates('time_stamp').set_index('time_stamp')
        window = frame.loc[pd.date_range(case['start'], periods=36, freq='10min'), SIGNALS].to_numpy(dtype=np.float32)
        window[~np.isfinite(window)] = np.nan
        x = scaler.transform(seq_imp.transform(window)).reshape(1, 36, len(SIGNALS)).astype(np.float32)
        features = np.array([[np.nan if v is None else v for v in case['features']]])
        p = np.zeros((1, 3, len(CLASSES)), dtype=np.float32)
        p[:, 0, saved['present']] = tree.predict_proba(feat_imp.transform(features))
        with torch.no_grad():
            p[:, 1] = temporal(torch.tensor(x)).softmax(1).numpy()
            p[:, 2] = relation(torch.tensor(relations(x))).softmax(1).numpy()
            fused, weights = gate(torch.tensor(p))
        assert np.isfinite(p).all() and np.allclose(p.sum(2), 1, atol=1e-5)
        assert np.isfinite(fused.numpy()).all() and np.isclose(float(fused.sum()), 1, atol=1e-5)
        held = predictions.get(case['sample_id'])
        result[case['sample_id']] = {'prediction': CLASSES[int(fused.argmax())],
            'probabilities': dict(zip(CLASSES, fused[0].tolist())),
            'branches': p[0].tolist(), 'weights': weights[0].tolist(),
            'held_out_probabilities': held['probabilities']['gated_fusion'] if held else None,
            'source_sha256': case['source_sha256']}
    output = {'version': report['version'], 'seed': report['seed'],
        'mode': 'SAVED_CHECKPOINT_REPLAY', 'macro_f1': report['metrics']['gated_fusion']['macro_f1'],
        'report_sha256': sha256(report_path),
        'checkpoint_sha256': {p.name: sha256(p) for p in checkpoint.iterdir() if p.is_file()},
        'classes': CLASSES, 'cases': result}
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(f'Exported {len(result)} verified windows; checkpoint replay is not independent validation')


if __name__ == '__main__':
    main()
