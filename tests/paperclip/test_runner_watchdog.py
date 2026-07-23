import sys
import unittest
import urllib.request
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.paperclip.runner_watchdog import detect_wedged_runners  # noqa: E402
import scripts.paperclip.runner_watchdog as watchdog_module  # noqa: E402


class _MockResponse:
    """Minimal urllib response mock that supports context-manager protocol."""

    def __init__(self, status: int, body: bytes = b""):
        self.status = status
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


def _make_urlopen(status: int, body: bytes = b""):
    def _urlopen(req):
        return _MockResponse(status, body)

    return _urlopen


class TestDetectWedgedRunners(unittest.TestCase):
    """Test that detect_wedged_runners only flags runners with actual evidence of wedge."""

    def test_online_busy_no_stuck_jobs_not_wedged(self):
        """An online+busy runner with no stuck jobs should NOT be counted as wedged."""
        stuck_jobs = []
        runners_response = {
            "runners": [
                {
                    "id": 123,
                    "name": "runner1",
                    "status": "online",
                    "busy": True,
                }
            ]
        }

        # Mock the gh_api function to return our test runner
        original_gh_api = __import__('scripts.paperclip.runner_watchdog', fromlist=['gh_api']).gh_api

        def mock_gh_api(path, method="GET", body=None):
            if "/runners" in path and method == "GET":
                return runners_response
            return original_gh_api(path, method, body)

        import scripts.paperclip.runner_watchdog as watchdog_module
        watchdog_module.gh_api = mock_gh_api

        try:
            wedged = detect_wedged_runners(stuck_jobs)
            # Should NOT flag this runner as wedged (no stuck jobs evidence)
            self.assertEqual(len(wedged), 0, "Runner with no stuck jobs should not be marked as wedged")
        finally:
            watchdog_module.gh_api = original_gh_api

    def test_online_busy_with_stuck_job_is_wedged(self):
        """An online+busy runner WITH a stuck job should be counted as wedged."""
        runner_id = 123
        stuck_jobs = [
            {
                "runner_id": runner_id,
                "job_name": "unit",
                "run_name": "CI",
                "elapsed_minutes": 50,
                "timeout": 20,
            }
        ]
        runners_response = {
            "runners": [
                {
                    "id": runner_id,
                    "name": "runner1",
                    "status": "online",
                    "busy": True,
                }
            ]
        }

        # Mock the gh_api function
        original_gh_api = __import__('scripts.paperclip.runner_watchdog', fromlist=['gh_api']).gh_api

        def mock_gh_api(path, method="GET", body=None):
            if "/runners" in path and method == "GET":
                return runners_response
            return original_gh_api(path, method, body)

        import scripts.paperclip.runner_watchdog as watchdog_module
        watchdog_module.gh_api = mock_gh_api

        try:
            wedged = detect_wedged_runners(stuck_jobs)
            # SHOULD flag this runner as wedged (has stuck job)
            self.assertEqual(len(wedged), 1, "Runner with stuck job should be marked as wedged")
            self.assertEqual(wedged[0]["runner_id"], runner_id)
        finally:
            watchdog_module.gh_api = original_gh_api

    def test_online_not_busy_not_wedged(self):
        """An online but not-busy runner should NOT be wedged even with stuck jobs."""
        runner_id = 123
        stuck_jobs = [
            {
                "runner_id": 999,  # Different runner
                "job_name": "unit",
                "run_name": "CI",
                "elapsed_minutes": 50,
                "timeout": 20,
            }
        ]
        runners_response = {
            "runners": [
                {
                    "id": runner_id,
                    "name": "runner1",
                    "status": "online",
                    "busy": False,
                }
            ]
        }

        # Mock the gh_api function
        original_gh_api = __import__('scripts.paperclip.runner_watchdog', fromlist=['gh_api']).gh_api

        def mock_gh_api(path, method="GET", body=None):
            if "/runners" in path and method == "GET":
                return runners_response
            return original_gh_api(path, method, body)

        import scripts.paperclip.runner_watchdog as watchdog_module
        watchdog_module.gh_api = mock_gh_api

        try:
            wedged = detect_wedged_runners(stuck_jobs)
            # Should NOT flag this runner (not busy)
            self.assertEqual(len(wedged), 0, "Non-busy runner should not be marked as wedged")
        finally:
            watchdog_module.gh_api = original_gh_api

    def test_multiple_runners_selective_wedge(self):
        """Only runners with stuck jobs should be marked as wedged."""
        runner1_id = 123
        runner2_id = 456
        runner3_id = 789

        stuck_jobs = [
            {
                "runner_id": runner2_id,
                "job_name": "e2e-shard-1",
                "run_name": "CI",
                "elapsed_minutes": 75,
                "timeout": 30,
            }
        ]

        runners_response = {
            "runners": [
                {
                    "id": runner1_id,
                    "name": "runner1",
                    "status": "online",
                    "busy": True,
                },
                {
                    "id": runner2_id,
                    "name": "runner2",
                    "status": "online",
                    "busy": True,
                },
                {
                    "id": runner3_id,
                    "name": "runner3",
                    "status": "online",
                    "busy": True,
                },
            ]
        }

        # Mock the gh_api function
        original_gh_api = __import__('scripts.paperclip.runner_watchdog', fromlist=['gh_api']).gh_api

        def mock_gh_api(path, method="GET", body=None):
            if "/runners" in path and method == "GET":
                return runners_response
            return original_gh_api(path, method, body)

        import scripts.paperclip.runner_watchdog as watchdog_module
        watchdog_module.gh_api = mock_gh_api

        try:
            wedged = detect_wedged_runners(stuck_jobs)
            # Only runner2 should be marked as wedged
            self.assertEqual(len(wedged), 1, "Only 1 runner should be marked as wedged")
            self.assertEqual(wedged[0]["runner_id"], runner2_id)
        finally:
            watchdog_module.gh_api = original_gh_api

    def test_empty_stuck_jobs_no_wedged_runners(self):
        """With no stuck jobs, no runners should be marked as wedged."""
        stuck_jobs = []
        runners_response = {
            "runners": [
                {
                    "id": 123,
                    "name": "runner1",
                    "status": "online",
                    "busy": True,
                },
                {
                    "id": 456,
                    "name": "runner2",
                    "status": "online",
                    "busy": True,
                },
            ]
        }

        # Mock the gh_api function
        original_gh_api = __import__('scripts.paperclip.runner_watchdog', fromlist=['gh_api']).gh_api

        def mock_gh_api(path, method="GET", body=None):
            if "/runners" in path and method == "GET":
                return runners_response
            return original_gh_api(path, method, body)

        import scripts.paperclip.runner_watchdog as watchdog_module
        watchdog_module.gh_api = mock_gh_api

        try:
            wedged = detect_wedged_runners(stuck_jobs)
            # No runners should be marked as wedged without stuck jobs
            self.assertEqual(len(wedged), 0, "No runners should be marked as wedged without stuck jobs")
        finally:
            watchdog_module.gh_api = original_gh_api


