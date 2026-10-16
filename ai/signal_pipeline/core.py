"""Traceable waveform analysis; CARE SCADA aggregates are not waveform inputs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np


class SignalInputError(ValueError):
    """The supplied data cannot support waveform analysis."""


@dataclass(frozen=True)
class SignalMetadata:
    sample_id: str
    data_origin: str
    sampling_rate_hz: float
    unit: str
    channel: str
    source_reference: str | None = None


def _validate(values: np.ndarray, metadata: SignalMetadata) -> np.ndarray:
    if not metadata.sample_id.strip() or not metadata.channel.strip() or not metadata.unit.strip():
        raise SignalInputError("sample_id, channel and unit are required")
    if metadata.data_origin not in {"REAL", "EXTERNAL_PUBLIC", "SIMULATED", "REFERENCE"}:
        raise SignalInputError(
            "waveform origin must be REAL, EXTERNAL_PUBLIC, SIMULATED or REFERENCE"
        )
    if metadata.data_origin != "SIMULATED" and not metadata.source_reference:
        raise SignalInputError("non-simulated waveforms require source_reference")
    if values.ndim != 1 or values.size < 16:
        raise SignalInputError("waveform must contain at least 16 one-dimensional samples")
    if not np.isfinite(values).all():
        raise SignalInputError("waveform contains NaN or infinite values")
    if (metadata.sampling_rate_hz is None or not isinstance(metadata.sampling_rate_hz, (int, float))
            or not np.isfinite(metadata.sampling_rate_hz) or metadata.sampling_rate_hz <= 0):
        raise SignalInputError("a positive finite sampling_rate_hz is required")
    return values.astype(float, copy=False)


def _stats(x: np.ndarray) -> dict[str, float]:
    mean = float(np.mean(x))
    centered = x - mean
    std = float(np.std(x))
    rms = float(np.sqrt(np.mean(x * x)))
    return {
        "mean": mean, "variance": float(np.var(x)), "std": std, "rms": rms,
        "skewness": float(np.mean(centered ** 3) / std ** 3) if std else 0.0,
        "kurtosis": float(np.mean(centered ** 4) / std ** 4) if std else 0.0,
        "peak_to_peak": float(np.ptp(x)), "peak": float(np.max(np.abs(x))),
        "crest_factor": float(np.max(np.abs(x)) / rms) if rms else 0.0,
    }


def _power_spectrum(x: np.ndarray, fs: float) -> dict[str, Any]:
    window = np.hanning(x.size)
    power = np.abs(np.fft.rfft(x * window)) ** 2 / (fs * np.sum(window ** 2))
    power[1:-1 if x.size % 2 == 0 else None] *= 2
    return {"frequency_hz": np.fft.rfftfreq(x.size, 1 / fs).tolist(),
            "power_density": power.tolist(), "power_density_unit": "unit^2/Hz"}


def _stft(x: np.ndarray, fs: float, size: int) -> dict[str, Any]:
    hop = max(1, size // 2)
    starts = list(range(0, x.size - size + 1, hop))
    if starts[-1] != x.size - size:
        starts.append(x.size - size)
    frames = np.stack([x[start:start + size] for start in starts])
    window = np.hanning(size)
    power = np.abs(np.fft.rfft(frames * window, axis=1)) ** 2 / (fs * np.sum(window ** 2))
    power[:, 1:-1 if size % 2 == 0 else None] *= 2
    return {"time_s": [float((start + size / 2) / fs) for start in starts],
            "frequency_hz": np.fft.rfftfreq(size, 1 / fs).tolist(),
            "power_density": power.tolist(), "power_density_unit": "unit^2/Hz"}


def _haar_packet_energy(x: np.ndarray, levels: int = 3) -> dict[str, Any]:
    block = 2 ** levels
    nodes = [np.pad(x, (0, (-x.size) % block))]
    for _ in range(levels):
        children = []
        for node in nodes:
            children.extend(((node[::2] + node[1::2]) / np.sqrt(2),
                             (node[::2] - node[1::2]) / np.sqrt(2)))
        nodes = children
    return {"method": "orthonormal Haar wavelet packet", "levels": levels,
            "node_order": "packet-tree", "energy": [float(np.sum(node ** 2)) for node in nodes]}


def _envelope_spectrum(x: np.ndarray, fs: float) -> dict[str, Any]:
    multiplier = np.zeros(x.size)
    multiplier[0] = 1
    multiplier[1:(x.size + 1) // 2] = 2
    if x.size % 2 == 0:
        multiplier[x.size // 2] = 1
    envelope = np.abs(np.fft.ifft(np.fft.fft(x) * multiplier))
    return _power_spectrum(envelope - envelope.mean(), fs)


def feature_frequency_formulas(*, shaft_speed_rpm: float | None = None,
                               gear_teeth: int | None = None,
                               bearing: dict[str, float] | None = None) -> list[dict[str, Any]]:
    definitions = [
        ("1X", "f_r = shaft_speed_rpm / 60"), ("2X", "2 * f_r"),
        ("GMF", "gear_teeth * f_r"),
        ("BPFO", "n/2 * f_r * (1 - d/D * cos(theta))"),
        ("BPFI", "n/2 * f_r * (1 + d/D * cos(theta))"),
        ("BSF", "D/(2*d) * f_r * (1 - (d/D*cos(theta))^2)"),
        ("FTF", "1/2 * f_r * (1 - d/D * cos(theta))"),
    ]
    result = [{"name": name, "formula": formula, "hz": None} for name, formula in definitions]
    if shaft_speed_rpm is None:
        return result
    if (not isinstance(shaft_speed_rpm, (int, float)) or not np.isfinite(shaft_speed_rpm)
            or shaft_speed_rpm <= 0):
        raise SignalInputError("shaft_speed_rpm must be positive and finite")
    fr = shaft_speed_rpm / 60
    result[0]["hz"], result[1]["hz"] = fr, 2 * fr
    if gear_teeth is not None:
        if isinstance(gear_teeth, bool) or not isinstance(gear_teeth, int) or gear_teeth <= 0:
            raise SignalInputError("gear_teeth must be a positive integer")
        result[2]["hz"] = gear_teeth * fr
    if bearing is not None:
        try:
            n, d, diameter, theta = (float(bearing[key]) for key in ("n", "d", "D", "theta_rad"))
        except (KeyError, TypeError, ValueError) as exc:
            raise SignalInputError("bearing requires n, d, D and theta_rad") from exc
        if not all(np.isfinite(v) for v in (n, d, diameter, theta)) or n <= 0 or d <= 0 or diameter <= d:
            raise SignalInputError("invalid bearing geometry")
        ratio = d / diameter * np.cos(theta)
        result[3]["hz"] = n / 2 * fr * (1 - ratio)
        result[4]["hz"] = n / 2 * fr * (1 + ratio)
        result[5]["hz"] = diameter / (2 * d) * fr * (1 - ratio ** 2)
        result[6]["hz"] = fr / 2 * (1 - ratio)
    return result


def analyze_signal(values: list[float] | np.ndarray, metadata: SignalMetadata, *,
                   n_fft: int = 256, shaft_speed_rpm: float | None = None,
                   gear_teeth: int | None = None,
                   bearing: dict[str, float] | None = None) -> dict[str, Any]:
    x = _validate(np.asarray(values, dtype=float), metadata)
    if isinstance(n_fft, bool) or not isinstance(n_fft, int) or n_fft < 16:
        raise SignalInputError("n_fft must be an integer of at least 16")
    index = np.arange(x.size)
    detrended = x - np.polyval(np.polyfit(index, x, 1), index)
    scale = float(np.std(detrended))
    fs = float(metadata.sampling_rate_hz)
    size = min(n_fft, x.size)
    return {
        "sample_id": metadata.sample_id, "metadata": asdict(metadata),
        "processing": {"detrend": "linear", "normalization": "z-score for model input only",
                       "normalization_scale": scale, "transforms_input": "detrended physical waveform",
                       "window": "hann", "stft_window_samples": size},
        "statistics": _stats(x), "statistics_stage": "raw waveform",
        "processed_statistics": _stats(detrended),
        "transforms": {"fft": _power_spectrum(detrended, fs),
                       "stft": _stft(detrended, fs, size),
                       "wavelet_packet": _haar_packet_energy(detrended),
                       "envelope_spectrum": _envelope_spectrum(detrended, fs)},
        "feature_frequencies": feature_frequency_formulas(
            shaft_speed_rpm=shaft_speed_rpm, gear_teeth=gear_teeth, bearing=bearing),
        "model": {"status": "NOT_INFERRED"},
    }


def simulate_coupled_sample(*, sample_id: str, fault_type: str, severity: float,
                            sampling_rate_hz: float = 2000.0, duration_s: float = 1.0,
                            seed: int = 7) -> dict[str, Any]:
    if not np.isfinite(severity) or not 0 <= severity <= 1:
        raise SignalInputError("severity must be between 0 and 1")
    if not np.isfinite(duration_s) or duration_s <= 0:
        raise SignalInputError("duration_s must be positive")
    if not np.isfinite(sampling_rate_hz) or sampling_rate_hz <= 0:
        raise SignalInputError("sampling_rate_hz must be positive")
    if fault_type not in {"bearing_outer_race", "unbalance", "misalignment", "gear_tooth_break", "stator_imbalance"}:
        raise SignalInputError("unsupported simulated fault_type")
    count = int(duration_s * sampling_rate_hz)
    if not 16 <= count <= 200_000:
        raise SignalInputError("sample length must be between 16 and 200000")
    rng = np.random.default_rng(seed)
    time = np.arange(count) / sampling_rate_hz
    pattern_hz = {"bearing_outer_race": 30, "unbalance": 30, "misalignment": 60,
                  "gear_tooth_break": 90, "stator_imbalance": 70}[fault_type]
    phase = np.sin(2 * np.pi * pattern_hz * time)
    defect = phase ** 8 if fault_type in {"bearing_outer_race", "gear_tooth_break"} else phase
    shared_fault = severity * defect
    vibration_gain = 0.2 if fault_type == "stator_imbalance" else 1.0
    current_gain = 1.0 if fault_type == "stator_imbalance" else 0.3
    vibration = (np.sin(2 * np.pi * 30 * time) + vibration_gain * shared_fault
                 + rng.normal(0, 0.03 + 0.08 * severity, count))
    current = (2 * np.sin(2 * np.pi * 10 * time) + current_gain * shared_fault
               + rng.normal(0, 0.02 + 0.04 * severity, count))
    analyses = {
        channel: analyze_signal(values, SignalMetadata(sample_id, "SIMULATED", sampling_rate_hz, unit, channel))
        for channel, values, unit in (("vibration", vibration, "g"), ("current", current, "A"))
    }
    return {
        "sample_id": sample_id, "data_origin": "SIMULATED", "fault_type": fault_type,
        "severity": severity, "seed": seed, "sampling_rate_hz": sampling_rate_hz,
        "signals": {"vibration": vibration.tolist(), "current": current.tolist()},
        "analysis": analyses,
        "coupled_parameters": {"temperature_delta_c": round(8 * severity, 4),
                               "power_loss_fraction": round(0.18 * severity, 4),
                               "noise_scale": round(0.03 + 0.08 * severity, 4)},
        "model": {"status": "NOT_INFERRED"},
    }
