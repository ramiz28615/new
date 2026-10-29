# Kovan motoru (pano + API + MCP sunucusu)
# Derle:   docker build -t kovan .
# Çalıştır: docker run --rm -p 127.0.0.1:7777:7777 -v kovan-data:/data -v "$PWD/projeler:/projects" kovan
# Not: Gerçek ajanlar için imaja `claude` / `codex` CLI'larını ve oturumlarını ayrıca eklemelisin;
#      eklenmezse yalnızca --mock (deneme) çalışmaları yapılabilir.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 kovan

WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY kovan ./kovan
RUN pip install --no-cache-dir .

ENV KOVAN_HOME=/data \
    KOVAN_PROJECTS_ROOT=/projects \
    PYTHONUNBUFFERED=1
RUN mkdir -p /data /projects && chown kovan:kovan /data /projects
USER kovan
VOLUME ["/data", "/projects"]
EXPOSE 7777

# Konteyner içinde 0.0.0.0'a bağlanır; dışarıya yalnızca 127.0.0.1 üzerinden yayınla (yukarıdaki -p örneği).
# Token: docker logs <konteyner> ya da /data/token
CMD ["kovan", "dashboard", "--host", "0.0.0.0", "--port", "7777"]
