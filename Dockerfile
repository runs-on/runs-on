FROM golang:1.22 as server
ENV GOCACHE=/root/.gocache
ENV CGO_ENABLED=0

WORKDIR /app
COPY server/go.* ./
RUN go mod download
COPY server/ ./
RUN --mount=type=cache,target=/root/.gocache GOOS=linux CGO_ENABLED=0 go build -o ./server

FROM golang:1.22 as agent
ENV GOCACHE=/root/.gocache
ENV CGO_ENABLED=0

WORKDIR /app/agent
COPY agent/go.* ./
RUN go mod download
COPY agent/ ./
RUN --mount=type=cache,target=/root/.gocache CGO_ENABLED=0 make build

FROM gcr.io/distroless/static-debian12

WORKDIR /app

# Copy the binary to the production image from the builder stage.
COPY --from=agent /app/agent/dist /app/agent/dist
COPY --from=server /app/server /app/server

ENV RUNS_ON_ENV="prod"
ENV RUNS_ON_AGENT_FOLDER="/app/agent/dist"

CMD ["/app/server"]

