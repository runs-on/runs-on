# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Server Development (Go)
- `cd server && make lint` - Run golangci-lint on Go code
- `cd server && make test` - Run Go tests with race detection (requires .env file)
- `cd server && make agent` - Build agent binaries for all platforms (Linux arm64/x64, Windows x64)
- `cd server && make server` - Build server binary for Linux x64
- `make dev-run` - Run development server locally (requires AWS profile setup)

### Main Project
- `make pull` - Update git submodules
- `make dev` - Build and push development Docker image
- `make stage` - Build and push staging release
- `make bump` - Update version in CloudFormation templates
- `make dev-install` - Install development stack to AWS
- `make dev-smoke` - Run smoke tests against dev environment

### Testing
- `make test-smoke` - Run smoke tests
- `make dev-smoke` - Run development smoke tests
- Server tests require a `.env` file in the `server/` directory

## Architecture Overview

RunsOn is a self-hosted GitHub Actions runner service that provides cheaper, faster CI/CD by running ephemeral EC2 instances in your AWS account.

### Core Components

**Server (`server/cmd/server/`)**: Main service that:
- Receives GitHub webhook events for workflow jobs
- Manages EC2 fleet creation and scaling
- Handles runner registration with GitHub
- Provides web UI and metrics endpoints
- Manages caching layer (S3-based)

**Agent (`server/cmd/agent/`)**: Lightweight binary that runs on EC2 instances to:
- Bootstrap GitHub Actions runner
- Handle job execution lifecycle
- Manage local caching
- Report telemetry back to server

**CloudFormation Templates (`cloudformation/`)**: Infrastructure as code for:
- AWS App Runner service hosting the server
- IAM roles and permissions
- S3 buckets for caching and storage
- CloudWatch logging and monitoring
- VPC networking (optional)

### Key Packages

- `server/pkg/server/`: Core server logic (GitHub webhooks, EC2 fleet management, runner lifecycle)
- `server/pkg/agent/`: Agent bootstrap and runtime logic
- `server/pkg/common/`: Shared types and utilities
- `server/pkg/agent/cache/`: S3-based caching implementation (v1 and v2 protocols)

### Data Flow

1. GitHub sends webhook to server on workflow job events
2. Server parses job labels to determine runner requirements
3. Server creates EC2 fleet request with appropriate instance types
4. Agent bootstraps on launched instances and registers with GitHub
5. GitHub assigns job to runner, agent executes workflow
6. Instance terminates after job completion

### Configuration

- Job configuration via GitHub workflow labels (e.g., `runs-on="runs-on=${{ github.run_id }}/runner=2cpu-linux-x64"`)
- Stack configuration via CloudFormation parameters
- Server configuration via environment variables
- Runner specifications defined in `server/pkg/server/data/runners.yaml`

### CloudFormation Template Management

**IMPORTANT**: All CloudFormation template edits must be made in `cloudformation/template-dev.yaml`. Never edit versioned templates directly.

- Edit `cloudformation/template-dev.yaml` for all infrastructure changes
- Run `make bump` to propagate changes to versioned templates (`template-v2.x.x.yaml`)
- This ensures consistent versioning and proper release management

### Development Setup

Requires AWS account setup with appropriate profiles. See `DEVELOPMENT.md` for detailed setup instructions. Development uses isolated AWS account pattern (`runs-on-dev-USERNAME`).

### License Model

Main repository (CloudFormation) is MIT licensed. Server/agent code is proprietary requiring commercial license for business use.