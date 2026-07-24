# Live DeepSeek run — results (evidence)

Phase 27 COOK-01. Real end-to-end runs against `deepseek-v4-pro` (api.deepseek.com),
2026-07-24, iteration-3 prompt (`../extraction-skill/assets/linkage-fragment.txt`).
No secret is stored here — the key lives only in the gitignored `.env`.

Reproduce: `cp .env.example .env` → put your key in it → `npm run e2e` (full pipeline)
and `npm run evals -- --live` (failure-mode suite).

## Environment notes
- **Camoufox NOT reachable** here (`camofox:9377` is the docker-internal host, ENOTFOUND
  outside the stack) → the harness used norish's documented **plain-fetch fallback**,
  and says so on every run. The scrape + sanitize are otherwise real.
- Chosen URLs: AH Allerhande / Allrecipes were tried first but return 307/403 to a
  plain fetch (they *require* Camoufox). The two below return 200 + JSON-LD to a plain
  fetch, so they are the harness targets.

## Eval suite (6 failure-mode fixtures) — real DeepSeek vs Claude stand-in

| Source                | Fixtures pass | Checks pass |
|-----------------------|---------------|-------------|
| Claude stand-in       | 6 / 6         | 38 / 38     |
| **LIVE deepseek-v4-pro (it.3)** | **6 / 6** | **38 / 38 (100%)** |
| live baseline (it.2)  | 3 / 6         | 35 / 38     |

Iteration history (what live output revealed → fix):
- it.1→2: DeepSeek used whole list-line as `name` (nothing anchored, 35 appended) and
  carried every ingredient forward → added the anchor rule + anti-cumulative rule.
- it.2→3: olive oil `2 tbsp`→`30 ml` self-conversion, and section headings dropped →
  added "units as written" + "# Heading section" rules. (Curry's split-amount step
  placement was a wrong assertion, not a model error → harness fix.)

Split-amount curry is correctly classified **low confidence** (not hidden).

## LIVE `.cook` — Dutch (LeukeRecepten spaghetti bolognese), iteration 2 prompt shown
6/6 checks, 0 appended, confidence trusted.

```cook
---
title: Spaghetti bolognese
source: "https://www.leukerecepten.nl/recepten/spaghetti-bolognese/"
norish.system: metric
---
Bak de @spekjes{125%gram} in een droge koekenpan totdat het meeste vocht en vet verdwenen is.

Snipper de @ui{1} en hak de @wortels{150%gram} in blokjes en voeg toe aan het @spek.

Voeg het @gehakt{500%gram} toe en bak dit rul. Doe daarna de @tomatenpuree{1%klein blikje} er bij en bak 2 minuutjes mee. ~{2%minuten}

Los het @bouillonblokje{1} op in 100 ml kokend water. Voeg de bouillon samen met de @tomatenblokjes{600%milliliter} toe aan de pan.

Breng de saus op smaak met @oregano{1%teaspoon} en eventueel een snufje @peper en zout{}. Je hebt waarschijnlijk geen of weinig extra zout nodig want de spek en bouillon is ook al zout, dus let op.

Laat de bolognesesaus ca. 20 tot 25 minuten pruttelen tot hij mooi is ingedikt. Heb je niet zo veel tijd, gebruik dan een beetje allesbinder of maizena om de bolognese saus sneller te laten binden. ~{25%minuten}

Kook ondertussen de @spaghetti{300%gram} gaar. Serveer de pasta met de bolognesesaus op een bord. Garneer de spaghetti bolognese met wat verse @basilicum en @Parmezaanse kaas{}.
```

Per-step amounts (round-tripped through the WASM parser): spekjes=125 g · ui=1,
wortels=150 g · gehakt=500 g, tomatenpuree=1 (~2 min) · bouillonblokje=1,
tomatenblokjes=600 ml · oregano=1 tsp, peper en zout=bare · (~25 min) · spaghetti=300 g,
basilicum/Parmezaanse kaas=bare.

## LIVE `.cook` — English (BBC Good Food classic pancakes)
6/6 checks, 0 appended, confidence trusted.

```cook
---
title: Classic pancakes
source: "https://www.bbcgoodfood.com/recipes/classic-pancakes"
norish.system: metric
---
Sift the @flour{100%gram} and a pinch of @salt into a bowl. Make a well in the centre with the back of a spoon then break in the @egg{1} and pour in half the @milk{300%milliliter}. Whisk together, gradually incorporating the flour to make a smooth thick batter. Beat thoroughly to remove any lumps, then stir in the rest of the milk.

Heat a little @oil or butter{} in a medium frying pan, then tip off the excess into a bowl. Pour about 2 tablespoons of batter into the pan, tilting the pan as you pour, until the batter thinly coats the base. Cook over a moderate heat for 30 seconds to one minute until golden brown on the underside. ~{1%minutes}

Flip over the pancake with a palette knife, and cook the other side until it is golden brown. Slide the pancake out of the pan on to a plate, heat a little more @oil or butter{} and cook the remaining pancakes one at a time in the same way.

If preparing in advance, cook and stack the pancakes. Reheat in the microwave on Medium (750W) for about 2 minutes. Alternatively, heat the oven to 180C/gas 4/fan 160C. Wrap the pancakes in foil and warm them through in the oven for 10 minutes. ~{2%minutes} ~{10%minutes}
```

Per-step amounts: flour=100 g, salt=bare, egg=1, milk=300 ml · oil or butter=bare (~1 min) ·
(flip) · (~2 min, ~10 min). Every amount inline on the right step; 0 appended.
