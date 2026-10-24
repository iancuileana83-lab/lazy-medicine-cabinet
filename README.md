# Lazy Medicine Cabinet

Take a photo of your medicine boxes. A **Gemma 3 vision model running locally on your laptop** (through [Ollama](https://ollama.com)) reads the boxes and builds a small inventory: product name as printed, expiry date, and a status (expired, expires within 30 days, expires within 90 days, OK). You can correct any line by hand. Expired items get a reminder to take them back to a pharmacy.

**Nothing leaves your laptop.** No cloud APIs, no telemetry, no external fonts or scripts. The web server listens on `127.0.0.1` only, and its only outgoing connection is to Ollama on the same machine.

> **Important.** Lazy Medicine Cabinet can misread labels. Always check each line against the real box. This tool gives no medical advice, doses or interaction information. Ask a pharmacist or doctor about your medicines.

Built for the DEV Hacktoberfest Open-Source AI Challenge (week 3, "Slow and Steady"), Gemma category: the model runs locally.

![The app after scanning three boxes](docs/screenshot-results.png)

When the model cannot read a date properly (here it returned `Use by 32/2026`), the app does not guess. It asks you to check the box:

![An unreadable date is flagged, not guessed](docs/screenshot-unreadable-date.png)

## How it works

1. The browser shrinks your photo (longest side 1024 px) and sends it to the local server.
2. The server asks `gemma3:4b` (via `http://127.0.0.1:11434`) to copy the name and the expiry text **exactly as printed**. The prompt forbids describing uses, doses or advice.
3. The app parses the printed date and computes the status **in code**, not with the model.
4. You review and fix any line. Your list is saved in `data/cabinet.json` on your disk.

Month-only dates are treated as the end of that month (`EXP 03/2027` is valid through 2027-03-31). Dates are read day-first (`31/10/2026`) or ISO (`2026-10-31`). A date the app cannot parse is shown as "Date not found, please check the box and enter it by hand."

## Run it

You need Node 20+, [Ollama](https://ollama.com/download), and about 5 GB of free RAM.

```bash
ollama pull gemma3:4b      # about 3.3 GB, one time
npm install                # only needed for the browser test
npm start                  # http://localhost:3977
```

Set `LMC_MODEL` to use another vision model (for example `gemma3n:e2b`) and `PORT` to change the port.

**Speed.** On the development laptop (Intel Core i3-1005G1, 2 cores, 7.8 GB RAM, no GPU) one photo takes **about 60 to 85 seconds**. A GPU makes this much faster. The app shows a progress message and handles one photo at a time.

## How well does it read? (honest numbers)

There are no real-world medicine photos in this repository. The test photos in [`samples/generated/`](samples/generated) are **generated pictures of fictional boxes** (invented brands, no real logos or packaging), rendered with CSS 3D and Playwright with angle, blur, glare and noise: [`tools/make-samples.mjs`](tools/make-samples.mjs). They are easier than many real boxes (clean fonts, no curved or shiny blister foil), so treat the numbers as a floor for "does the pipeline work", not as a promise for your cabinet. The ground truth is in `truth.json`; scores come from [`tools/score.mjs`](tools/score.mjs) and the raw model outputs are committed too.

7 boxes in 5 photos (one photo has the date printed small on the side, one has three boxes):

| | Prompt v1 | Prompt v2 (current) |
|---|---|---|
| Full name read (brand + medicine + strength) | 2 / 7 | **7 / 7** |
| Date value correct | 6 / 7 | 6 / 7 |
| Status correct | 6 / 7 | 6 / 7 |
| Time for 5 photos | 344 s | 344 s |

Dates did **not** improve with the better prompt. Different boxes failed in each run: v1 misread `Use by 12/2026` as `Use by 32/2026` on one box of the three-box photo (and read the small side date correctly), while v2 read that box correctly but misread the small side date `12/2026` as `32/2026`. In both cases the app showed "Date not found" instead of a wrong status. Other quirks: the model sometimes replaces "Use by" with "EXP", and v2 adds the pack size ("20 tablets") to the name. This is one run per prompt on one machine, a small sample: expect misreads, and always check the box.

## Tests

```bash
npm test
```

- unit tests for date parsing and status boundaries (month-only dates, leap years, impossible dates),
- unit tests for parsing the model's output (code fences, junk, duplicates) with a mocked Ollama,
- a Playwright end-to-end test of the real app with a stand-in for Ollama (needs `npx playwright install chromium` once). It also checks that no request leaves localhost.

To re-run the model on the sample photos: `node tools/run-samples.mjs generated`, then `node tools/score.mjs results.json` (needs Ollama and ffmpeg).

## Privacy and safety

- No cloud services, accounts, analytics or telemetry. Requests with a non-localhost `Host` header are refused.
- Your own photos: put them in `samples/` (git-ignored) and your inventory lives in `data/` (git-ignored).
- The app never gives medical advice, doses or interactions, and it says so on screen. Take expired medicines back to a pharmacy for safe disposal; don't bin or flush them.

## License

MIT, see [LICENSE](LICENSE).
