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
    turbine_id: str | None = Field(default=None, max_length=80)
    event_id: str | int | None = None
    event_name: str | None = Field(default=None, max_length=300)
    fault_category: str | None = Field(default=None, max_length=80)
    component_id: str | None = Field(default=None, max_length=120)

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
    event = _event_reference(dataset)
    return {"sample_id": dataset.sample_id, "source_sha256": hashlib.sha256(body).hexdigest(),
            "data_origin": dataset.data_origin, "source_reference": dataset.source_reference,
            "sampling_rate_hz": dataset.sampling_rate_hz, "channels": channels,
            "model_status": "NOT_INFERRED", "live_inference": False,
            "analysis_mode": "EVENT_LABEL_REFERENCE" if event["event_name"] else "SIGNAL_PROCESSING_ONLY",
            "event_analysis": event}


def _event_reference(dataset: Dataset) -> dict[str, object]:
    name = (dataset.event_name or "").strip()
    raw = f"{dataset.fault_category or ''} {name}".lower()
    categories = (("ROTOR_BEARING", ("rotor bearing", "转子轴承", "main bearing", "主轴承")), ("GEARBOX_BEARING", ("gearbox bearing", "齿轮箱轴承")), ("GEARBOX", ("gearbox", "齿轮箱", "gear")), ("GENERATOR", ("generator", "发电机")), ("CONVERTER", ("converter", "变流器")), ("TRANSFORMER", ("transformer", "变压器")), ("HYDRAULIC", ("hydraulic", "液压")), ("PITCH", ("pitch", "变桨")), ("YAW", ("yaw", "偏航")))
    category = dataset.fault_category or next((key for key, words in categories if any(word in raw for word in words)), None)
    healthy = not name and not category
    return {"event_id": str(dataset.event_id) if dataset.event_id is not None else None, "event_name": name or None, "fault_category": category or ("NORMAL" if healthy else "OTHER"), "component_id": dataset.component_id, "turbine_id": dataset.turbine_id, "mapping_status": "UNVERIFIED" if category and not dataset.component_id else ("CANDIDATE" if dataset.component_id else "UNMAPPED"), "evidence_channels": [channel.name for channel in dataset.channels], "warning_level": "NORMAL" if healthy else "MEDIUM", "maintenance_summary": "继续监测并记录基线" if healthy else "核验事件标签与采集位置后安排现场检查", "notice": "事件标签参考，不是模型自动推理；CARE 聚合数据不等同于高频原始波形。"}
