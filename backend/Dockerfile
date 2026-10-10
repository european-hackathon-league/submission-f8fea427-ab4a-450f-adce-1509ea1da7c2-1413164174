FROM python:3.14.8-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS dependencies
RUN pip install --no-cache-dir uv==0.13.0
WORKDIR /srv/backend
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen
ENV PATH="/srv/backend/.venv/bin:$PATH"
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--limit-concurrency", "20"]

FROM dependencies AS parser-dependencies
RUN uv sync --frozen --extra pdf
RUN python -c "import torch; import torchvision; from docling.document_converter import DocumentConverter; assert not torch.cuda.is_available()"

FROM dependencies AS runtime
COPY app ./app
COPY tests ./tests
COPY migrations ./migrations
COPY alembic.ini ./
COPY parser_models.json ./

FROM parser-dependencies AS parser
COPY app ./app
COPY tests ./tests
COPY migrations ./migrations
COPY alembic.ini parser_models.json ./
