#!/usr/bin/env python3
"""
OpsRunner ops dispatcher — runs every 15 minutes on Haiku.
Failover dropped jobs, wake idle workers, tier untriaged issues, ping CEO.
"""

import os
import sys
import json
import subprocess
from datetime import datetime
from typing import Optional, Dict, List, Set, Tuple

# Agent IDs
OPSRUNNER_ID = "ba5fbc63-dbb0-4f77-bdae-4ae1c5e5e6bd"
RELIEF_ENGINEER_ID = "0931edd2-0f6b-4fef-b392-c3e0d23db801"
CEO_ID = "54e5de0a-25d8-4ed9-8148-bce7e377b232"

# Parent issues for child routing (using UUIDs)
FAILOVER_QUEUE_UUID = "79ed7dbc-8599-4585-b34b-a5443e83b791"  # SKY-2565 OPS Dispatch — Failover Queue
TIERING_QUEUE_UUID = "79ed7dbc-8599-4585-b34b-a5443e83b791"   # Same parent for tiering children


def get_run_id() -> str:
    """Get the current Paperclip run ID from environment."""
    run_id = os.environ.get("PAPERCLIP_RUN_ID")
    if not run_id:
        # Fallback: use a synthetic run ID if not set
        run_id = f"ops-dispatch-{int(datetime.now().timestamp())}"
    return run_id


def api_call(method: str, endpoint: str, data: Optional[Dict] = None) -> Optional[Dict]:
    """Make a Paperclip API call using curl and the API key."""
    run_id = get_run_id()
    base_url = os.environ.get("PAPERCLIP_API_URL", "http://localhost:8000")
    api_key = os.environ.get("PAPERCLIP_API_KEY")

    url = f"{base_url}{endpoint}"

    cmd = ["curl", "-s", "-X", method, url]
    cmd += ["-H", f"X-Paperclip-Run-Id: {run_id}"]

    if api_key:
        cmd += ["-H", f"Authorization: Bearer {api_key}"]

    if data:
        cmd += ["-H", "Content-Type: application/json"]
        cmd += ["-d", json.dumps(data)]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.stdout:
            # Handle both JSON object responses and empty strings
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                # If it's not JSON, return None to indicate API error
                print(f"API returned non-JSON: {result.stdout[:100]}", file=sys.stderr)
                return None
    except subprocess.TimeoutExpired:
        print(f"API call timeout: {method} {endpoint}", file=sys.stderr)
    except Exception as e:
        print(f"API call failed: {e}", file=sys.stderr)

    return None


def get_agents() -> Dict[str, Dict]:
    """GET /api/companies/{companyId}/agents — return dict of agent_id -> agent data."""
    # Get company ID from environment or infer from context
    company_id = os.environ.get("PAPERCLIP_COMPANY_ID")
    if not company_id:
        print("ERROR: PAPERCLIP_COMPANY_ID not set", file=sys.stderr)
        return {}

    response = api_call("GET", f"/api/companies/{company_id}/agents")
    if response:
        # API returns array directly, not wrapped
        if isinstance(response, list):
            return {a["id"]: a for a in response}
        elif isinstance(response, dict) and "data" in response:
            return {a["id"]: a for a in response["data"]}
    return {}


def get_issues_by_status(status: str, limit: int = 500) -> List[Dict]:
    """GET /api/companies/{companyId}/issues?status=<status> — return list of issues."""
    company_id = os.environ.get("PAPERCLIP_COMPANY_ID")
    if not company_id:
        return []

    response = api_call("GET", f"/api/companies/{company_id}/issues?status={status}&limit={limit}")
    if response:
        # Handle both wrapped and unwrapped responses
        if isinstance(response, list):
            return response
        elif isinstance(response, dict) and "data" in response:
            return response["data"]
    return []


def get_issue(issue_id: str) -> Optional[Dict]:
    """GET /api/issues/{issueId} — return full issue data."""
    response = api_call("GET", f"/api/issues/{issue_id}")
    if response:
        # Could be wrapped or unwrapped
        if isinstance(response, dict):
            return response.get("data") or response
    return None


def create_child_issue(
    parent_issue_uuid: str,
    title: str,
    body: str,
    assignee_agent_id: str,
) -> Optional[str]:
    """Create a child issue under parent_issue_uuid and return the new issue identifier."""
    company_id = os.environ.get("PAPERCLIP_COMPANY_ID")
    if not company_id:
        return None

    payload = {
        "title": title,
        "description": body,
        "status": "todo",
        "assigneeAgentId": assignee_agent_id,
        "parentIssueId": parent_issue_uuid,
    }

    response = api_call("POST", f"/api/companies/{company_id}/issues", payload)
    if response:
        # Response could be wrapped or not
        if isinstance(response, dict):
            return response.get("identifier") or response.get("id")
    return None


def patch_issue(issue_id: str, payload: Dict) -> bool:
    """PATCH /api/issues/{issueId} with the given payload."""
    response = api_call("PATCH", f"/api/issues/{issue_id}", payload)
    return response is not None


