FROM python:3.14-slim

WORKDIR /app

# pg_dump (v18, matching the server) for database backups, from the PGDG repo.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
 && rm -rf /var/lib/apt/lists/*

# Copy the backend source (.dockerignore excludes .venv, tests, caches, .env).
# app/, alembic/, alembic.ini and the entrypoint are all needed at runtime.
COPY . /app

# Installs declared dependencies + the `app` package (psycopg ships a binary
# wheel, so no system libpq / build toolchain is required).
RUN pip install --no-cache-dir .

RUN chmod +x docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
