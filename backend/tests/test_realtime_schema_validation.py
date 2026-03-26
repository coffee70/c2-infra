"""Schema validation tests for realtime ingest events."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.schemas import MeasurementEventBatch


def test_measurement_event_requires_channel_identifier() -> None:
    with pytest.raises(ValidationError):
        MeasurementEventBatch.model_validate(
            {
                "events": [
                    {
                        "source_id": "source-a",
                        "generation_time": "2026-03-26T12:00:00Z",
                        "value": 1.23,
                    }
                ]
            }
        )


def test_measurement_event_accepts_dynamic_field_tags_without_channel_name() -> None:
    batch = MeasurementEventBatch.model_validate(
        {
            "events": [
                {
                    "source_id": "source-a",
                    "generation_time": "2026-03-26T12:00:00Z",
                    "value": 1.23,
                    "tags": {"decoder": "APRS", "field_name": "Payload Temp"},
                }
            ]
        }
    )

    assert len(batch.events) == 1


def test_measurement_event_rejects_field_only_tags_without_namespace_context() -> None:
    with pytest.raises(ValidationError):
        MeasurementEventBatch.model_validate(
            {
                "events": [
                    {
                        "source_id": "source-a",
                        "generation_time": "2026-03-26T12:00:00Z",
                        "value": 1.23,
                        "tags": {"field_name": "Payload Temp"},
                    }
                ]
            }
        )
