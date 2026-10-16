"""Reproducible signal processing primitives for the v0.2 B module."""

from .core import SignalInputError, analyze_signal, simulate_coupled_sample

__all__ = ["SignalInputError", "analyze_signal", "simulate_coupled_sample"]
