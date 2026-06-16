#!/usr/bin/env python3
"""Hermes 429 watchdog helpers for Paperclip agent auto-failover."""

from __future__ import annotations

import datetime as _dt
import glob
import json
import os
import subprocess
import urllib.request
from collections.abc import Callable, Iterable
from typing import Any

TARGET_ADAPTER = "claude_local"
TARGET_MODEL = "claude-sonnet-4-6"
REVERT_DELAY_S = 5 * 3600 + 15 * 60
SCAN_WINDOW_M = 20
PARENT_ISSUE = "42c24a87-2d8f-4e60-ba9c-eac0d7aa34b7"
HERMES_429_PAT = "API call failed after 3 retries: HTTP 429"

JsonDict = dict[str, Any]
ApiFunc = Callable[[str, str, JsonDict | None], Any]
HeartbeatRunner = Callable[[str], Any]


def _format_utc(value: _dt.datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=_dt.timezone.utc)
    return value.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def api(method: str, path: str, body: JsonDict | None = None) -> Any:
    """Call the Paperclip API using routine-provided environment variables."""

    base_url = os.environ["PAPERCLIP_API_URL"].rstrip("/")
    key = os.environ["PAPERCLIP_API_KEY"]
    run_id = os.environ["PAPERCLIP_RUN_ID"]
    request = urllib.request.Request(
        f"{base_url}/api{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {key}",
            "X-Paperclip-Run-Id": run_id,
            "Content-Type": "application/json",
        },
    )
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(request, data) as response:
        payload = response.read()
    return json.loads(payload) if payload else None


def detect_hermes_429(
    log_dir: str | os.PathLike[str],
    cutoff: _dt.datetime,
    pattern: str = HERMES_429_PAT,
) -> set[str]:
    """Return agent IDs with recent run-log chunks matching the Hermes 429 pattern."""

    cutoff_ts = cutoff.timestamp()
    affected: set[str] = set()
    log_root = os.fspath(log_dir)
    if not os.path.isdir(log_root):
        return affected

    for agent_id in os.listdir(log_root):
        agent_dir = os.path.join(log_root, agent_id)
        if not os.path.isdir(agent_dir):
            continue
        for log_file in glob.glob(os.path.join(agent_dir, "*.ndjson")):
            if os.path.getmtime(log_file) < cutoff_ts:
                continue
            try:
                with open(log_file, encoding="utf-8") as handle:
                    for line in handle:
                        try:
                            chunk = json.loads(line).get("chunk", "")
                        except json.JSONDecodeError:
                            continue
                        if pattern in chunk:
                            affected.add(agent_id)
                            break
            except OSError:
                continue
    return affected


def should_swap(agent: JsonDict) -> bool:
    """Return True when an affected agent is eligible for Hermes failover."""

    if agent.get("adapterType") != "hermes_local":
        return False
    return not (agent.get("metadata") or {}).get("hermesSwap")


def build_swap_body(
    agent: JsonDict,
    now: _dt.datetime,
    target_adapter: str = TARGET_ADAPTER,
    target_model: str = TARGET_MODEL,
    revert_delay_s: int = REVERT_DELAY_S,
) -> JsonDict:
    """Build a safe PATCH body for auto-swapping an agent off Hermes.

    The body intentionally includes only mutable adapterConfig fields. It never copies
    any adapterConfig.instructions* fields, which agent-authenticated calls cannot patch.
    """

    cfg = agent.get("adapterConfig") or {}
    swapped_at = _format_utc(now)
    swap_back_at = _format_utc(now + _dt.timedelta(seconds=revert_delay_s))
    adapter_config: JsonDict = {
        "model": target_model,
        "graceSec": cfg.get("graceSec", 15),
        "timeoutSec": cfg.get("timeoutSec", 72000),
    }
    if cfg.get("env"):
        adapter_config["env"] = cfg["env"]

    return {
        "adapterType": target_adapter,
        "adapterConfig": adapter_config,
        "metadata": {
            **(agent.get("metadata") or {}),
            "hermesSwap": {
                "originalAdapterType": "hermes_local",
                "originalModel": cfg.get("model", "unknown"),
                "swappedAt": swapped_at,
                "swapBackAt": swap_back_at,
                "reason": "Auto-failover: Hermes 429 detected by watchdog",
            },
        },
    }


def _coerce_agents(payload: Any) -> list[JsonDict]:
    if isinstance(payload, dict):
        payload = payload.get("agents", payload.get("items", []))
    return list(payload or [])


def _default_heartbeat_runner(agent_id: str) -> None:
    subprocess.run(["paperclipai", "heartbeat", "run", "--agent-id", agent_id], timeout=15, check=False)


def run_watchdog(
    api_call: ApiFunc,
    company_id: str,
    affected_agent_ids: Iterable[str],
    now: _dt.datetime,
    *,
    parent_issue: str = PARENT_ISSUE,
    heartbeat_runner: HeartbeatRunner | None = _default_heartbeat_runner,
) -> JsonDict:
    """Apply watchdog failover to affected agents and post an observability comment."""

    affected = set(affected_agent_ids)
    agents = _coerce_agents(api_call("GET", f"/companies/{company_id}/agents", None))
    swapped: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    for agent in agents:
        if agent["id"] not in affected:
            continue
        name = agent.get("name", agent["id"])
        if not should_swap(agent):
            reason = "not hermes_local" if agent.get("adapterType") != "hermes_local" else "already swapped"
            skipped.append(f"{name}: {reason}")
            continue
        body = build_swap_body(agent, now)
        try:
            api_call("PATCH", f"/agents/{agent['id']}", body)
            swap_back_at = body["metadata"]["hermesSwap"]["swapBackAt"]
            swapped.append(f"{name} → {TARGET_ADAPTER}/{TARGET_MODEL} (reverts {swap_back_at})")
            if heartbeat_runner is not None:
                try:
                    heartbeat_runner(agent["id"])
                except Exception:
                    pass
        except Exception as exc:  # pragma: no cover - exercised by integration callers as needed
            errors.append(f"{name}: {exc}")

    if swapped or errors:
        lines = ["## Hermes 429 Auto-Failover — Watchdog"]
        if swapped:
            lines += [f"\n**Swapped ({len(swapped)}):**", *[f"- {item}" for item in swapped]]
        if skipped:
            lines += [f"\n**No-op ({len(skipped)}):**", *[f"- {item}" for item in skipped]]
        if errors:
            lines += [f"\n**Errors ({len(errors)}):**", *[f"- {item}" for item in errors]]
        try:
            api_call("POST", f"/issues/{parent_issue}/comments", {"body": "\n".join(lines)})
        except Exception:
            pass

    return {"swapped": swapped, "skipped": skipped, "errors": errors}


def main() -> None:
    now = _dt.datetime.now(_dt.timezone.utc)
    company_id = os.environ["PAPERCLIP_COMPANY_ID"]
    instance_dir = os.environ.get("PAPERCLIP_INSTANCE_DIR", os.path.expanduser("~/.paperclip/instances/default"))
    log_dir = os.path.join(instance_dir, "data", "run-logs", company_id)
    affected = detect_hermes_429(log_dir, now - _dt.timedelta(minutes=SCAN_WINDOW_M))
    result = run_watchdog(api, company_id, affected, now)
    print(f"watchdog: swapped={len(result['swapped'])} skipped={len(result['skipped'])} errors={len(result['errors'])}")


if __name__ == "__main__":
    main()
