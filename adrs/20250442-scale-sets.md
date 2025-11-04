## Purpose

Use the new Actions Service and the Runner Scale Set concept to listen for new jobs, instead of relying on the current webhook-based machanism. This comes in addition, for the specific need of having warm pools.


## Overview

- Idea: map existing EC2 auto-scaling groups to a corresponding scale set.

Tasks:

- Regularly (every minute), inspect existing ASG groups that are tagged (`runs-on-stack`) with the current stack name.
- For each of those ASG, fetch the target organization (`runs-on-org` tag), and scaleset name (`runs-on-pool` tag) from its tags. This is used to construct the final scaleset name: `ORG-POOL`.
- Check with the Actions Service if that scale set name already exists. If not, create it, and launch a listener goroutine for that scaleset. Keep track of running goroutines. If it already exists, make sure the goroutine is still active. If not, relaunch it.
- When a new job comes in, 

- In the ser defines at least one scale set definition with `instance_type` (string), `size_min` (int, default 0), `size_max` (int, default 20).
- 

You're referring to the **native GitHub Actions Runner Scale Sets feature** and its underlying API mechanism, which is distinct from the Actions Runner Controller (ARC) and its webhook-based approach.

Here's what I know about *that* system:

1.  **Purpose:** This native feature allows organizations and enterprises to build custom autoscaling solutions for their self-hosted runners without relying solely on Kubernetes or the specific implementation details of ARC. It's designed to be more infrastructure-agnostic.

2.  **Core Mechanism: Long Polling:** Instead of GitHub pushing webhook events *to* your infrastructure, your infrastructure runs a **listener** application. This listener actively **long polls** specific endpoints on the GitHub Actions Service API.
    *   The listener essentially asks the Actions Service, "Are there any jobs queued for the runner scale set I'm responsible for?"
    *   If there are no jobs, the connection stays open (long poll) until a job arrives or a timeout occurs, at which point the listener immediately re-polls.
    *   If jobs *are* available, the API responds with details about the required job(s).

3.  **The Listener's Role:**
    *   **Polling:** Continuously polls the Actions Service API for job messages.
    *   **Acquiring Jobs:** When jobs are available, the listener "acquires" a message lease from the service for a specific duration. This prevents other listeners for the same scale set from picking up the same job message.
    *   **Scaling Infrastructure:** Based on the received job messages (demand), the listener triggers **your** infrastructure scaling mechanism. This could be:
        *   Scaling up a Virtual Machine Scale Set (VMSS) in Azure.
        *   Scaling up an Auto Scaling Group (ASG) in AWS.
        *   Adjusting replicas in a Kubernetes deployment (though ARC is often preferred here, this method *could* be used).
        *   Any other custom infrastructure scaling logic.
    *   **Starting Runners:** The scaling action results in new compute instances (VMs, containers) being started. Each new instance starts the Actions runner agent software.
    *   **Runner Registration:** The newly started runner agent registers itself with GitHub (using a standard registration token, likely obtained via the REST API by the listener or instance startup script) as an ephemeral runner belonging to that scale set.
    *   **Job Execution:** The runner picks up the job it was effectively scaled up for.
    *   **Deleting Messages:** Once the job is assigned to a specific runner agent, the listener tells the Actions Service API to delete the corresponding job message it acquired, confirming it's being handled.

4.  **Key API Concepts/Endpoints (Conceptual - based on documented patterns):**
    *   **Authentication:** Typically uses a GitHub App with specific permissions related to runner scale sets.
    *   **Message Acquisition:** An endpoint like `AcquireJob` or `GetMessage` (actual names might differ slightly) that the listener polls. It returns job details and a message lease ID/receipt handle.
    *   **Message Deletion:** An endpoint like `DeleteMessage` where the listener provides the message ID/receipt handle to remove it from the queue once scaling is initiated or the job is confirmed assigned.
    *   **Runner Registration:** Still uses the standard `POST .../actions/runners/registration-token` REST API endpoint, likely called by the listener or the runner instance itself during startup.

5.  **Benefits over Webhooks (for some use cases):**
    *   **No Public Ingress Required:** Your listener initiates outbound connections; you don't need to expose a public webhook endpoint, which can simplify network security.
    *   **Infrastructure Agnostic:** Works with any scaling mechanism you can trigger programmatically, not tied to Kubernetes CRDs like ARC.
    *   **Potentially Faster Response:** Long polling can sometimes detect queued jobs slightly faster than waiting for a webhook delivery, depending on network conditions and GitHub's internal event bus.

**In summary:** Yes, the system you describe exists. It's the native GitHub Actions Runner Scale Set mechanism. It relies on a **customer-hosted listener** performing **long polling** against specific **Actions Service API endpoints** to detect job demand and then triggering the **customer's own infrastructure scaling logic** to add ephemeral runners. This bypasses the need for webhook reception.

This is indeed a newer and more flexible way for organizations to integrate GitHub Actions runner scaling deeply into their specific infrastructure platforms.