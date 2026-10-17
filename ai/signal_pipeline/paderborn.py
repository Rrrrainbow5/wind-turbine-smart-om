"""Traceable adapter for the Paderborn Bearing Data Center MATLAB files."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import re
from typing import Any, Callable

import numpy as np

from .core import SignalInputError, SignalMetadata


DATASET_NAME = "Paderborn Bearing Data Center"
DATASET_URL = "https://mb.uni-paderborn.de/kat/forschung/bearing-datacenter"
DATASET_LICENSE = "CC BY-NC 4.0"
NOMINAL_SAMPLING_RATE_HZ = 64_000.0
DATA_ORIGIN = "EXTERNAL_PUBLIC"
SOURCE_UNIT_UNSPECIFIED = "source_unit_unspecified"

_FILENAME = re.compile(
    r"^(?P<condition>N\d+_M\d+_F\d+)_(?P<bearing>K[A-Z]?\d+)_(?P<run>\d+)\.mat$",
    re.IGNORECASE,
)
_LABELS = {
    "K001": "healthy",
    "K002": "healthy",
    "KA01": "bearing_outer_race",
    "KA03": "bearing_outer_race",
    "KI01": "bearing_inner_race",
    "KI03": "bearing_inner_race",
}
_REQUIRED_CHANNELS = ("vibration_1", "phase_current_1", "phase_current_2")


@dataclass(frozen=True)
class PaderbornSample:
    """One physical measurement shared by every waveform channel."""

    sample_id: str
    source_path: str
    source_sha256: str
    bearing_code: str
    fault_label: str
    operating_condition: str
    run_index: int
    split_group: str
    sampling_rate_hz: float
    source_sample_count: int
    timebase_resampled: bool
    source_gap_count: int
    max_source_gap_seconds: float
    channels: dict[str, np.ndarray]
    channel_units: dict[str, str]
    data_origin: str = DATA_ORIGIN
    dataset_name: str = DATASET_NAME
    license: str = DATASET_LICENSE

    def metadata_for(self, channel: str) -> SignalMetadata:
        if channel not in self.channels:
            raise SignalInputError(f"unknown Paderborn channel: {channel}")
        source_reference = (
            f"{DATASET_URL}; file={Path(self.source_path).name}; "
            f"sha256={self.source_sha256}; source_samples={self.source_sample_count}; "
            f"timebase_resampled={str(self.timebase_resampled).lower()}; "
            f"source_gap_count={self.source_gap_count}; "
            f"max_source_gap_seconds={self.max_source_gap_seconds:.9g}"
        )
        return SignalMetadata(
            sample_id=self.sample_id,
            data_origin=self.data_origin,
            sampling_rate_hz=self.sampling_rate_hz,
            unit=self.channel_units[channel],
            channel=channel,
            source_reference=source_reference,
        )


def file_sha256(path: str | Path, *, chunk_size: int = 1024 * 1024) -> str:
    digest = sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _scipy_loadmat(path: Path) -> dict[str, Any]:
    try:
        from scipy.io import loadmat
    except ImportError as exc:  # pragma: no cover - depends on deployment extras
        raise SignalInputError(
            "SciPy is required for Paderborn .mat files; install requirements-ai.txt"
        ) from exc
    return loadmat(path, squeeze_me=True, struct_as_record=False)


def _root_object(document: dict[str, Any], expected_name: str) -> Any:
    if expected_name in document:
        return document[expected_name]
    candidates = [value for key, value in document.items() if not key.startswith("__")]
    if len(candidates) != 1:
        raise SignalInputError("MAT file must contain exactly one measurement object")
    return candidates[0]


def _uniform_channel(root: Any, waveform: Any) -> tuple[np.ndarray, int, bool, int, float]:
    try:
        x_index = int(waveform.XIndex) - 1
        time = np.asarray(root.X[x_index].Data, dtype=float).reshape(-1)
        values = np.asarray(waveform.Data, dtype=float).reshape(-1)
    except (AttributeError, IndexError, TypeError, ValueError) as exc:
        raise SignalInputError("Paderborn time base is missing or malformed") from exc
    if time.size != values.size or time.size < 2 or not np.isfinite(time).all():
        raise SignalInputError("Paderborn time base and waveform lengths must match")
    if not np.all(np.diff(time) > 0):
        raise SignalInputError("Paderborn time base must be strictly increasing")
    duration = float(time[-1] - time[0])
    if duration <= 0:
        raise SignalInputError("Paderborn time base must be strictly increasing overall")
    gaps = np.diff(time)
    max_gap = float(np.max(gaps))
    if max_gap > 0.1:
        raise SignalInputError("Paderborn time base contains a gap larger than 0.1 seconds")
    source_gap_count = int(np.count_nonzero(gaps > 4.0 / NOMINAL_SAMPLING_RATE_HZ))

    target_intervals = int(round(duration * NOMINAL_SAMPLING_RATE_HZ))
    if target_intervals < 15:
        raise SignalInputError("Paderborn waveform duration is too short")
    target_time = np.linspace(time[0], time[-1], target_intervals + 1)
    timebase_resampled = time.size != target_time.size or not np.allclose(
        time,
        target_time,
        rtol=0.0,
        atol=0.05 / NOMINAL_SAMPLING_RATE_HZ,
    )
    if timebase_resampled:
        values = np.interp(target_time, time, values)
    return values, time.size, timebase_resampled, source_gap_count, max_gap


def load_paderborn_sample(
    path: str | Path,
    *,
    expected_sha256: str | None = None,
    loader: Callable[[Path], dict[str, Any]] | None = None,
) -> PaderbornSample:
    """Load and validate one public Paderborn measurement without relabelling units."""

    source = Path(path)
    match = _FILENAME.fullmatch(source.name)
    if not match:
        raise SignalInputError("unexpected Paderborn filename")
    bearing_code = match.group("bearing").upper()
    if bearing_code not in _LABELS:
        raise SignalInputError(f"unregistered Paderborn bearing code: {bearing_code}")

    digest = file_sha256(source)
    if expected_sha256 is not None and digest.lower() != expected_sha256.lower():
        raise SignalInputError("Paderborn source SHA-256 mismatch")

    document = (loader or _scipy_loadmat)(source)
    root = _root_object(document, source.stem)
    try:
        y_channels = {str(item.Name): item for item in np.atleast_1d(root.Y)}
    except AttributeError as exc:
        raise SignalInputError("Paderborn measurement channels are missing") from exc
    missing = [name for name in _REQUIRED_CHANNELS if name not in y_channels]
    if missing:
        raise SignalInputError(f"missing Paderborn channels: {', '.join(missing)}")

    channel_results = {
        name: _uniform_channel(root, y_channels[name]) for name in _REQUIRED_CHANNELS
    }
    channels = {name: result[0] for name, result in channel_results.items()}
    source_counts = {result[1] for result in channel_results.values()}
    if len(source_counts) != 1:
        raise SignalInputError("Paderborn source channel lengths do not match")
    lengths = {values.size for values in channels.values()}
    if len(lengths) != 1:
        raise SignalInputError("Paderborn resampled channel lengths do not match")
    if next(iter(lengths)) < 16 or not all(
        np.isfinite(values).all() for values in channels.values()
    ):
        raise SignalInputError("Paderborn waveforms must be finite and contain at least 16 samples")

    condition = match.group("condition").upper()
    run_index = int(match.group("run"))
    sample_id = (
        f"paderborn-{condition.lower().replace('_', '-')}-{bearing_code.lower()}-"
        f"r{run_index:02d}-{digest[:12]}"
    )
    return PaderbornSample(
        sample_id=sample_id,
        source_path=str(source),
        source_sha256=digest,
        bearing_code=bearing_code,
        fault_label=_LABELS[bearing_code],
        operating_condition=condition,
        run_index=run_index,
        split_group=f"paderborn-bearing-{bearing_code.lower()}",
        sampling_rate_hz=NOMINAL_SAMPLING_RATE_HZ,
        source_sample_count=next(iter(source_counts)),
        timebase_resampled=any(result[2] for result in channel_results.values()),
        source_gap_count=max(result[3] for result in channel_results.values()),
        max_source_gap_seconds=max(result[4] for result in channel_results.values()),
        channels=channels,
        channel_units={name: SOURCE_UNIT_UNSPECIFIED for name in _REQUIRED_CHANNELS},
    )
