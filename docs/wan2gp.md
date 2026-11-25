# wan2gp as a render engine (experimental)

wan2gp can render beside ComfyUI (#1191): it downloads missing models by itself and manages VRAM and RAM well, also on Radeon cards
and small GPUs. FeverSlop still plans, writes the prompts and checks the takes; wan2gp only renders.

The connection is a small wan2gp plugin in its own repository,
[H256/wangp-feverslop](https://forgejo.elysium.lan/H256/wangp-feverslop): a REST API at `/feverslop` on the wan2gp address. Its jobs join the wan2gp queue, so they share its loaded models and show in its web UI.

```powershell
bun run wan2gp install H:\wan2gp                       # clones the plugin into plugins/, or pulls it; restart wan2gp afterwards
bun run wan2gp health http://127.0.0.1:7860            # does the bridge answer?
bun run wan2gp render http://127.0.0.1:7860 --settings=job.json --out=renders
```

`job.json` is wan2gp settings: a `model_type`, or a Deepy template such as
`"template": "gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps"`, plus `prompt`, `image_refs`, `audio_guide`,
`resolution`, `video_length` and so on. Input files on this machine are uploaded first; the outputs are downloaded into `--out`.

So far this renders one job by hand. Choosing wan2gp per render server, and spreading a project's jobs over ComfyUI and wan2gp
servers, is #1193.
