FROM python:3.11-alpine

WORKDIR /app

COPY . /app/simulator/

RUN pip install --no-cache-dir -r /app/simulator/requirements.txt 2>/dev/null || \
    (echo "fastapi>=0.100.0" > /tmp/req.txt && \
     echo "uvicorn[standard]>=0.22.0" >> /tmp/req.txt && \
     echo "requests>=2.28.0" >> /tmp/req.txt && \
     echo "pydantic>=2.0.0" >> /tmp/req.txt && \
     pip install --no-cache-dir -r /tmp/req.txt)

ENV BACKEND_URL=http://backend:8000
ENV PYTHONPATH=/app

EXPOSE 8001

CMD ["uvicorn", "simulator.main:app", "--host", "0.0.0.0", "--port", "8001"]
