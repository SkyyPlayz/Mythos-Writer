#!/usr/bin/env python3
"""
Runner watchdog: detect and auto-cancel stuck CI runs/jobs, detect wedged runners.

Detects:
1. Runs/jobs that have been "running" for > 2× their timeout-minutes (or > 2h for runs)
2. Wedged runner services (online but stuck-busy with no progress)

Cancels stuck runs/jobs and logs evidence.
Does NOT perform destructive host actions; escalates via parent issue comment.
"""

import os
import sys
import json
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from typing import Optional

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
REPO = os.getenv("GITHUB_REPOSITORY", "SkyyPlayz/Mythos-Writer")
GITHUB_API = "https://api.github.com"

# Job timeout-minutes from ci.yml
JOB_TIMEOUTS = {
    "lint": 10,
    "typecheck": 15,
    "unit": 20,
    "build-electron": 30,
    "build-macos": 40,
    "build-linux": 40,
    "build-windows": 40,
    "e2e-shard-1": 30,
    "e2e-shard-2": 30,
    "e2e-shard-3": 30,
    "e2e-shard-4": 30,
    "ci": 5,
}

# Thresholds
RUN_TIMEOUT_THRESHOLD = 120  # 2 hours for any run
JOB_TIMEOUT_MULTIPLIER = 2.0  # jobs stuck for 2× their declared timeout
DISPATCH_WEDGE_THRESHOLD_MINUTES = 5  # a queued run with 0 jobs after this long is wedged
DISPATCH_WEDGE_WORKFLOW_FILE = "ci.yml"


def log(msg: str):
    ts = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    print(f"[{ts}] {msg}")


def gh_api(path: str, method: str = "GET", body: Optional[dict] = None):
    """Call GitHub API."""
    url = f"{GITHUB_API}{path}"
    headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
    }

    if body:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    else:
        data = None

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status in [200, 201, 202, 204]:
                if resp.status == 204:  # No content
                    return None
                if resp.status == 202:  # Accepted (async, cancel endpoints return no body)
                    return {}
                return json.loads(resp.read().decode())
            else:
                log(f"ERROR: GitHub API returned {resp.status} for {method} {path}")
                return None
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        log(f"ERROR: {method} {path} failed: {e.code} {body}")
        return None


def get_stuck_runs():
    """Fetch runs that have been stuck for too long."""
    # Get last 20 runs
    runs = gh_api(f"/repos/{REPO}/actions/runs?per_page=20&status=in_progress")
    if not runs or "workflow_runs" not in runs:
        log("No in_progress runs found")
        return []

    stuck = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for run in runs["workflow_runs"]:
        run_id = run["id"]
        name = run["name"]
        created_at = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
        created_at = created_at.replace(tzinfo=None)  # Make naive for comparison

        elapsed_minutes = (now - created_at).total_seconds() / 60

        # Check if run has been running for > 2 hours
        if elapsed_minutes > RUN_TIMEOUT_THRESHOLD:
            log(
                f"STUCK RUN: {name} (run_id={run_id}) running for {elapsed_minutes:.1f}m (threshold={RUN_TIMEOUT_THRESHOLD}m)"
            )
            stuck.append(
                {
                    "type": "run",
                    "id": run_id,
                    "name": name,
                    "elapsed_minutes": elapsed_minutes,
                }
            )

    return stuck


