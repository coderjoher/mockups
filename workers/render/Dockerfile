# Build from the repository root: docker build -f workers/render/Dockerfile .
FROM python:3.13-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl fontconfig libfribidi0 libraqm0 && rm -rf /var/lib/apt/lists/*
COPY scripts/install-fonts.sh /tmp/install-fonts.sh
RUN bash /tmp/install-fonts.sh
COPY workers/render/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY workers/render/mockup_render mockup_render
CMD ["python", "-m", "mockup_render.worker"]
