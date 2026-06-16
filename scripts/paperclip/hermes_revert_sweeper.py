#!/usr/bin/env python3
"""Hermes swap revert sweeper helpers for Paperclip agents."""

from __future__ import annotations

import datetime as _dt
import json
import os
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

REVERT_RETRY_S = 5 * 3600 + 15 * 60
PARENT_ISSUE = "42c24a87-2d8f-4e60-ba9c-eac0d7aa34b7"

JsonDict = dict[str, Any]
ApiFunc = Callable[[str, str, JsonDict | None], Any]


def _format_utc(value: _dt.datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=_dt.timezone.utc)
    return value.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_utc(value: str) -> _dt.datetime:
    return _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


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


def should_revert(agent: JsonDict, now: _dt.datetime) -> bool:
    """Return True only when an agent's hermesSwap.swapBackAt has elapsed."""

    swap = (agent.get("metadata") or {}).get("hermesSwap")
    if not swap:
        return False
    return _parse_utc(swap["swapBackAt"]) <= now


def build_revert_body(agent: JsonDict) -> JsonDict:
    """Build a safe PATCH body that restores the original adapter and clears hermesSwap.

    Like the watchdog body, this intentionally avoids adapterConfig.instructions* fields.
    """

    swap = (agent.get("metadata") or {})["hermesSwap"]
    cfg = agent.get("adapterConfig") or {}
    adapter_config: JsonDict = {
        "model": swap["originalModel"],
        "graceSec": cfg.get("graceSec", 15),
        "timeoutSec": cfg.get("timeoutSec", 72000),
    }
    if cfg.get("env"):
        adapter_config["env"] = cfg["env"]

    return {
        "adapterType": swap["originalAdapterType"],
        "adapterConfig": adapter_config,
        "metadata": {
            **(agent.get("metadata") or {}),
            "hermesSwap": None,
        },
    }


def _coerce_agents(payload: Any) -> list[JsonDict]:
    if isinstance(payload, dict):
        payload = payload.get("agents", payload.get("items", []))
    return list(payload or [])


def _reschedule_body(agent: JsonDict, new_swap_back_at: str) -> JsonDict:
    metadata = agent.get("metadata") or {}
    swap = metadata["hermesSwap"]
    return {"metadata": {**metadata, "hermesSwap": {**swap, "swapBackAt": new_swap_back_at}}}


def run_sweeper(
    api_call: ApiFunc,
    company_id: str,
    now: _dt.datetime,
    *,
    parent_issue: str = PARENT_ISSUE,
    retry_seconds: int = REVERT_RETRY_S,
) -> JsonDict:
    """Revert elapsed Hermes swaps, or reschedule failed reverts."""

    agents = _coerce_agents(api_call("GET", f"/companies/{company_id}/agents", None))
    reverted: list[str] = []
    deferred: list[str] = []
    errors: list[str] = []

    for agent in agents:
        if not should_revert(agent, now):
            continue
        name = agent.get("name", agent["id"])
        swap = (agent.get("metadata") or {})["hermesSwap"]
        try:
            api_call("PATCH", f"/agents/{agent['id']}", build_revert_body(agent))
            reverted.append(f"{name} → {swap['originalAdapterType']}/{swap['originalModel']}")
        except urllib.error.HTTPError as exc:
            status_code = exc.code
            try:
                exc.close()
            except Exception:
                pass
            new_swap_back_at = _format_utc(now + _dt.timedelta(seconds=retry_seconds))
            try:
                api_call("PATCH", f"/agents/{agent['id']}", _reschedule_body(agent, new_swap_back_at))
                deferred.append(f"{name}: HTTP {status_code} — retrying at {new_swap_back_at}")
            except Exception as reschedule_exc:
                errors.append(f"{name}: revert + bump both failed: {status_code} / {reschedule_exc}")
        except Exception as exc:  # pragma: no cover - defensive for runtime failures
            errors.append(f"{name}: {exc}")

    if reverted or deferred or errors:
        lines = ["## Hermes Revert Sweeper"]
        if reverted:
            lines += [f"\n**Reverted ({len(reverted)}):**", *[f"- {item}" for item in reverted]]
        if deferred:
            lines += [f"\n**Deferred ({len(deferred)}) — Hermes still down:**", *[f"- {item}" for item in deferred]]
        if errors:
            lines += [f"\n**Errors ({len(errors)}):**", *[f"- {item}" for item in errors]]
        try:
            api_call("POST", f"/issues/{parent_issue}/comments", {"body": "\n".join(lines)})
        except Exception:
            pass

    return {"reverted": reverted, "deferred": deferred, "errors": errors}


def main() -> None:
    now = _dt.datetime.now(_dt.timezone.utc)
    company_id = os.environ["PAPERCLIP_COMPANY_ID"]
    result = run_sweeper(api, company_id, now)
    print(f"sweeper: reverted={len(result['reverted'])} deferred={len(result['deferred'])} errors={len(result['errors'])}")


if __name__ == "__main__":
    main()
