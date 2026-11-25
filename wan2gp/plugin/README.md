# FeverSlop Bridge (wan2gp plugin)

A small REST API inside a running wan2gp, so that FeverSlop can use wan2gp as a render engine beside ComfyUI. FeverSlop plans, writes
the prompts and checks the takes; wan2gp only renders. Jobs join the normal wan2gp queue: they use the models it has loaded, its memory
management and its model downloads, and they show up in its web UI like any other task. Outputs record in a workspace of their own
("FeverSlop"), so the gallery you are looking at does not change.

This plugin is not part of wan2gp. It uses the wan2gp plugin API (`register_web_app`, `deepy.web_session`). wan2gp is under the WanGP
Community License 2.0.

## Install

From the FeverSlop checkout, into the wan2gp folder (then restart wan2gp):

```powershell
bun run wan2gp install H:\wan2gp
bun run wan2gp health http://127.0.0.1:7860
```

The plugin goes to `<wan2gp>/plugins/wangp-feverslop`. wan2gp's `.gitignore` ignores folders named `wangp-*`, so updating wan2gp with
`git pull` is not disturbed. Running the install again replaces the plugin's files with the current ones.

## API

Served at `/feverslop` on the wan2gp address (for example `http://my-gpu-box:7860/feverslop`), behind the wan2gp login when it has one.
Paths on the wire use `/` only.

| Call | What it does |
| --- | --- |
| `GET /api/health` | `{"bridge": 1, "wangp": "20.20"}` |
| `POST /api/files` (multipart `file`) | Keeps an input file (picture, video, sound) on the server under its content hash: `{"name": "<hash>.png"}`. The same file is kept once. |
| `POST /api/jobs` `{"settings": {...}}` | A generation: WanGP settings with a `model_type`, or a Deepy `template` (`"gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps"`) plus the keys that change. Inputs (`image_refs`, `image_start`, `image_end`, `audio_guide`, `video_source`, ...) may name uploaded files by their `name`; `"<name>\|start_s=9.1"` keeps its suffix. |
| `POST /api/jobs` `{"postprocess": {"media": ..., "spatial": ..., "temporal": ...}}` | An upscale (`spatial`) or frame interpolation (`temporal`, e.g. RIFE) of a file on the server. |
| `GET /api/jobs/{id}` | `status` (queued, running, done, failed, cancelled), `progress` (phase, percent, step/steps, window/windows), `files`, `errors`. |
| `GET /api/jobs/{id}/files/{index}` | An output file. |
| `DELETE /api/jobs/{id}` | Cancels the job. |
| `GET /api/jobs` | The jobs of this WanGP run. A restart forgets them; their files stay in `outputs/feverslop/`. |
| `GET /api/models?ids=a,b` | Whether these models are installed (WanGP downloads a missing one when a job needs it). |

```powershell
$server = "http://127.0.0.1:7860/feverslop"
$ref = (curl.exe -s -F "file=@singer.png" "$server/api/files" | ConvertFrom-Json).name
$body = @{settings = @{template = "gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps"; prompt = "..."; image_refs = @($ref); resolution = "832x480"; video_length = "5s"}} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -ContentType application/json -Body $body "$server/api/jobs"
```

## Tests

Without a GPU, with wan2gp's Python (it has FastAPI), from this folder:

```powershell
<wan2gp>\env_venv\Scripts\python.exe -I tests\test_bridge.py
```
