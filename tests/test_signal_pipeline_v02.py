import numpy as np
import pytest

from ai.signal_pipeline import SignalInputError, analyze_signal, simulate_coupled_sample
from ai.signal_pipeline.core import SignalMetadata, feature_frequency_formulas


def test_pipeline_keeps_one_sample_id_and_returns_transforms() -> None:
    result = analyze_signal(np.sin(np.arange(512) / 10), SignalMetadata("s-1", "SIMULATED", 1000, "g", "vibration"))
    assert result["sample_id"] == "s-1"
    assert "fft" in result["transforms"] and "stft" in result["transforms"]


def test_aggregate_and_missing_sampling_rate_are_rejected() -> None:
    with pytest.raises(SignalInputError, match="origin"):
        analyze_signal([1] * 20, SignalMetadata("care-1", "DERIVED", None, "g", "sensor_11_avg"))
    with pytest.raises(SignalInputError, match="sampling_rate"):
        analyze_signal([1] * 20, SignalMetadata("sim-1", "SIMULATED", None, "g", "vibration"))


def test_missing_geometry_does_not_invent_hz() -> None:
    formulas = feature_frequency_formulas(shaft_speed_rpm=1500)
    assert formulas[0]["hz"] == 25
    assert next(item for item in formulas if item["name"] == "GMF")["hz"] is None


def test_simulator_is_explicit_and_coupled() -> None:
    sample = simulate_coupled_sample(sample_id="sim-1", fault_type="bearing_outer_race", severity=.7, duration_s=.1)
    assert sample["data_origin"] == "SIMULATED"
    assert sample["analysis"]["vibration"]["sample_id"] == sample["sample_id"]
    assert sample["coupled_parameters"]["temperature_delta_c"] > 0
    with pytest.raises(SignalInputError, match="unsupported"):
        simulate_coupled_sample(sample_id="sim-2", fault_type="unknown", severity=.7)


def test_spectrum_and_wavelet_energy_follow_input() -> None:
    fs = 1024
    waveform = 3 + 2 * np.sin(2 * np.pi * 64 * np.arange(fs) / fs)
    result = analyze_signal(waveform, SignalMetadata("s-2", "SIMULATED", fs, "g", "vibration"))
    spectrum = result["transforms"]["fft"]
    peak = np.argmax(spectrum["power_density"][1:]) + 1
    assert spectrum["frequency_hz"][peak] == 64
    assert result["statistics"]["mean"] == pytest.approx(3)
    assert result["statistics"]["rms"] == pytest.approx(np.sqrt(11))
    packet_energy = sum(result["transforms"]["wavelet_packet"]["energy"])
    assert packet_energy == pytest.approx(result["processed_statistics"]["variance"] * fs)


def test_bearing_frequency_requires_geometry() -> None:
    formulas = feature_frequency_formulas(shaft_speed_rpm=600, bearing={"n": 8, "d": .01, "D": .05, "theta_rad": 0})
    assert next(item for item in formulas if item["name"] == "BPFO")["hz"] == pytest.approx(32)
    with pytest.raises(SignalInputError, match="bearing requires"):
        feature_frequency_formulas(shaft_speed_rpm=600, bearing={"BPFO": 3.2})