def get_stuck_jobs():
    """Fetch jobs that have been stuck for too long."""
    # Get last 50 runs (need to check their jobs)
    runs = gh_api(f"/repos/{REPO}/actions/runs?per_page=50&status=in_progress")
    if not runs or "workflow_runs" not in runs:
        return []

    stuck = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for run in runs["workflow_runs"]:
        run_id = run["id"]
        run_name = run["name"]

        # Get jobs for this run
        jobs = gh_api(f"/repos/{REPO}/actions/runs/{run_id}/jobs")
        if not jobs or "jobs" not in jobs:
            continue

        for job in jobs["jobs"]:
            job_id = job["id"]
            job_name = job["name"]
            status = job["status"]
            started_at = job.get("started_at")
            runner_id = job.get("runner_id")

            if status != "in_progress" or not started_at:
                continue

            started = datetime.fromisoformat(
                started_at.replace("Z", "+00:00")
            ).replace(tzinfo=None)
            elapsed_minutes = (now - started).total_seconds() / 60

            # Determine timeout for this job
            timeout = None
            for key in JOB_TIMEOUTS:
                if key in job_name.lower():
                    timeout = JOB_TIMEOUTS[key]
                    break

            if not timeout:
                # Default to 30 min if we can't determine job type
                timeout = 30

            threshold = timeout * JOB_TIMEOUT_MULTIPLIER

            if elapsed_minutes > threshold:
                log(
                    f"STUCK JOB: {job_name} (job_id={job_id}, run_id={run_id}, {run_name}) "
                    f"running for {elapsed_minutes:.1f}m (timeout={timeout}m, threshold={threshold:.1f}m)"
                )
                stuck.append(
                    {
                        "type": "job",
                        "run_id": run_id,
                        "job_id": job_id,
                        "job_name": job_name,
                        "run_name": run_name,
                        "runner_id": runner_id,
                        "elapsed_minutes": elapsed_minutes,
                        "timeout": timeout,
                    }
                )

    return stuck


def cancel_run(run_id: int) -> bool:
    """Cancel a run."""
    result = gh_api(f"/repos/{REPO}/actions/runs/{run_id}/cancel", method="POST", body={})
    if result is not None:
        log(f"✓ Cancelled run {run_id}")
        return True
    return False


def cancel_job(job_id: int, run_id: int, job_name: str) -> bool:
    """Cancel a job (actually cancels the containing run, then logs it)."""
    # GitHub doesn't have a direct job-cancel endpoint; we cancel the run.
    # This is a coarse action but necessary for wedged jobs.
    result = gh_api(f"/repos/{REPO}/actions/runs/{run_id}/cancel", method="POST", body={})
    if result is not None:
        log(f"✓ Cancelled run {run_id} (job: {job_name})")
        return True
    return False


def detect_wedged_runners(stuck_jobs):
    """
    Detect wedged runners (online but stuck-busy with evidence of stale work).

    A runner is considered wedged if:
    - Status is "online" and marked "busy"
    - AND has a stuck job currently running on it (real evidence of stale state)
    """
    # Get runner list
    runners = gh_api(f"/repos/{REPO}/actions/runners")
    if not runners or "runners" not in runners:
        log("No runners found")
        return []

    # Build set of runner IDs that have stuck jobs
    runners_with_stuck_jobs = set()
    for job in stuck_jobs:
        if job.get("runner_id"):
            runners_with_stuck_jobs.add(job["runner_id"])

    wedged = []

    for runner in runners["runners"]:
        runner_id = runner["id"]
        name = runner["name"]
        status = runner["status"]
        busy = runner["busy"]

        log(
            f"Runner {name} (id={runner_id}): status={status}, busy={busy}"
        )

        if status == "online" and busy:
            # Only count as wedged if there's a stuck job on this runner
            if runner_id in runners_with_stuck_jobs:
                log(f"  → Runner is online+busy WITH stuck job (WEDGED)")
                wedged.append(
                    {"runner_id": runner_id, "name": name, "status": status, "busy": busy}
                )
            else:
                log(f"  → Runner is online+busy but no stuck jobs (candidate, not counted)")

    return wedged


def get_wedged_dispatch_runs():
    """
    Detect pull_request-triggered runs that GitHub accepted (status=queued)
    but never dispatched any jobs to (0 jobs after DISPATCH_WEDGE_THRESHOLD_MINUTES).

    Distinct from get_stuck_jobs()/get_stuck_runs(), which only look at
    status=in_progress runs. A dispatch-wedged run never reaches in_progress
    at all, so it is invisible to the other checks.
    """
    runs = gh_api(f"/repos/{REPO}/actions/runs?per_page=30&status=queued")
    if not runs or "workflow_runs" not in runs:
        return []

    wedged = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for run in runs["workflow_runs"]:
        if run.get("event") != "pull_request":
            continue

        run_id = run["id"]
        created_at = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
        created_at = created_at.replace(tzinfo=None)
        elapsed_minutes = (now - created_at).total_seconds() / 60

        if elapsed_minutes < DISPATCH_WEDGE_THRESHOLD_MINUTES:
            continue

        jobs = gh_api(f"/repos/{REPO}/actions/runs/{run_id}/jobs")
        job_count = len(jobs["jobs"]) if jobs and "jobs" in jobs else 0

        if job_count == 0:
            head_branch = run.get("head_branch")
            log(
                f"DISPATCH-WEDGED RUN: run_id={run_id} branch={head_branch} "
                f"queued for {elapsed_minutes:.1f}m with 0 jobs dispatched"
            )
            wedged.append(
                {
                    "run_id": run_id,
                    "head_branch": head_branch,
                    "elapsed_minutes": elapsed_minutes,
                }
            )

    return wedged


