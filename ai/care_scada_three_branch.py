"""Independent SCADA multi-view experiment; never changes production inference.

36 ten-minute readings are not vibration waveforms. Branches: statistical
XGBoost, temporal Conv1d, channel-correlation MLP. Nested asset-group validation.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.preprocessing import StandardScaler
from torch import nn
from xgboost import XGBClassifier

from ai.care_multifault import SIGNALS, prepare, sha256

SEED = 20261105
CLASSES = ['gearbox', 'gearbox_bearing', 'generator_bearing', 'healthy', 'hydraulic']


class Temporal(nn.Module):
    def __init__(self, channels, classes):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(channels, 24, 3, padding=1), nn.ReLU(),
                                 nn.Conv1d(24, 24, 3, padding=1), nn.ReLU(),
                                 nn.AdaptiveAvgPool1d(1), nn.Flatten(), nn.Linear(24, classes))

    def forward(self, x):
        return self.net(x.transpose(1, 2))


class Relations(nn.Module):
    def __init__(self, size, classes):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(size, 32), nn.ReLU(), nn.Dropout(.15),
                                 nn.Linear(32, classes))

    def forward(self, x):
        return self.net(x)


class Gate(nn.Module):
    def __init__(self, classes):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(3 * classes, 12), nn.Tanh(), nn.Linear(12, 3))

    def forward(self, p):
        weights = self.net(p.flatten(1)).softmax(1)
        return (p * weights.unsqueeze(2)).sum(1), weights


def weights_for(y, events):
    weights = np.zeros(len(y), dtype=np.float32)
    for label in np.unique(y):
        event_set = np.unique(events[y == label])
        for event in event_set:
            mask = (events == event) & (y == label)
            weights[mask] = 1 / (len(event_set) * mask.sum())
    return weights / weights.mean()


def relations(x):
    centered = x - x.mean(axis=1, keepdims=True)
    norm = np.sqrt(np.square(centered).sum(axis=1, keepdims=True))
    normalized = centered / np.maximum(norm, 1e-8)
    corr = np.einsum('ntc,ntd->ncd', normalized, normalized)
    upper = np.triu_indices(x.shape[2], 1)
    return corr[:, upper[0], upper[1]].astype(np.float32)


def fit_neural(model, x, y, weights, epochs):
    optimizer = torch.optim.Adam(model.parameters(), lr=.003, weight_decay=.001)
    x, y, w = torch.tensor(x), torch.tensor(y, dtype=torch.long), torch.tensor(weights)
    history = []
    model.train()
    for _ in range(epochs):
        total = 0.
        for batch in torch.randperm(len(y)).split(128):
            optimizer.zero_grad()
            loss = (nn.functional.cross_entropy(model(x[batch]), y[batch], reduction='none') * w[batch]).mean()
            loss.backward()
            optimizer.step()
            total += float(loss.detach()) * len(batch)
        history.append(total / len(y))
    model.eval()
    return history


def fit_branches(seq, features, y, events, train, test, epochs, save=None):
    """Every imputer/scaler is fitted only on train indices."""
    torch.manual_seed(SEED)
    channels = seq.shape[2]
    seq_imp = SimpleImputer(strategy='median', keep_empty_features=True)
    seq_scaler = StandardScaler()
    train_seq = seq_imp.fit_transform(seq[train].reshape(-1, channels))
    train_seq = seq_scaler.fit_transform(train_seq).reshape(-1, 36, channels).astype(np.float32)
    test_seq = seq_scaler.transform(seq_imp.transform(seq[test].reshape(-1, channels))).reshape(-1, 36, channels).astype(np.float32)
    feat_imp = SimpleImputer(strategy='median', keep_empty_features=True)
    train_feat = feat_imp.fit_transform(features[train])
    test_feat = feat_imp.transform(features[test])
    w = weights_for(y[train], events[train])
    present = np.unique(y[train])
    # XGBoost requires contiguous local classes; explicitly align to fixed classes.
    local_y = np.searchsorted(present, y[train])
    tree = XGBClassifier(n_estimators=100, max_depth=3, learning_rate=.05,
                         subsample=1, colsample_bytree=.8, n_jobs=4, random_state=SEED)
    tree.fit(train_feat, local_y, sample_weight=w)
    p = np.zeros((len(test), 3, len(CLASSES)), dtype=np.float32)
    p[:, 0, present] = tree.predict_proba(test_feat)
    temporal = Temporal(channels, len(CLASSES))
    relation = Relations(channels * (channels - 1) // 2, len(CLASSES))
    histories = [fit_neural(temporal, train_seq, y[train], w, epochs),
                 fit_neural(relation, relations(train_seq), y[train], w, epochs)]
    with torch.no_grad():
        p[:, 1] = temporal(torch.tensor(test_seq)).softmax(1).numpy()
        p[:, 2] = relation(torch.tensor(relations(test_seq))).softmax(1).numpy()
    # Missing classes cannot be learned in this fold, including neural heads.
    absent = np.setdiff1d(np.arange(len(CLASSES)), present)
    p[:, :, absent] = 0
    p /= p.sum(2, keepdims=True)
    if save:
        import joblib
        save.mkdir(parents=True, exist_ok=True)
        tree.save_model(save / 'statistics-xgboost.json')
        torch.save({'temporal': temporal.state_dict(), 'relations': relation.state_dict(),
                    'channels': channels, 'classes': CLASSES, 'present': present.tolist()}, save / 'neural.pt')
        joblib.dump((seq_imp, seq_scaler, feat_imp), save / 'preprocessors.joblib')
    return p, histories


def fit_gate(p, y, events, epochs=150):
    torch.manual_seed(SEED)
    gate = Gate(len(CLASSES))
    optimizer = torch.optim.Adam(gate.parameters(), lr=.01, weight_decay=.01)
    tensor = torch.tensor(p)
    weights = torch.tensor(weights_for(y, events))
    # A class absent from the inner training fold has zero probability by design.
    # Exclude those impossible examples from gate fitting, disclose count.
    usable = p[np.arange(len(y)), :, y].sum(1) > 0
    if not usable.any():
        raise ValueError('No learnable inner validation samples for gate')
    for _ in range(epochs):
        optimizer.zero_grad()
        result, _ = gate(tensor)
        loss = (-result[torch.arange(len(y)), y].clamp_min(1e-8).log() * weights)[usable].mean()
        loss.backward()
        optimizer.step()
    gate.eval()
    return gate, int((~usable).sum())


def predict_research(checkpoint: Path, sequences, features):
    """Load only locally trusted checkpoints. No timestamps/labels as inputs."""
    import joblib
    sequences = np.asarray(sequences, dtype=np.float32)
    features = np.asarray(features, dtype=float)
    if sequences.ndim != 3 or sequences.shape[1:] != (36, len(SIGNALS)):
        raise ValueError('Expected N x 36 x 40 SCADA values in SIGNALS order')
    if features.shape != (len(sequences), len(SIGNALS) * 3):
        raise ValueError('Expected N x 120 statistical features')
    sequences = np.where(np.isfinite(sequences), sequences, np.nan)
    features = np.where(np.isfinite(features), features, np.nan)
    seq_imp, scaler, feat_imp = joblib.load(checkpoint / 'preprocessors.joblib')
    values = scaler.transform(seq_imp.transform(sequences.reshape(-1, len(SIGNALS)))).reshape(sequences.shape).astype(np.float32)
    state = torch.load(checkpoint / 'neural.pt', weights_only=True)
    temporal = Temporal(len(SIGNALS), len(CLASSES)).eval()
    relation = Relations(len(SIGNALS) * (len(SIGNALS) - 1) // 2, len(CLASSES)).eval()
    temporal.load_state_dict(state['temporal'])
    relation.load_state_dict(state['relations'])
    tree = XGBClassifier()
    tree.load_model(checkpoint / 'statistics-xgboost.json')
    p = np.zeros((len(values), 3, len(CLASSES)), dtype=np.float32)
    p[:, 0, state['present']] = tree.predict_proba(feat_imp.transform(features))
    gate = Gate(len(CLASSES)).eval()
    gate.load_state_dict(torch.load(checkpoint / 'gate.pt', weights_only=True))
    with torch.no_grad():
        p[:, 1] = temporal(torch.tensor(values)).softmax(1).numpy()
        p[:, 2] = relation(torch.tensor(relations(values))).softmax(1).numpy()
        p[:, :, np.setdiff1d(np.arange(len(CLASSES)), state['present'])] = 0
        p /= p.sum(2, keepdims=True)
        fused, weights = gate(torch.tensor(p))
    return {'classes': CLASSES, 'probabilities': fused.numpy(), 'branch_probabilities': p,
            'gate_weights': weights.numpy()}


def load_data(farm, output):
    rows, sources, rejected = prepare(farm, output / 'windows-cache.json')
    rows = [r for r in rows if r['label'] in CLASSES]
    sequences = np.empty((len(rows), 36, len(SIGNALS)), dtype=np.float32)
    for event in sorted({r['event_id'] for r in rows}):
        frame = pd.read_csv(farm / 'datasets' / f'{event}.csv', sep=';', usecols=['time_stamp', *SIGNALS])
        frame['time_stamp'] = pd.to_datetime(frame.time_stamp)
        frame = frame.sort_values('time_stamp').drop_duplicates('time_stamp').set_index('time_stamp')
        for i, row in enumerate(rows):
            if row['event_id'] != event:
                continue
            expected = pd.date_range(row['start'], periods=36, freq='10min')
            if not expected.isin(frame.index).all():
                raise ValueError('Missing timestamps in extracted sequence')
            sequences[i] = frame.loc[expected, SIGNALS].to_numpy(dtype=np.float32)
    sequences[~np.isfinite(sequences)] = np.nan
    return rows, sequences, sources, rejected


def main():
    global SEED
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--farm', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--epochs', type=int, default=25)
    parser.add_argument('--seed', type=int, default=SEED)
    args = parser.parse_args()
    SEED = args.seed
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    rows, seq, sources, rejected = load_data(args.farm, args.output)
    features = np.array([r['features'] for r in rows], dtype=np.float64)
    y = np.array([CLASSES.index(r['label']) for r in rows])
    groups = np.array([r['asset'] for r in rows])
    events = np.array([r['event_id'] for r in rows])
    methods = ['statistics_xgboost', 'temporal_cnn', 'channel_relations_mlp', 'equal_fusion', 'gated_fusion', 'random_forest']
    probabilities = {name: np.zeros((len(y), len(CLASSES))) for name in methods}
    folds = []
    for train, test in LeaveOneGroupOut().split(seq, y, groups):
        asset = int(groups[test[0]])
        print(f'OUTER test asset={asset}; train={len(train)}, test={len(test)}', flush=True)
        inner_p = np.zeros((len(train), 3, len(CLASSES)), dtype=np.float32)
        inner_folds = []
        for inner_train, inner_test in LeaveOneGroupOut().split(seq[train], y[train], groups[train]):
            a, b = train[inner_train], train[inner_test]
            assert set(groups[a]).isdisjoint(groups[b]) and set(groups[a]).isdisjoint(groups[test])
            inner_p[inner_test], _ = fit_branches(seq, features, y, events, a, b, args.epochs)
            inner_folds.append({'validation_asset': int(groups[b[0]]), 'missing_classes': [CLASSES[c] for c in set(y[b]) - set(y[a])]})
        gate, excluded = fit_gate(inner_p, y[train], events[train])
        fold_dir = args.output / f'asset-{asset}'
        p, histories = fit_branches(seq, features, y, events, train, test, args.epochs, fold_dir)
        for j, name in enumerate(methods[:3]):
            probabilities[name][test] = p[:, j]
        probabilities['equal_fusion'][test] = p.mean(1)
        with torch.no_grad():
            fused, gate_weights = gate(torch.tensor(p))
        probabilities['gated_fusion'][test] = fused.numpy()
        torch.save(gate.state_dict(), fold_dir / 'gate.pt')
        imp = SimpleImputer(strategy='median', keep_empty_features=True)
        rf = RandomForestClassifier(n_estimators=240, max_depth=12, min_samples_leaf=2,
                                    max_features='sqrt', random_state=20261029, n_jobs=1)
        rf.fit(imp.fit_transform(features[train]), y[train], sample_weight=weights_for(y[train], events[train]))
        probabilities['random_forest'][np.ix_(test, rf.classes_)] = rf.predict_proba(imp.transform(features[test]))
        fold = {'test_asset': asset, 'train_assets': sorted(set(groups[train].tolist())),
                'train_windows': len(train), 'test_windows': len(test),
                'missing_classes': [CLASSES[c] for c in set(y[test]) - set(y[train])],
                'inner_folds': inner_folds, 'gate_excluded_impossible_windows': excluded,
                'mean_gate_weights': gate_weights.mean(0).tolist(), 'training_losses': histories,
                'macro_f1': {name: f1_score(y[test], probabilities[name][test].argmax(1), labels=np.arange(len(CLASSES)), average='macro', zero_division=0) for name in methods}}
        folds.append(fold)
        (args.output / 'progress.json').write_text(json.dumps(folds, indent=2), encoding='utf-8')
        print(f'Completed asset={asset}: {fold["macro_f1"]}', flush=True)
    metrics = {name: {'macro_f1': f1_score(y, p.argmax(1), labels=np.arange(len(CLASSES)), average='macro', zero_division=0),
                      'classification_report': classification_report(y, p.argmax(1), labels=np.arange(len(CLASSES)), target_names=CLASSES, output_dict=True, zero_division=0),
                      'confusion_matrix': confusion_matrix(y, p.argmax(1), labels=np.arange(len(CLASSES))).tolist()} for name, p in probabilities.items()}
    # Research checkpoint only: all-data fitting after untouched outer evaluation.
    # Gate still learns solely from asset-held-out branch predictions.
    oof = np.stack([probabilities[name] for name in methods[:3]], axis=1).astype(np.float32)
    final_gate, final_excluded = fit_gate(oof, y, events)
    fit_branches(seq, features, y, events, np.arange(len(y)), np.arange(min(8, len(y))),
                 args.epochs, args.output / 'all-data-research')
    torch.save(final_gate.state_dict(), args.output / 'all-data-research' / 'gate.pt')
    import sklearn, xgboost
    report = {'version': 'scada-three-view-experiment-v1', 'seed': SEED, 'epochs': args.epochs,
              'software': {'numpy': np.__version__, 'pandas': pd.__version__, 'torch': torch.__version__,
                           'sklearn': sklearn.__version__, 'xgboost': xgboost.__version__},
              'final_gate_excluded_impossible_windows': final_excluded,
              'classes': CLASSES, 'signals': SIGNALS, 'windows': len(rows), 'assets': sorted(set(groups.tolist())),
              'coverage': {label: {'windows': int((y == c).sum()), 'assets': sorted(set(groups[y == c].tolist()))} for c, label in enumerate(CLASSES)},
              'validation': 'nested leave-one-asset-out; inner OOF gate; no test tuning',
              'limitations': ['SCADA ten-minute aggregates, not vibration or STFT', 'Event interval labels are not verified per-window fault onset', 'Missing training classes cannot be recognized', 'Research only; no production model replaced'],
              'metadata_sha256': sha256(args.farm / 'event_info.csv'), 'sources': sources,
              'rejected_windows': rejected, 'folds': folds, 'metrics': metrics,
              'predictions': [{'sample_id': r['sample_id'], 'asset': r['asset'], 'label': r['label'], 'probabilities': {name: p[i].tolist() for name, p in probabilities.items()}} for i, r in enumerate(rows)]}
    (args.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({name: m['macro_f1'] for name, m in metrics.items()}, indent=2), flush=True)


if __name__ == '__main__':
    main()
