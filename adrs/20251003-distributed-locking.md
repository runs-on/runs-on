# Distributed Locking with DynamoDB

**Date:** 2025-10-03
**Status:** Implemented
**Updated:** 2025-10-10

## Summary

RunsOn uses **DynamoDB-based leader election** to coordinate background processes across multiple App Runner instances, preventing race conditions, API rate limit issues, and duplicate work.

**Protected Operations:**
- Pool convergence (every 30s)
- Webhook redelivery (every 5 minutes)

**Key Benefits:**
- Single leader instance executes background tasks
- Automatic failover on leader failure (60s lease)
- Minimal cost (~$0.01-0.05/month)
- Eliminated Lambda overhead for webhook redelivery

## Problem

RunsOn runs multiple App Runner instances for high availability. Without coordination, background processes executing on all instances simultaneously cause:

- **Race conditions** - Duplicate EC2 instance creation/termination
- **API exhaustion** - EC2 and GitHub rate limits exceeded
- **Wasted resources** - Duplicate webhook processing
- **Inconsistent state** - Conflicting pool management decisions

## Solution

### Leader Election Pattern

Use a single leader election mechanism instead of per-operation locks:

- **Single leader** - One instance executes all background tasks
- **Automatic failover** - New leader elected if current leader fails
- **Lease-based** - 60s lease with 20s heartbeat renewals
- **Simple reasoning** - Clear ownership of background operations

### Scope of Leader Election

**Requires coordination** (uses leader election):
- **Pool convergence** - EC2 instance lifecycle management to avoid race conditions
- **Webhook redelivery** - Failed webhook processing to prevent duplicates

**Already coordinated** (doesn't need leader election):
- **SQS processors** - Visibility timeout provides natural distributed coordination
- **Config updates** - Checkpoint-based, safe for concurrent execution
- **Webhook ingestion** - Stateless, idempotent webhook handling

## Architecture

### System Components

**DynamoDB Locks Table**
- Single hash key table with TTL enabled
- PAY_PER_REQUEST billing for cost efficiency
- Stores leader lock with automatic expiration

**Lock Coordinator**
- Runs on each App Runner instance
- Attempts lock acquisition every 30s
- Renews lock every 20s with 60s lease duration
- Detects lock loss and steps down gracefully

**Background Workers**
- Pool convergence (30s interval)
- Webhook redelivery (5min interval)
- Only execute on leader instance

### Leader Election Flow

**Normal Operation:**
1. Instance A acquires leader lock from DynamoDB
2. Instance B attempts lock, sees it's held, remains follower
3. Instance A renews lock every 20s via heartbeat
4. Instance B retries every 30s, remains follower
5. Only Instance A executes background tasks

**Failover:**
1. Instance A crashes or loses connectivity
2. Lock expires after 60s without heartbeat
3. Instance B acquires lock on next retry
4. Instance B becomes leader, begins executing background tasks

**Recovery:**
- Maximum failover time: 60s (lease duration)
- Graceful: Lock holder detects expiration and steps down immediately
- Network partition tolerance: 40s of network issues before failover

### Local Development

Local environments use a no-op coordinator that always returns "leader" status, eliminating DynamoDB dependency for development.

## Design Decisions

### Why Leader Election vs Per-Operation Locks?

**Leader election wins because:**
- **Simpler** - Single lock vs multiple locks per operation
- **Cheaper** - Fewer DynamoDB operations (~6K/day vs 100K+/day)
- **Clearer** - Obvious which instance owns background tasks
- **Safer** - No risk of partial lock acquisition failures

**Tradeoff:**
- All background work pauses during leader transition
- Acceptable because tasks are periodic (30s-5min intervals)

### Why 60s Lease Duration?

- **Long enough** - Tolerates temporary network issues (up to 40s)
- **Short enough** - Quick failover on real instance failure
- **Proven** - Standard lease duration for distributed systems

### Why DynamoDB vs Other Options?

**vs Redis:**
- No operational overhead (managed service)
- No separate infrastructure to maintain
- Better cost model for low-frequency operations

**vs etcd/Consul:**
- Simpler - No cluster management
- Cheaper - Pay-per-request vs always-on infrastructure

**vs Application-level coordination:**
- More reliable than custom protocols
- Battle-tested library (cirello.io/dynamolock)

## Cost Model

**DynamoDB Operations:**
- Lock attempts: 2 instances × 2,880 attempts/day = 5,760 reads/day
- Heartbeats: 1 leader × 4,320 heartbeats/day = 4,320 writes/day
- Total: ~$0.01-0.05/month

**Savings:**
- Eliminated Lambda for webhook redelivery: ~$0.10/month
- Reduced EC2 API rate limit exhaustion incidents
- Prevented duplicate instance creation costs

## Operational Considerations

**Monitoring:**
- Track leader transitions (should be rare)
- Alert on frequent failovers (indicates instability)
- Monitor background task execution gaps

**Failure Modes:**
- **DynamoDB unavailable:** All instances become followers, background tasks pause
- **Network partition:** Potential split-brain until lease expires (max 60s)
- **Instance crash:** Automatic failover within 60s

**Scalability:**
- Supports arbitrary number of App Runner instances
- DynamoDB can handle 100+ competing instances
- No additional coordination needed as fleet grows

## Historical Context

### Webhook Redelivery Migration (2025-10-03)

Previously, webhook redelivery was handled by a separate Lambda function triggered every 5 minutes via EventBridge. This was migrated to a background process in the main server, protected by leader election.

**Benefits:**
- Simplified deployment (no separate Lambda build)
- Shared clients (S3, SNS, GitHub) - no duplication
- Better observability (logs in App Runner)
- Cost savings (~$0.10/month Lambda invocations eliminated)
