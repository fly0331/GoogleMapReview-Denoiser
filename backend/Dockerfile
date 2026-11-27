
FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir ".[gemini]"

COPY app ./app

EXPOSE 10000

CMD ["python", "-m", "app.serve"]
