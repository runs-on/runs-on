FROM golang:1.22 as build
ENV GOCACHE=/root/.gocache
ENV CGO_ENABLED=0

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

ENV RUNS_ON_ENV="prod"
ENV RUNS_ON_AGENT_FOLDER="/app/dist"

CMD ["/app/dist/server"]

