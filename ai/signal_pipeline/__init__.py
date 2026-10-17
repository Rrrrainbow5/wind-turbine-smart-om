"""Reproducible signal processing primitives for the v0.2 B module."""

from .core import SignalInputError, analyze_signal, simulate_coupled_sample
from .paderborn import PaderbornSample, load_paderborn_sample

__all__ = [
    "PaderbornSample",
    "SignalInputError",
    "analyze_signal",
    "load_paderborn_sample",
    "simulate_coupled_sample",
]
