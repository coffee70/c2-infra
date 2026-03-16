FROM python:3.11-alpine

WORKDIR /app/simulator

COPY simulator /app/simulator
COPY telemetry_catalog /app/telemetry_catalog
COPY telemetry-definitions /app/telemetry-definitions

RUN pip install --no-cache-dir -r /app/simulator/requirements.txt 2>/dev/null || \
    (echo "fastapi>=0.100.0" > /tmp/req.txt && \
     echo "uvicorn[standard]>=0.22.0" >> /tmp/req.txt && \
     echo "requests>=2.28.0" >> /tmp/req.txt && \
     echo "pydantic>=2.0.0" >> /tmp/req.txt && \
     echo "pyyaml>=6.0.0" >> /tmp/req.txt && \
     pip install --no-cache-dir -r /tmp/req.txt)

ENV BACKEND_URL=http://backend:8000
ENV PYTHONPATH=/app:/app/simulator
ENV TELEMETRY_DEFINITIONS_ROOT=/app/telemetry-definitions

EXPOSE 8001

CMD ["uvicorn", "simulator.main:app", "--host", "0.0.0.0", "--port", "8001"]