def force_cancel_run(run_id: int) -> bool:
    """
    Force-cancel a run that never dispatched jobs. A plain /cancel is a
    documented no-op for 0-job queued runs, so use GitHub's dedicated
    /force-cancel endpoint (the same manual fix proven on prior wedge
    incidents, see SKY-7787) instead of calling /cancel twice: /cancel is
    idempotent, so a second call doesn't escalate it into a force-cancel and
    can 409 if the first call already flipped the run to "cancelling",
    which would misreport a successful cancel as a failure.
    """
    result = gh_api(f"/repos/{REPO}/actions/runs/{run_id}/force-cancel", method="POST", body={})
    if result is not None:
        log(f"✓ Force-cancelled dispatch-wedged run {run_id}")
        return True
    log(f"✗ Force-cancel failed for run {run_id}")
    return False


def retrigger_workflow(branch: str) -> bool:
    """Re-dispatch ci.yml for the branch via workflow_dispatch."""
    result = gh_api(
        f"/repos/{REPO}/actions/workflows/{DISPATCH_WEDGE_WORKFLOW_FILE}/dispatches",
        method="POST",
        body={"ref": branch},
    )
    if result is not None:
        log(f"✓ Re-triggered {DISPATCH_WEDGE_WORKFLOW_FILE} on {branch}")
        return True
    log(f"✗ Re-trigger failed for {branch}")
    return False


def main():
    if not GITHUB_TOKEN:
        log("ERROR: GITHUB_TOKEN not set")
        sys.exit(1)

    log("=== Runner Watchdog Start ===")
    log(f"Repo: {REPO}")

    # Detect stuck runs
    stuck_runs = get_stuck_runs()
    cancelled_runs = 0
    for run in stuck_runs:
        if cancel_run(run["id"]):
            cancelled_runs += 1

    # Detect stuck jobs
    stuck_jobs = get_stuck_jobs()
    cancelled_jobs = 0
    for job in stuck_jobs:
        if cancel_job(job["job_id"], job["run_id"], job["job_name"]):
            cancelled_jobs += 1

    # Detect wedged runners (correlate with stuck jobs)
    wedged_runners = detect_wedged_runners(stuck_jobs)

    # Detect dispatch-wedged pull_request runs (queued, 0 jobs, distinct from
    # the above which only cover status=in_progress runs)
    dispatch_wedged = get_wedged_dispatch_runs()
    resolved_dispatch_wedges = 0
    for run in dispatch_wedged:
        if force_cancel_run(run["run_id"]) and run["head_branch"]:
            if retrigger_workflow(run["head_branch"]):
                resolved_dispatch_wedges += 1

    log("=== Summary ===")
    log(f"Stuck runs detected: {len(stuck_runs)}, cancelled: {cancelled_runs}")
    log(f"Stuck jobs detected: {len(stuck_jobs)}, cancelled: {cancelled_jobs}")
    log(f"Wedged runners detected: {len(wedged_runners)}")
    log(
        f"Dispatch-wedged PR runs detected: {len(dispatch_wedged)}, "
        f"force-cancelled+retriggered: {resolved_dispatch_wedges}"
    )

    if wedged_runners:
        log("WARNING: Wedged runners detected. Manual restart may be needed:")
        for runner in wedged_runners:
            log(f"  - {runner['name']} (id={runner['runner_id']})")

    log("=== Runner Watchdog End ===")


if __name__ == "__main__":
    main()
