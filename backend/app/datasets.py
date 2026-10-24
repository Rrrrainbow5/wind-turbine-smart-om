import hashlib
import json
import math
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError, model_validator

router = APIRouter(prefix="/api/datasets", tags=["Dataset analysis"])


class Channel(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    unit: str = Field(min_length=1, max_length=40)
    samples: list[float] = Field(min_length=16, max_length=4096)


class Dataset(BaseModel):
    sample_id: str = Field(min_length=1, max_length=200)
    sampling_rate_hz: float = Field(gt=0, le=1000000, allow_inf_nan=False)
    data_origin: Literal["REAL", "EXTERNAL_PUBLIC", "SIMULATED"]
    source_reference: str = Field(min_length=1, max_length=500)
    channels: list[Channel] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def check_channels(self):
        if len({c.name for c in self.channels}) != len(self.channels):
            raise ValueError("Channel names must be unique")
        if len({len(c.samples) for c in self.channels}) != 1:
            raise ValueError("Channels must have equal sample lengths")
        if any(not math.isfinite(x) for c in self.channels for x in c.samples):
            raise ValueError("Samples must be finite")
        return self


@router.get("/experiments")
def experiments():
    path = Path(__file__).resolve().parents[2] / "examples/paderborn-neural-evaluation-v0.2.json"
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(503, "Evaluation report unavailable") from exc
    return {"result_kind": "HELD_OUT_EVALUATION", "live_inference": False,
            **{key: report[key] for key in ("predictions", "metrics", "model_version", "processing")}}


@router.post("/analyze")
async def analyze(request: Request):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 2 * 1024 * 1024:
            raise HTTPException(413, "Dataset JSON exceeds 2 MB")
    try:
        dataset = Dataset.model_validate_json(bytes(body))
    except ValidationError as exc:
        raise HTTPException(422, str(exc)[:1000]) from exc
    try:
        from ai.signal_pipeline.core import SignalMetadata, analyze_signal
    except ImportError as exc:
        raise HTTPException(503, "Install requirements-ai.txt to enable waveform processing") from exc
    channels = []
    for channel in dataset.channels:
        result = analyze_signal(channel.samples, SignalMetadata(
            dataset.sample_id, dataset.data_origin, dataset.sampling_rate_hz,
            channel.unit, channel.name, dataset.source_reference))
        # Return the actual detrended physical signal, not normalized amplitudes.
        import numpy as np
        x = np.asarray(channel.samples)
        index = np.arange(x.size)
        processed = x - np.polyval(np.polyfit(index, x, 1), index)
        channels.append({**result, "name": channel.name, "unit": channel.unit,
                         "raw": channel.samples, "processed": processed.tolist()})
    return {"sample_id": dataset.sample_id, "source_sha256": hashlib.sha256(body).hexdigest(),
            "data_origin": dataset.data_origin, "source_reference": dataset.source_reference,
            "sampling_rate_hz": dataset.sampling_rate_hz, "channels": channels,
            "model_status": "NOT_INFERRED", "live_inference": False}
