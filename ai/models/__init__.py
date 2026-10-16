"""Model contracts and leakage-safe evaluation helpers for v0.2."""

from .hybrid import (
    HybridDiagnosticModel,
    HybridFeatureSet,
    SignalRecord,
    grouped_train_test_split,
)
from .evaluation import evaluate_hybrid_model

__all__ = [
    "HybridDiagnosticModel",
    "HybridFeatureSet",
    "SignalRecord",
    "grouped_train_test_split",
    "evaluate_hybrid_model",
]
