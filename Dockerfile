FROM golang:1.22 AS build
ENV GOCACHE=/root/.gocache
ENV CGO_ENABLED=0
ENV UPX_VERSION=4.2.4

RUN apt-get update && apt-get install -y xz-utils

# https://upx.github.io/
RUN curl -L https://github.com/upx/upx/releases/download/v${UPX_VERSION}/upx-${UPX_VERSION}-amd64_linux.tar.xz -o upx-${UPX_VERSION}-amd64_linux.tar.xz && \
    tar -xf upx-${UPX_VERSION}-amd64_linux.tar.xz && \
    mv upx-${UPX_VERSION}-amd64_linux/upx /usr/local/bin/upx

WORKDIR /app
COPY server/go.* ./
RUN go mod download
COPY server/ ./
RUN --mount=type=cache,target=/root/.gocache make server
RUN --mount=type=cache,target=/root/.gocache make agent

FROM gcr.io/distroless/static-debian12

WORKDIR /app

# Copy the binary to the production image from the builder stage.
COPY --from=build /app/dist /app/dist

ENV RUNS_ON_AGENT_FOLDER="/app/dist"

CMD ["/app/dist/server"]