class TestCancelRun202(unittest.TestCase):
    """cancel_run/cancel_job must treat GitHub's 202 Accepted as success."""

    def setUp(self):
        self._original_urlopen = urllib.request.urlopen

    def tearDown(self):
        urllib.request.urlopen = self._original_urlopen

    def test_cancel_run_returns_true_on_202(self):
        urllib.request.urlopen = _make_urlopen(202)
        result = watchdog_module.cancel_run(12345)
        self.assertTrue(result, "cancel_run must return True for HTTP 202")

    def test_cancel_run_returns_false_on_error(self):
        urllib.request.urlopen = _make_urlopen(500)
        result = watchdog_module.cancel_run(12345)
        self.assertFalse(result, "cancel_run must return False for HTTP 500")

    def test_cancel_job_returns_true_on_202(self):
        urllib.request.urlopen = _make_urlopen(202)
        result = watchdog_module.cancel_job(67890, 12345, "unit-test-job")
        self.assertTrue(result, "cancel_job must return True for HTTP 202")

    def test_cancel_job_returns_false_on_error(self):
        urllib.request.urlopen = _make_urlopen(500)
        result = watchdog_module.cancel_job(67890, 12345, "unit-test-job")
        self.assertFalse(result, "cancel_job must return False for HTTP 500")


class TestForceCancelRun(unittest.TestCase):
    """force_cancel_run must hit the dedicated /force-cancel endpoint exactly
    once, not call /cancel twice (a second /cancel doesn't escalate to a
    force-cancel and can 409 on an already-cancelling run, misreporting a
    successful cancel as a failure)."""

    def setUp(self):
        self._original_urlopen = urllib.request.urlopen

    def tearDown(self):
        urllib.request.urlopen = self._original_urlopen

    def test_force_cancel_run_hits_force_cancel_endpoint_once(self):
        requests = []

        def _urlopen(req):
            requests.append((req.full_url, req.get_method()))
            return _MockResponse(202)

        urllib.request.urlopen = _urlopen
        result = watchdog_module.force_cancel_run(12345)

        self.assertTrue(result, "force_cancel_run must return True for HTTP 202")
        self.assertEqual(
            requests,
            [(f"https://api.github.com/repos/{watchdog_module.REPO}/actions/runs/12345/force-cancel", "POST")],
            "force_cancel_run must call /force-cancel exactly once, not /cancel twice",
        )

    def test_force_cancel_run_returns_false_on_error(self):
        urllib.request.urlopen = _make_urlopen(500)
        result = watchdog_module.force_cancel_run(12345)
        self.assertFalse(result, "force_cancel_run must return False for HTTP 500")


if __name__ == "__main__":
    unittest.main()
