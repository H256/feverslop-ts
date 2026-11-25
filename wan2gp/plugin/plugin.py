"""WanGP plugin: the FeverSlop render bridge (see bridge.py and README.md)."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from shared.utils.plugins import WAN2GPPlugin

from .bridge import Jobs, create_app

FOLDER_NAME = "feverslop"
WORKSPACE_NAME = "FeverSlop"


class _Progress:
    """WanGP's progress callbacks, handed on as a plain dict."""

    def __init__(self, report: Callable[[dict[str, Any]], None]):
        self._report = report

    def on_progress(self, update) -> None:
        self._report(
            {
                "phase": getattr(update, "phase", ""),
                "status": getattr(update, "status", ""),
                "percent": getattr(update, "progress", 0),
                "step": getattr(update, "current_step", None),
                "steps": getattr(update, "total_steps", None),
                "window": getattr(update, "window_index", None),
                "windows": getattr(update, "window_count", None),
            }
        )


class WanGPBackend:
    """The bridge's jobs on WanGP: tasks join the web UI's queue from any thread (the plugin's web session), and record in a workspace
    of their own, so the user's gallery is not changed."""

    def __init__(self, plugin: "FeverSlopBridge", folder: Path):
        self.plugin = plugin
        self.folder = folder
        self._workspace: str | None = None

    def _session(self):
        deepy = self.plugin.deepy  # raises before the web UI is up
        if self._workspace is None:
            self._workspace = deepy.ensure_workspace(WORKSPACE_NAME, self.folder / "outputs")
        return deepy.web_session(self._workspace)

    def submit(self, settings: dict[str, Any], on_progress):
        session = self._session()
        if settings.get("template"):
            # a Deepy template ("gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps"): its model, LoRAs and steps, with the job's
            # keys over them; its example prompt is dropped
            from shared.mcp.server import _deepy_template_settings

            task, _, name = str(settings["template"]).partition("/")
            base = {k: v for k, v in _deepy_template_settings(session, task, name.strip() or "default")["settings"].items() if k not in ("prompt", "alt_prompt")}
            merged = {**base, **{k: v for k, v in settings.items() if k != "template"}}
            if isinstance(base.get("custom_settings"), dict) and isinstance(settings.get("custom_settings"), dict):
                merged["custom_settings"] = {**base["custom_settings"], **settings["custom_settings"]}
            settings = merged
        return session.submit_task(settings, callbacks=_Progress(on_progress))

    def postprocess(self, media: str, spatial: str, temporal: str, on_progress):
        return self._session().submit_media_postprocessing(media, spatial_upsampling=spatial, temporal_upsampling=temporal, callbacks=_Progress(on_progress))

    def availability(self, model_types: list[str]) -> list[dict[str, Any]]:
        session = self._session()
        return [{"model_type": m, **session.get_model_availability(m)} for m in model_types]

    def version(self) -> str:
        return str(getattr(self.plugin, "WanGP_version", "") or "")


class FeverSlopBridge(WAN2GPPlugin):
    def __init__(self):
        super().__init__()
        self.name = "FeverSlop Bridge"
        self.version = "0.1.0"
        self.description = "A REST API at /feverslop for FeverSlop's render jobs: they join this WanGP's queue."

    def setup_ui(self):
        self.request_global("WanGP_version")
        self.register_web_app("/feverslop", self._create_web_app)

    def _create_web_app(self):
        folder = (Path.cwd() / "outputs" / FOLDER_NAME).resolve()
        folder.mkdir(parents=True, exist_ok=True)
        return create_app(Jobs(WanGPBackend(self, folder)), folder)
