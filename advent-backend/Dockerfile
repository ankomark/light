# The Streams API (Django + Daphne). Used by the load-test stack
# (loadtest/docker-compose.yml) and meant for the Hetzner app box.
#
#   docker build -t streams-api .
#
# Settings come from the environment at run time (DATABASE_URL, REDIS_URL,
# DJANGO_SECRET_KEY, ...): nothing secret is baked in (.dockerignore keeps
# .env out).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# psycopg2-binary and Pillow ship wheels; nothing to compile.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Not root at run time.
RUN useradd --create-home --uid 10001 app && chown -R app /app
USER app

# The HTTP API on Gunicorn (gunicorn.conf.py says why); run the websockets
# from the same image with: daphne -b 0.0.0.0 -p 8001 music.asgi:application
EXPOSE 8000 8001
CMD ["gunicorn", "music.wsgi:application", "-c", "gunicorn.conf.py"]
