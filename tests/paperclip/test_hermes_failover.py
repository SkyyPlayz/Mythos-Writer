import email.message
import io
import json
import sys
import tempfile
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.paperclip.hermes_cap_manager import (  # noqa: E402
    TARGET_ADAPTER,
    TARGET_MODEL,
    build_revert_body,
    build_swap_body,
    detect_hermes_429,
    run_cap_manager,
    run_sweeper,
    run_watchdog,
    should_revert,
    should_swap,
)

NOW = datetime(2026, 6, 16, 18, 0, tzinfo=timezone.utc)
PARENT_ISSUE = "parent-issue"
COMPANY_ID = "company-id"


def hermes_agent(**overrides):
    agent = {
        "id": "agent-1",
        "name": "FoundingEngineer",
        "adapterType": "hermes_local",
        "adapterConfig": {
            "model": "gpt-5.5",
            "graceSec": 20,
            "timeoutSec": 123,
            "env": {"MODE": "test"},
            "instructions": "secret instructions path",
            "instructionsPath": "/private/instructions.md",
            "instructionsExtra": "forbidden",
        },
        "metadata": {"role": "founding"},
    }
    agent.update(overrides)
    return agent


def swapped_agent(**overrides):
    metadata = {
        "role": "founding",
        "hermesSwap": {
            "originalAdapterType": "hermes_local",
            "originalModel": "gpt-5.5",
            "swappedAt": "2026-06-16T12:45:00Z",
            "swapBackAt": "2026-06-16T17:59:00Z",
            "reason": "Auto-failover: Hermes 429 detected by watchdog",
        },
    }
    agent = hermes_agent(
        adapterType="claude_local",
        adapterConfig={"model": "claude-sonnet-4-6", "graceSec": 30, "timeoutSec": 456, "env": {"MODE": "test"}},
        metadata=metadata,
    )
    agent.update(overrides)
    return agent


def flatten_keys(value, prefix=""):
    keys = []
    if isinstance(value, dict):
        for key, child in value.items():
            dotted = f"{prefix}.{key}" if prefix else key
            keys.append(dotted)
            keys.extend(flatten_keys(child, dotted))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            keys.extend(flatten_keys(child, f"{prefix}[{index}]"))
    return keys


class FakePaperclipApi:
    def __init__(self, agents, fail_patch_once=False):
        self.agents = {agent["id"]: deepcopy(agent) for agent in agents}
        self.fail_patch_once = fail_patch_once
        self.patch_bodies = []
        self.comments = []

    def __call__(self, method, path, body=None):
        if method == "GET" and path == f"/companies/{COMPANY_ID}/agents":
            return list(self.agents.values())
        if method == "PATCH" and path.startswith("/agents/"):
            agent_id = path.rsplit("/", 1)[1]
            if self.fail_patch_once:
                self.fail_patch_once = False
                raise HTTPError(
                    url=path,
                    code=500,
                    msg="server error",
                    hdrs=email.message.Message(),
                    fp=io.BytesIO(b"server error"),
                )
            assert body is not None
            self.patch_bodies.append((agent_id, deepcopy(body)))
            self.agents[agent_id].update(deepcopy(body))
            return deepcopy(self.agents[agent_id])
        if method == "POST" and path == f"/issues/{PARENT_ISSUE}/comments":
            assert body is not None
            self.comments.append(body["body"])
            return {"id": f"comment-{len(self.comments)}"}
        raise AssertionError(f"unexpected API call: {method} {path} {body}")


