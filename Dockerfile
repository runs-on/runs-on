FROM golang:1.22 as server
ENV GOCACHE=/root/.gocache
ENV CGO_ENABLED=0

WORKDIR /app
COPY server/go.* ./
RUN go mod download
COPY server/ ./
RUN --mount=type=cache,target=/root/.gocache GOOS=linux go build -o ./server

FROM golang:1.22 as agent
ENV GOCACHE=/root/.gocache
ENV CGO_ENABLED=0

WORKDIR /app/agent
COPY agent/go.* ./
RUN go mod download
COPY agent/ ./
RUN --mount=type=cache,target=/root/.gocache make build

# Use the official Debian slim image for a lean production container.
# https://hub.docker.com/_/debian
FROM debian:buster-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /app/agent/

# Copy the binary to the production image from the builder stage.
COPY --from=server /app/server /app/server
COPY --from=agent /app/agent/dist /app/agent/dist

ENV RUNS_ON_ENV="prod"
ENV RUNS_ON_AGENT_FOLDER="/app/agent/dist"

CMD ["/app/server"]

