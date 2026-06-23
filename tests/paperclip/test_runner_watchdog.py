import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.paperclip.runner_watchdog import detect_wedged_runners  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