def post_comment(issue_id: str, body: str) -> bool:
    """POST a comment to /api/issues/{issueId}/comments."""
    response = api_call("POST", f"/api/issues/{issue_id}/comments", {"body": body})
    return response is not None


def check_issue_exists(issue_id: str) -> bool:
    """Quick check if an issue ID exists."""
    issue = get_issue(issue_id)
    return issue is not None


def run_dispatch() -> Tuple[int, int, bool, List[str]]:
    """
    Run the ops dispatch cycle.
    Returns: (failovers_created, workers_woken, ceo_pinged, reasons_for_ceo_ping)
    """
    print("[OpsRunner Dispatch] Starting cycle...", flush=True)

    # Get agents and identify errored ones
    agents = get_agents()
    errored_agent_ids: Set[str] = {
        aid for aid, agent in agents.items()
        if agent.get("status") == "error"
    }
    print(f"[A] Found {len(errored_agent_ids)} errored agents", flush=True)

    # Get all in_progress issues
    in_progress_issues = get_issues_by_status("in_progress")
    print(f"[B] Found {len(in_progress_issues)} in-progress issues", flush=True)

    # ========== A. DROPPED-JOB FAILOVER ==========
    failovers_created = 0
    dropped_issues = []

    for issue in in_progress_issues:
        assignee_id = issue.get("assigneeAgentId")

        # Skip if assigned to CEO or ReliefEngineer
        if assignee_id in (CEO_ID, RELIEF_ENGINEER_ID):
            continue

        # Check if assigned to errored agent
        if assignee_id in errored_agent_ids:
            dropped_issues.append(issue)

    print(f"[A] Found {len(dropped_issues)} dropped issues", flush=True)

    # For each dropped issue, check if failover already exists to avoid dupes
    for issue in dropped_issues:
        issue_id = issue["id"]
        brief_desc = (issue.get("title") or "Unknown")[:50]

        # Check for existing open failover child (simple dedup: look for recent child with same parent)
        # This is a simplified check; ideally we'd search for existing failover with same signature
        existing_failover = None
        for child_issue_id in issue.get("childIssueIds", []):
            child = get_issue(child_issue_id)
            if child and child.get("assigneeAgentId") == CEO_ID and child.get("status") != "done":
                existing_failover = child
                break

        if existing_failover:
            print(f"[A] Failover already exists for {issue_id}, skipping", flush=True)
            continue

        # Create failover child to CEO
        failover_title = f"OpsRunner failover: {brief_desc}"
        failover_body = f"""Dropped job detected.

Target issue: {issue_id}
Assigned agent (in error): {issue.get("assigneeAgentId")}
Recovery action: Reassign to available agent or CEO

Please investigate and recover this issue."""

        new_child_id = create_child_issue(
            FAILOVER_QUEUE_UUID,
            failover_title,
            failover_body,
            CEO_ID,
        )

        if new_child_id:
            print(f"[A] Created failover {new_child_id} for {issue_id}", flush=True)
            failovers_created += 1
        else:
            print(f"[A] Failed to create failover for {issue_id}", file=sys.stderr, flush=True)

    # ========== B. WAKE IDLE WORKERS ==========
    workers_woken = 0
    woken_agents: Set[str] = set()

    for issue in in_progress_issues:
        assignee_id = issue.get("assigneeAgentId")

        # Skip CEO, OpsRunner, ReliefEngineer
        if assignee_id in (CEO_ID, OPSRUNNER_ID, RELIEF_ENGINEER_ID):
            continue

        # Skip if agent is in error (already handled in A)
        if assignee_id in errored_agent_ids:
            continue

        # Check if agent is running
        agent = agents.get(assignee_id, {})
        if agent.get("status") == "running":
            continue

        # Agent is idle (not running, not error) — wake it by self-assigning one of its issues
        if assignee_id not in woken_agents:
            # Self-assign this issue to wake the agent
            success = patch_issue(issue["id"], {"assigneeAgentId": assignee_id})
            if success:
                print(f"[B] Woke agent {assignee_id} by reassigning {issue['id']}", flush=True)
                workers_woken += 1
                woken_agents.add(assignee_id)
            else:
                print(f"[B] Failed to wake agent {assignee_id}", file=sys.stderr, flush=True)

    # ========== C. TIER UNTRIAGED ISSUES ==========
    todo_issues = get_issues_by_status("todo", limit=100)
    print(f"[C] Found {len(todo_issues)} todo issues to check for tiering", flush=True)

    # Filter to untiered issues, skip transient/automation, tier up to 10
    untiered = []
    skip_keywords = ["[auto-fix]", "[merge-gate]", "CI ", "productivity-review", "OpsRunner tiering"]

    for issue in todo_issues:
        title = issue.get("title", "")
        label_ids = issue.get("labelIds", [])

        # Skip if already has a tier label
        if any("tier:" in str(lid) for lid in label_ids):
            continue

        # Skip transient/automation tickets
        if any(kw in title for kw in skip_keywords):
            continue

        untiered.append(issue)

    tiering_children_created = 0
    for issue in untiered[:10]:  # Process up to 10 per cycle
        issue_id = issue["id"]
        brief_desc = (issue.get("title") or "Unknown")[:50]

        # Estimate tier based on description (simplified heuristic)
        # In production, this would use ML or a more sophisticated classifier
        desc = (issue.get("description") or "").lower()
        if any(kw in desc for kw in ["new feature", "refactor", "redesign", "agent", "subsystem"]):
            tier = "heavy"
        elif any(kw in desc for kw in ["spec", "plan", "design", "review"]):
            tier = "standard"  # Design docs need review, so at least standard
        else:
            tier = "light"  # Bug/copy/config default to light

        # Create tiering child with needs:local-board
        tiering_title = f"OpsRunner tiering: {issue_id} → tier:{tier}"
        tiering_body = f"Auto-triaged by OpsRunner dispatcher cycle."

        new_tiering_id = create_child_issue(
            TIERING_QUEUE_UUID,
            tiering_title,
            tiering_body,
            OPSRUNNER_ID,  # OpsRunner owns the tiering request; local-board processes it
        )

        if new_tiering_id:
            print(f"[C] Created tiering request {new_tiering_id} for {issue_id} → tier:{tier}", flush=True)
            tiering_children_created += 1
        else:
            print(f"[C] Failed to create tiering child for {issue_id}", file=sys.stderr, flush=True)

    # ========== D. PING CEO ==========
    ceo_ping_reasons = []

    # Reason 1: Created tier:heavy tiering requests this cycle
    if tiering_children_created > 0:
        ceo_ping_reasons.append(f"Created tiering requests for {tiering_children_created} issue(s)")

    # Reason 2: Check if any tier:heavy epic is assigned to CEO but CEO not running
    all_issues = get_issues_by_status("in_progress", limit=200) + get_issues_by_status("todo", limit=100)
    ceo_heavies = [
        i for i in all_issues
        if i.get("assigneeAgentId") == CEO_ID
        and any("tier:heavy" in str(lid) for lid in i.get("labelIds", []))
    ]

    ceo_agent = agents.get(CEO_ID, {})
    if ceo_heavies and ceo_agent.get("status") != "running":
        ceo_ping_reasons.append(f"CEO has {len(ceo_heavies)} tier:heavy issue(s) but not running")

    # Reason 3: Active queue low
    active_queue = [
        i for i in all_issues
        if i.get("status") in ("todo", "in_progress", "blocked", "in_review")
    ]
    if len(active_queue) < 12:
        ceo_ping_reasons.append(f"Active queue low: {len(active_queue)} items")

    # Reason 4: Blocked issues with no blockers or resolved blockers
    blocked_issues = get_issues_by_status("blocked", limit=100)
    for issue in blocked_issues:
        blockers = issue.get("blockedByIssueIds", [])
        if not blockers:
            ceo_ping_reasons.append(f"Blocked issue {issue['id']} has no blockers")
            break  # Only mention first such issue

    # Reason 5: ReliefEngineer in error
    relief_agent = agents.get(RELIEF_ENGINEER_ID, {})
    if relief_agent.get("status") == "error":
        ceo_ping_reasons.append("ReliefEngineer is unavailable (error status)")

    ceo_pinged = False
    if ceo_ping_reasons:
        # Find one of CEO's own pending issues to self-assign (wake pattern)
        ceo_issues = [
            i for i in all_issues
            if i.get("assigneeAgentId") == CEO_ID
            and i.get("status") in ("todo", "in_progress", "blocked", "in_review")
        ]

        if ceo_issues:
            ceo_issue_id = ceo_issues[0]["id"]
            # Reassign to self to wake the CEO
            success = patch_issue(ceo_issue_id, {"assigneeAgentId": CEO_ID})
            if success:
                # Post reasons as a comment
                comment_body = "OpsRunner ping — reasons:\n" + "\n".join(f"- {reason}" for reason in ceo_ping_reasons)
                post_success = post_comment(ceo_issue_id, comment_body)
                print(f"[D] Pinged CEO via {ceo_issue_id} (comment: {post_success})", flush=True)
                ceo_pinged = True
            else:
                print(f"[D] Failed to ping CEO", file=sys.stderr, flush=True)
        else:
            print("[D] No CEO issues available to ping with", file=sys.stderr, flush=True)

    return failovers_created, workers_woken, ceo_pinged, ceo_ping_reasons


def main():
    """Main entry point."""
    failovers, woken, ceo_pinged, reasons = run_dispatch()

    summary = f"failovers: {failovers}, woken: {woken}, CEO pinged: {'yes' if ceo_pinged else 'no'}"
    if reasons:
        summary += f" (reasons: {'; '.join(reasons)})"

    print(f"\n[OpsRunner Dispatch] Cycle complete. {summary}", flush=True)

    # Exit with appropriate code
    sys.exit(0)


if __name__ == "__main__":
    main()
