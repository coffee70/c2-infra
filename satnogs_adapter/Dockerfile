FROM python:3.11-slim

WORKDIR /app

COPY satnogs_adapter/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY satnogs_adapter /app/satnogs_adapter
COPY telemetry_catalog /app/telemetry_catalog
COPY vehicle-configurations /app/vehicle-configurations

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV VEHICLE_CONFIG_ROOT=/app/vehicle-configurations

CMD ["python", "-m", "satnogs_adapter.main", "--config", "/app/satnogs_adapter/config.example.yaml"]

