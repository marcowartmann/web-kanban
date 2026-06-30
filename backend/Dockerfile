FROM python:3.14-slim

WORKDIR /app

# Copy the backend source (.dockerignore excludes .venv, tests, caches, .env).
# app/, alembic/, alembic.ini and the entrypoint are all needed at runtime.
COPY . /app

# Installs declared dependencies + the `app` package (psycopg ships a binary
# wheel, so no system libpq / build toolchain is required).
RUN pip install --no-cache-dir .

RUN chmod +x docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
