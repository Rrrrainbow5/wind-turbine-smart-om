from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from ai.signal_pipeline import SignalInputError, analyze_signal, load_paderborn_sample


def _document(*, current_length: int = 32, time: np.ndarray | None = None) -> dict[str, object]:
    count = 32
    time = np.arange(count) / 64_000 if time is None else time
    x = np.array([SimpleNamespace(Data=time)], dtype=object)
    channels = np.array(
        [
            SimpleNamespace(Name="vibration_1", Data=np.linspace(-1, 1, count), XIndex=1),
            SimpleNamespace(Name="phase_current_1", Data=np.linspace(0, 2, current_length), XIndex=1),
            SimpleNamespace(Name="phase_current_2", Data=np.linspace(1, 3, count), XIndex=1),
        ],
        dtype=object,
    )
    return {"N15_M07_F10_K001_1": SimpleNamespace(X=x, Y=channels)}


def test_adapter_keeps_channels_under_one_traceable_sample(tmp_path) -> None:
    source = tmp_path / "N15_M07_F10_K001_1.mat"
    source.write_bytes(b"fixture")
    sample = load_paderborn_sample(source, loader=lambda _: _document())

    assert sample.data_origin == "EXTERNAL_PUBLIC"
    assert sample.sampling_rate_hz == 64_000
    assert sample.source_sample_count == 32
    assert sample.timebase_resampled is False
    assert sample.source_gap_count == 0
    assert sample.fault_label == "healthy"
    assert sample.split_group == "paderborn-bearing-k001"
    assert set(sample.channels) == {"vibration_1", "phase_current_1", "phase_current_2"}
    metadata = sample.metadata_for("vibration_1")
    assert metadata.sample_id == sample.sample_id
    assert metadata.unit == "source_unit_unspecified"
    assert sample.source_sha256 in metadata.source_reference
    assert "timebase_resampled=false" in metadata.source_reference
    result = analyze_signal(sample.channels["vibration_1"], metadata, n_fft=16)
    assert result["sample_id"] == sample.sample_id


def test_adapter_rejects_hash_mismatch_and_channel_length_mismatch(tmp_path) -> None:
    source = tmp_path / "N15_M07_F10_K001_1.mat"
    source.write_bytes(b"fixture")
    with pytest.raises(SignalInputError, match="SHA-256 mismatch"):
        load_paderborn_sample(source, expected_sha256="0" * 64, loader=lambda _: _document())
    with pytest.raises(SignalInputError, match="time base and waveform lengths must match"):
        load_paderborn_sample(source, loader=lambda _: _document(current_length=31))


def test_adapter_resamples_an_irregular_source_timebase(tmp_path) -> None:
    source = tmp_path / "N15_M07_F10_K002_1.mat"
    source.write_bytes(b"fixture")
    time = np.arange(32, dtype=float) / 64_000
    time[10:20] += 0.2 / 64_000
    sample = load_paderborn_sample(source, loader=lambda _: _document(time=time))

    assert sample.timebase_resampled is True
    assert sample.source_sample_count == 32
    assert len(sample.channels["vibration_1"]) == 32
    assert "timebase_resampled=true" in sample.metadata_for("vibration_1").source_reference


def test_adapter_records_source_timebase_gaps(tmp_path) -> None:
    source = tmp_path / "N15_M07_F10_KA03_1.mat"
    source.write_bytes(b"fixture")
    time = np.arange(32, dtype=float) / 64_000
    time[16:] += 5 / 64_000
    sample = load_paderborn_sample(source, loader=lambda _: _document(time=time))

    assert sample.timebase_resampled is True
    assert sample.source_gap_count == 1
    assert sample.max_source_gap_seconds > 4 / 64_000
    assert "source_gap_count=1" in sample.metadata_for("vibration_1").source_reference


@pytest.mark.parametrize(
    ("filename", "label"),
    [
        ("N15_M07_F10_K001_2.mat", "healthy"),
        ("N15_M07_F10_K002_2.mat", "healthy"),
        ("N15_M07_F10_KA01_2.mat", "bearing_outer_race"),
        ("N15_M07_F10_KA03_2.mat", "bearing_outer_race"),
        ("N15_M07_F10_KI01_2.mat", "bearing_inner_race"),
        ("N15_M07_F10_KI03_2.mat", "bearing_inner_race"),
    ],
)
def test_official_bearing_code_mapping(tmp_path, filename: str, label: str) -> None:
    source = tmp_path / filename
    source.write_bytes(filename.encode())
    root_name = source.stem
    document = _document()
    document[root_name] = document.pop("N15_M07_F10_K001_1")
    assert load_paderborn_sample(source, loader=lambda _: document).fault_label == label
