# LUMIVERSION

**Feed, growth and footprint planning for largemouth bass.**

LUMIVERSION builds a three-stage feeding plan for a production cycle and shows what it means for growth, cost, profit and environmental footprint. It also estimates fish weight from underwater stereo camera images.

Open `index.html` in any modern browser. Nothing to install.

## What it does

- **Plans the diet for each growth stage** (fry, fingerling, grow-out) from your ingredient list, prices and nutrient limits.
- **Four goals:** lowest feed cost, maximum profit, profit + environment (profit 50%, carbon 35%, phosphorus 15%), or a balanced plan.
- **Forecasts growth** day by day from stocking weight, cycle length and water temperature.
- **Reports the business case:** harvest weight, revenue, feed cost, gross margin, FCR, break-even fish price and a fish-price scenario tool.
- **Tracks the footprint:** carbon (kg CO₂e) and freshwater phosphorus (kg P eq), by stage and by ingredient.
- **Estimates weight from camera images:** automatic detection on upload, two-click measurement, saved measurement records with CSV export, and standing-stock totals.
- **Compares plans** side by side.

All money is shown in pounds sterling at an editable exchange rate.

## Ingredient data

The LUMIVERSION ingredient library is stored encrypted and unlocks with an access code. You can also use the demo library or upload your own CSV with these columns:

`name, price, LB, UB, DM, CP, EE, ST, LYS, P, ADC-N, ADC-L` and, optionally, `GWP, EP_P`.

## Run locally

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Serve the folder over HTTP rather than opening the file directly, so the camera tools and the ingredient library can load.

## Publish

GitHub: *Settings → Pages → Deploy from a branch → `main` / root*. Any static host (Netlify, Cloudflare Pages, Vercel) also works.

---

© 2026 LUMIVERSION. Results are model forecasts for planning purposes; check them against site conditions before acting on them.
