"""The bridge without WanGP: a fake backend whose jobs finish when the test says so. Run with WanGP's Python (it has FastAPI):
    <wangp>/env_venv/Scripts/python.exe -I -m pytest tests  (or: python -I tests/test_bridge.py)"""
from __future__ import annotations

import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bridge import Jobs, create_app, resolve_inputs, stored_name  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402


class FakeJob:
    def __init__(self, files, success=True, error=None):
        self.ready = threading.Event()
        self.files, self.success, self.error = files, success, error
        self.cancelled = False

    def result(self):
        self.ready.wait(5)
        if self.cancelled:
            return SimpleNamespace(success=False, generated_files=[], errors=["cancelled"], cancelled=True)
        return SimpleNamespace(success=self.success, generated_files=self.files, errors=[self.error] if self.error else [], cancelled=False)

    def cancel(self):
        self.cancelled = True
        self.ready.set()


class FakeBackend:
    def __init__(self, out: Path):
        self.out = out
        self.submitted: list[dict] = []
        self.jobs: list[FakeJob] = []

    def submit(self, settings, on_progress):
        if settings.get("model_type") == "refused":
            raise ValueError("unknown model")
        self.submitted.append(settings)
        file = self.out / f"take{len(self.jobs)}.mp4"
        file.write_bytes(b"video")
        job = FakeJob([str(file)])
        self.jobs.append(job)
        on_progress({"phase": "denoising", "percent": 50, "step": 4, "steps": 8})
        return job

    def postprocess(self, media, spatial, temporal, on_progress):
        self.submitted.append({"postprocess": media, "spatial": spatial, "temporal": temporal})
        job = FakeJob([media.replace(".mp4", "_x2.mp4")], success=False, error="no upsampler")
        self.jobs.append(job)
        return job

    def availability(self, model_types):
        return [{"model_type": m, "status": "ready"} for m in model_types]

    def version(self):
        return "20.20"


def wait_until(check, seconds=5):
    end = time.time() + seconds
    while time.time() < end:
        if check():
            return True
        time.sleep(0.02)
    return False


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.backend = FakeBackend(self.dir)
        self.client = TestClient(create_app(Jobs(self.backend), self.dir))

    def test_upload_then_a_job_that_names_it_renders_with_its_server_path(self):
        up = self.client.post("/api/files", files={"file": ("singer.PNG", b"picture", "image/png")}).json()
        again = self.client.post("/api/files", files={"file": ("other-name.png", b"picture", "image/png")}).json()
        self.assertEqual(up["name"], again["name"])  # the same content is kept once
        song = self.client.post("/api/files", files={"file": ("song.wav", b"sound", "audio/wav")}).json()["name"]
        job = self.client.post(
            "/api/jobs",
            json={"settings": {"template": "gen_video_with_refs/H3", "prompt": "p", "image_refs": [up["name"], "D:/kept/as/is.png"], "audio_guide": f"{song}|start_s=9.1"}},
        ).json()
        self.assertIn(job["status"], ("queued", "running"))
        sent = self.backend.submitted[0]
        self.assertEqual(sent["image_refs"], [(self.dir / "inputs" / up["name"]).as_posix(), "D:/kept/as/is.png"])
        self.assertEqual(sent["audio_guide"], (self.dir / "inputs" / song).as_posix() + "|start_s=9.1")
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}").json()["progress"]["step"], 4)
        self.backend.jobs[0].ready.set()
        self.assertTrue(wait_until(lambda: self.client.get(f"/api/jobs/{job['id']}").json()["status"] == "done"))
        done = self.client.get(f"/api/jobs/{job['id']}").json()
        self.assertEqual(done["files"], [{"index": 0, "name": "take0.mp4"}])
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}/files/0").content, b"video")
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}/files/1").status_code, 404)

    def test_what_is_refused(self):
        self.assertEqual(self.client.post("/api/files", files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code, 400)
        self.assertEqual(self.client.post("/api/jobs", json={"settings": {"prompt": "no model"}}).status_code, 400)
        self.assertEqual(self.client.post("/api/jobs", json={"settings": {"model_type": "m", "image_start": "0" * 32 + ".png"}}).status_code, 400)
        refused = self.client.post("/api/jobs", json={"settings": {"model_type": "refused"}}).json()
        self.assertEqual((refused["status"], refused["errors"]), ("failed", ["unknown model"]))
        self.assertEqual(self.client.get("/api/jobs/nope").status_code, 404)
        self.assertEqual(self.client.get("/api/models").status_code, 400)

    def test_cancel_and_a_failed_postprocess(self):
        job = self.client.post("/api/jobs", json={"settings": {"model_type": "m"}}).json()
        self.assertEqual(self.client.delete(f"/api/jobs/{job['id']}").json()["status"], "cancelled")
        self.assertTrue(wait_until(lambda: self.client.get(f"/api/jobs/{job['id']}").json()["finished"]))
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}").json()["status"], "cancelled")
        post = self.client.post("/api/jobs", json={"postprocess": {"media": "D:/x/take.mp4", "spatial": "flashvsr"}}).json()
        self.backend.jobs[-1].ready.set()
        self.assertTrue(wait_until(lambda: self.client.get(f"/api/jobs/{post['id']}").json()["finished"]))
        self.assertEqual(self.client.get(f"/api/jobs/{post['id']}").json()["errors"], ["no upsampler"])
        self.assertEqual(self.client.post("/api/jobs", json={"postprocess": {"media": "D:/x/take.mp4"}}).status_code, 400)

    def test_health_and_models(self):
        self.assertEqual(self.client.get("/api/health").json(), {"bridge": 1, "wangp": "20.20"})
        self.assertEqual(self.client.get("/api/models?ids=a,b").json()[1]["model_type"], "b")

    def test_names(self):
        self.assertTrue(stored_name(b"x", "A.MP4").endswith(".mp4"))
        self.assertEqual(resolve_inputs({"prompt": "0" * 32 + ".png"}, self.dir)["prompt"], "0" * 32 + ".png")


if __name__ == "__main__":
    unittest.main()
