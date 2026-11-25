"""The FeverSlop render bridge: a small REST API for render jobs inside a running WanGP.

FeverSlop plans, prompts and checks on its side; WanGP only renders. A job is WanGP settings JSON (a `model_type`, or a Deepy template
as "task/name", plus the keys that change), or a postprocess of a file already on the server (spatial or temporal upsampling). Jobs
join WanGP's normal queue through the plugin's web session, so they share its loaded models and memory management and show in its
web UI. Input files are uploaded first and named by their content; outputs are downloaded by job and index.

Paths on the wire use "/" only. Nothing here imports WanGP at module level: the app takes a `Backend`, so it can be tested without
a GPU (tests/test_bridge.py).
"""

import hashlib
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

API_VERSION = 1
MEDIA_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".mkv", ".webm", ".wav", ".mp3", ".flac", ".ogg", ".m4a"}
MAX_UPLOAD_BYTES = 2 * 1024**3
# the settings keys that name input files: a bare name of an uploaded file is turned into its server path
MEDIA_KEYS = ("image_refs", "image_start", "image_end", "image_guide", "video_guide", "video_source", "video_mask", "image_mask", "audio_guide", "audio_guide2", "audio_source")


class Backend(Protocol):
    """What the bridge asks of WanGP: a job for settings or a postprocess, model availability, and its version."""

    def submit(self, settings: dict[str, Any], on_progress: Callable[[dict[str, Any]], None]) -> Any: ...

    def postprocess(self, media: str, spatial: str, temporal: str, on_progress: Callable[[dict[str, Any]], None]) -> Any: ...

    def availability(self, model_types: list[str]) -> list[dict[str, Any]]: ...

    def version(self) -> str: ...


@dataclass
class Job:
    id: str
    kind: str  # "generate" or "postprocess"
    created: float
    handle: Any = None  # WanGP's SessionJob
    status: str = "queued"  # queued, running, done, failed, cancelled
    progress: dict[str, Any] = field(default_factory=dict)
    files: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    finished: float | None = None

    def view(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "created": self.created,
            "finished": self.finished,
            "progress": self.progress,
            "files": [{"index": i, "name": Path(f).name} for i, f in enumerate(self.files)],
            "errors": self.errors,
        }


class Jobs:
    """The jobs of this WanGP run, in memory: a restart forgets them (their files stay in the bridge's folder)."""

    def __init__(self, backend: Backend, keep: int = 500):
        self.backend = backend
        self.keep = keep
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def _start(self, kind: str, run: Callable[[Callable[[dict[str, Any]], None]], Any]) -> Job:
        job = Job(id=uuid.uuid4().hex, kind=kind, created=time.time())

        def on_progress(update: dict[str, Any]) -> None:
            job.progress = update
            if job.status == "queued":
                job.status = "running"

        with self._lock:
            self._jobs[job.id] = job
            self._forget_old()
        try:
            job.handle = run(on_progress)
        except Exception as error:  # a refused submission is a failed job, said in its errors
            job.status, job.errors, job.finished = "failed", [str(error)], time.time()
            return job
        threading.Thread(target=self._wait, args=(job,), daemon=True).start()
        return job

    def _wait(self, job: Job) -> None:
        try:
            result = job.handle.result()
        except Exception as error:
            job.status, job.errors = "failed", [str(error)]
        else:
            job.files = [str(Path(f)) for f in (getattr(result, "generated_files", None) or [])]
            job.errors = [str(e) for e in (getattr(result, "errors", None) or [])]
            cancelled = bool(getattr(result, "cancelled", False)) or job.status == "cancelled"
            job.status = "cancelled" if cancelled else "done" if getattr(result, "success", False) and job.files else "failed"
            if job.status == "failed" and not job.errors:
                job.errors = ["WanGP made no file"]
        job.finished = time.time()

    def _forget_old(self) -> None:
        finished = sorted((j for j in self._jobs.values() if j.finished), key=lambda j: j.finished or 0)
        for job in finished[: max(0, len(self._jobs) - self.keep)]:
            del self._jobs[job.id]

    def generate(self, settings: dict[str, Any]) -> Job:
        return self._start("generate", lambda on_progress: self.backend.submit(settings, on_progress))

    def postprocess(self, media: str, spatial: str, temporal: str) -> Job:
        return self._start("postprocess", lambda on_progress: self.backend.postprocess(media, spatial, temporal, on_progress))

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> Job | None:
        job = self._jobs.get(job_id)
        if job and not job.finished:
            job.status = "cancelled"
            if job.handle is not None:
                job.handle.cancel()
        return job

    def all(self) -> list[Job]:
        return sorted(self._jobs.values(), key=lambda j: j.created)