class HermesFailoverUnitTests(unittest.TestCase):
    def test_detect_hermes_429_returns_recent_matching_agent_ids_only(self):
        with tempfile.TemporaryDirectory() as td:
            log_dir = Path(td)
            recent = log_dir / "agent-1"
            old = log_dir / "agent-2"
            non_matching = log_dir / "agent-3"
            for path in (recent, old, non_matching):
                path.mkdir()
            recent_log = recent / "run.ndjson"
            recent_log.write_text(json.dumps({"chunk": "API call failed after 3 retries: HTTP 429: quota"}) + "\n")
            old_log = old / "run.ndjson"
            old_log.write_text(json.dumps({"chunk": "API call failed after 3 retries: HTTP 429: quota"}) + "\n")
            non_matching_log = non_matching / "run.ndjson"
            non_matching_log.write_text(json.dumps({"chunk": "HTTP 500"}) + "\n")
            old_time = (NOW - timedelta(minutes=25)).timestamp()
            recent_time = (NOW - timedelta(minutes=2)).timestamp()
            for path, mtime in ((recent_log, recent_time), (old_log, old_time), (non_matching_log, recent_time)):
                path.touch()
                import os

                os.utime(path, (mtime, mtime))

            self.assertEqual(detect_hermes_429(log_dir, NOW - timedelta(minutes=20)), {"agent-1"})

    def test_build_swap_body_omits_instructions_and_sets_hermes_swap_metadata(self):
        body = build_swap_body(hermes_agent(), NOW)

        forbidden = [key for key in flatten_keys(body) if "instructions" in key]
        self.assertEqual(forbidden, [])
        self.assertEqual(body["adapterType"], TARGET_ADAPTER)
        self.assertEqual(body["adapterConfig"]["model"], TARGET_MODEL)
        self.assertEqual(body["metadata"]["hermesSwap"]["originalAdapterType"], "hermes_local")
        self.assertEqual(body["metadata"]["hermesSwap"]["originalModel"], "gpt-5.5")
        self.assertEqual(body["metadata"]["hermesSwap"]["swapBackAt"], "2026-06-16T23:15:00Z")

    def test_should_swap_rejects_non_hermes_and_already_swapped_agents(self):
        self.assertFalse(should_swap(hermes_agent(adapterType="claude_local")))
        self.assertFalse(should_swap(swapped_agent()))
        self.assertTrue(should_swap(hermes_agent()))

    def test_should_revert_only_when_swap_back_at_has_elapsed(self):
        self.assertTrue(should_revert(swapped_agent(), NOW))
        self.assertFalse(should_revert(swapped_agent(metadata={"hermesSwap": {"swapBackAt": "2026-06-16T18:01:00Z"}}), NOW))
        self.assertFalse(should_revert(hermes_agent(), NOW))

    def test_build_revert_body_clears_hermes_swap_and_restores_original_adapter_model(self):
        body = build_revert_body(swapped_agent())

        forbidden = [key for key in flatten_keys(body) if "instructions" in key]
        self.assertEqual(forbidden, [])
        self.assertEqual(body["adapterType"], "hermes_local")
        self.assertEqual(body["adapterConfig"]["model"], "gpt-5.5")
        self.assertIsNone(body["metadata"]["hermesSwap"])


