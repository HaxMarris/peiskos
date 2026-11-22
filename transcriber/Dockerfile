# whisper.cpp's server, which writes out what was said on fire tapes. Peiskos sends it one person's
# audio at a time, overnight; nothing leaves this machine. See "Fire tapes" in the README.
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
ARG WHISPER_VERSION=v1.8.4
RUN git clone --depth 1 --branch ${WHISPER_VERSION} https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
  && cmake --build build -j --target whisper-server
# "base" understands most languages and fits beside Peiskos and LiveKit on a 4 GB server.
# "small" is more accurate and needs about 1 GB more (set WHISPER_MODEL in .env, then rebuild).
ARG WHISPER_MODEL=base
RUN sh models/download-ggml-model.sh ${WHISPER_MODEL}

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/* \
  && useradd --system whisper
ARG WHISPER_MODEL=base
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=build /src/models/ggml-${WHISPER_MODEL}.bin /models/model.bin
USER whisper
EXPOSE 8080
CMD ["whisper-server", "--host", "0.0.0.0", "--port", "8080", "-m", "/models/model.bin", "-t", "2"]