def stored_name(data: bytes, filename: str) -> str:
    """An upload's name on the server: its content's hash and its suffix, so the same file is kept once."""
    suffix = Path(filename).suffix.lower()
    if suffix not in MEDIA_SUFFIXES:
        raise ValueError(f"not a media file the bridge takes: {filename}")
    return hashlib.sha256(data).hexdigest()[:32] + suffix


def resolve_inputs(settings: dict[str, Any], inputs: Path) -> dict[str, Any]:
    """The settings with every input named by an uploaded file's name (as /files returned it) given as its path on the server.
    A value that is not such a name stays as it is (a path the user's WanGP knows, a gallery id); "|start_s=..." suffixes are kept."""
    pattern = re.compile(r"^[0-9a-f]{32}\.[a-z0-9]+$")

    def one(value: Any) -> Any:
        if not isinstance(value, str):
            return value
        name, bar, rest = value.partition("|")
        if pattern.match(name):
            path = inputs / name
            if not path.is_file():
                raise ValueError(f"no uploaded file {name}: upload it first")
            return path.as_posix() + bar + rest
        return value

    out = dict(settings)
    for key in MEDIA_KEYS:
        if key in out:
            out[key] = [one(v) for v in out[key]] if isinstance(out[key], list) else one(out[key])
    return out


def create_app(jobs: Jobs, folder: Path):
    """The REST API, served by WanGP at /feverslop (behind its login when it has one)."""
    from fastapi import FastAPI, File, HTTPException, UploadFile
    from fastapi.responses import FileResponse

    inputs = folder / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="FeverSlop bridge", docs_url=None, redoc_url=None, openapi_url=None)

    def found(job_id: str) -> Job:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(404, f"no job {job_id}")
        return job

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"bridge": API_VERSION, "wangp": jobs.backend.version()}

    @app.post("/api/files")
    async def upload(file: UploadFile = File(...)) -> dict[str, Any]:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "the file is larger than 2 GB")
        try:
            name = stored_name(data, file.filename or "")
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        target = inputs / name
        if not target.exists():
            partial = target.with_suffix(target.suffix + ".partial")
            partial.write_bytes(data)
            partial.replace(target)
        return {"name": name, "bytes": len(data)}

    @app.post("/api/jobs")
    def submit(body: dict[str, Any]) -> dict[str, Any]:
        if isinstance(body.get("postprocess"), dict):
            p = body["postprocess"]
            media = resolve_inputs({"video_source": p.get("media")}, inputs)["video_source"]
            if not isinstance(media, str) or not media:
                raise HTTPException(400, "postprocess needs the media to work on")
            spatial, temporal = str(p.get("spatial") or ""), str(p.get("temporal") or "")
            if not spatial and not temporal:
                raise HTTPException(400, "postprocess needs a spatial or a temporal upsampler")
            return jobs.postprocess(media, spatial, temporal).view()
        settings = body.get("settings")
        if not isinstance(settings, dict) or not (settings.get("model_type") or settings.get("template")):
            raise HTTPException(400, 'a job is {"settings": {...}} with a model_type or a template, or {"postprocess": {...}}')
        try:
            resolved = resolve_inputs(settings, inputs)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return jobs.generate(resolved).view()

    @app.get("/api/jobs")
    def listing() -> list[dict[str, Any]]:
        return [job.view() for job in jobs.all()]

    @app.get("/api/jobs/{job_id}")
    def status(job_id: str) -> dict[str, Any]:
        return found(job_id).view()

    @app.delete("/api/jobs/{job_id}")
    def cancel(job_id: str) -> dict[str, Any]:
        found(job_id)
        return (jobs.cancel(job_id) or found(job_id)).view()

    @app.get("/api/jobs/{job_id}/files/{index}")
    def download(job_id: str, index: int):
        job = found(job_id)
        if not 0 <= index < len(job.files) or not Path(job.files[index]).is_file():
            raise HTTPException(404, f"job {job_id} has no file {index}")
        return FileResponse(job.files[index], filename=Path(job.files[index]).name)

    @app.get("/api/models")
    def models(ids: str = "") -> list[dict[str, Any]]:
        wanted = [i for i in (s.strip() for s in ids.split(",")) if i]
        if not wanted:
            raise HTTPException(400, "?ids=<model_type>,... names the models to look up")
        try:
            return jobs.backend.availability(wanted)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    return app