class HermesFailoverIntegrationTests(unittest.TestCase):
    def test_full_swap_changes_adapter_and_records_hermes_swap(self):
        api = FakePaperclipApi([hermes_agent()])

        result = run_watchdog(api, COMPANY_ID, {"agent-1"}, NOW, parent_issue=PARENT_ISSUE, heartbeat_runner=lambda _: None)

        agent = api.agents["agent-1"]
        self.assertEqual(result["swapped"], ["FoundingEngineer → claude_local/claude-sonnet-4-6 (reverts 2026-06-16T23:15:00Z)"])
        self.assertEqual(agent["adapterType"], "claude_local")
        self.assertEqual(agent["adapterConfig"]["model"], "claude-sonnet-4-6")
        self.assertEqual(agent["metadata"]["hermesSwap"]["originalModel"], "gpt-5.5")

    def test_idempotent_reswap_patches_agent_once(self):
        api = FakePaperclipApi([hermes_agent()])

        run_watchdog(api, COMPANY_ID, {"agent-1"}, NOW, parent_issue=PARENT_ISSUE, heartbeat_runner=lambda _: None)
        run_watchdog(api, COMPANY_ID, {"agent-1"}, NOW + timedelta(minutes=1), parent_issue=PARENT_ISSUE, heartbeat_runner=lambda _: None)

        self.assertEqual(len(api.patch_bodies), 1)
        self.assertEqual(api.patch_bodies[0][1]["metadata"]["hermesSwap"]["originalModel"], "gpt-5.5")

    def test_full_revert_restores_adapter_and_clears_hermes_swap(self):
        api = FakePaperclipApi([swapped_agent()])

        result = run_sweeper(api, COMPANY_ID, NOW, parent_issue=PARENT_ISSUE)

        agent = api.agents["agent-1"]
        self.assertEqual(result["reverted"], ["FoundingEngineer → hermes_local/gpt-5.5"])
        self.assertEqual(agent["adapterType"], "hermes_local")
        self.assertEqual(agent["adapterConfig"]["model"], "gpt-5.5")
        self.assertIsNone(agent["metadata"]["hermesSwap"])

    def test_revert_failure_reschedules_swap_back_at_and_preserves_swap_metadata(self):
        api = FakePaperclipApi([swapped_agent()], fail_patch_once=True)

        result = run_sweeper(api, COMPANY_ID, NOW, parent_issue=PARENT_ISSUE)

        swap = api.agents["agent-1"]["metadata"]["hermesSwap"]
        self.assertEqual(result["deferred"], ["FoundingEngineer: HTTP 500 — retrying at 2026-06-16T23:15:00Z"])
        self.assertEqual(swap["originalAdapterType"], "hermes_local")
        self.assertEqual(swap["originalModel"], "gpt-5.5")
        self.assertEqual(swap["swapBackAt"], "2026-06-16T23:15:00Z")

    def test_observability_comments_are_posted_after_swap_and_revert(self):
        swap_api = FakePaperclipApi([hermes_agent()])
        run_watchdog(swap_api, COMPANY_ID, {"agent-1"}, NOW, parent_issue=PARENT_ISSUE, heartbeat_runner=lambda _: None)
        revert_api = FakePaperclipApi([swapped_agent()])
        run_sweeper(revert_api, COMPANY_ID, NOW, parent_issue=PARENT_ISSUE)

        self.assertEqual(len(swap_api.comments), 1)
        self.assertIn("Hermes 429 Auto-Failover", swap_api.comments[0])
        self.assertIn("FoundingEngineer → claude_local/claude-sonnet-4-6", swap_api.comments[0])
        self.assertEqual(len(revert_api.comments), 1)
        self.assertIn("Hermes Revert Sweeper", revert_api.comments[0])
        self.assertIn("FoundingEngineer → hermes_local/gpt-5.5", revert_api.comments[0])

    def test_consolidated_cap_manager_orchestrates_watchdog_and_sweeper_passes(self):
        with tempfile.TemporaryDirectory() as td:
            instance_dir = td
            log_dir = Path(instance_dir) / "data" / "run-logs" / COMPANY_ID
            log_dir.mkdir(parents=True)
            agent_log = log_dir / "agent-1"
            agent_log.mkdir()
            recent_log = agent_log / "run.ndjson"
            recent_log.write_text(json.dumps({"chunk": "API call failed after 3 retries: HTTP 429: quota"}) + "\n")
            recent_time = (NOW - timedelta(minutes=2)).timestamp()
            recent_log.touch()
            import os

            os.utime(recent_log, (recent_time, recent_time))

            api = FakePaperclipApi([hermes_agent()])
            result = run_cap_manager(api, COMPANY_ID, NOW, instance_dir=instance_dir, parent_issue=PARENT_ISSUE, heartbeat_runner=lambda _: None)

            self.assertIn("watchdog", result)
            self.assertIn("sweeper", result)
            self.assertEqual(len(result["watchdog"]["swapped"]), 1)
            self.assertEqual(result["watchdog"]["swapped"][0], "FoundingEngineer → claude_local/claude-sonnet-4-6 (reverts 2026-06-16T23:15:00Z)")
            self.assertEqual(len(result["sweeper"]["reverted"]), 0)


if __name__ == "__main__":
    unittest.main()
