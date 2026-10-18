# Roudnice v čase

Interaktivní 3D vizualizace historického vývoje města **Roudnice nad Labem** od roku 0 do roku 2026.

- **3D krajina** dnešního území města: Labe, skalní terasa se zámkem, niva na severním břehu a hora Říp v pozadí.
- **Časová osa** ve spodní části obrazovky (0–2026) s barevnými značkami historických událostí. Lze ji táhnout, klikat na značky nebo spustit přehrávání.
- Zástavba, lesy, pole, cesty, železnice i památky (biskupský hrad, kamenný most Jana IV. z Dražic, augustiniánský klášter, hradby, Hláska, kapucínský klášter, barokní zámek, synagogy, nádraží, železný most, sídliště, obchvat…) se objevují a mizí podle roku.
- Válečné pohromy (husité, Švédové) jsou znázorněny kouřem a vypálenými domy, povodně 2002 a 2013 rozlitím Labe.
- V **pravém horním rohu** je orientační počet obyvatel včetně grafu vývoje (do roku 1869 odhad, poté sčítání lidu).

## Spuštění

Stránka je statická (HTML + JavaScript, Three.js z CDN). Kvůli ES modulům ji spusťte přes libovolný webový server, např.:

```sh
python3 -m http.server 8000
# a otevřete http://localhost:8000
```

Stránku lze nasadit i na GitHub Pages bez dalšího sestavování.

## Ovládání

- myš: levé tlačítko otáčí, pravé posouvá, kolečko přibližuje
- `Mezerník` přehrát / pozastavit, `←` `→` ±1 rok (`Shift` ±10 let), `PgUp` / `PgDn` předchozí / další událost

## Struktura

- `index.html` – rozložení stránky
- `css/style.css` – vzhled panelů a časové osy
- `js/data.js` – historické události, období a vývoj počtu obyvatel (snadno rozšiřitelné)
- `js/geo.js` – tok Labe, železnice, silnice a půdorysy budov z OpenStreetMap (generovaný soubor)
- `js/main.js` – 3D scéna (terén, zástavba podle období, památky, okolní obce) a ovládání
- `js/real.js` – skutečný 3D povrch z dat ČÚZK (lidar + ortofoto)
- `js/hist.js` – dobové mapy (vojenská mapování) položené na terén
- `data/real/` – připravené výškové mřížky, letecké snímky a výšky budov (generované soubory)
- `tools/build_geo.py` – skript, který z OSM API stáhne data a vygeneruje `js/geo.js`
  (`python3 tools/build_geo.py`)
- `tools/build_real.py` – skript, který ze služeb ČÚZK stáhne DMR 5G, DMP 1G a ortofoto a vygeneruje `data/real/`
  (`python3 tools/build_real.py`, vyžaduje numpy a Pillow; spouštět po `build_geo.py`)
- `tools/build_city.py` – 3D model současných budov (půdorysy OSM, tvar střech z lidaru, barva z ortofota)
  a stromů z lidaru → `data/real/city.bin`, `trees.bin` (vyžaduje také scipy)
- `tools/build_hist.py` – z 2. a 3. vojenského mapování určí, které budovy stály kolem let 1845 a 1878
  → `data/hist_flags.bin`

## Skutečný 3D model

Pro současnost (od roku 2013) stránka ukazuje skutečný model města: terén z digitálního modelu reliéfu DMR 5G
s ortofotem ČÚZK, budovy s půdorysy z OpenStreetMap, svislými stěnami a tvarem střech podle digitálního modelu
povrchu DMP 1G (letecké laserové skenování 2009–2013) a stromy podle lidaru (© ČÚZK, CC BY 4.0). Barva fasád
není z leteckých dat známa, proto jsou stěny v neutrální omítce. Přepínačem „Skutečný 3D model“ lze porovnat se schematickou rekonstrukcí. Terén pro
historická období je také skutečný (DMR 5G), stejně jako výšky dnešních budov.

## Dobové mapy

Pro roky 1842–1876 se na terén pokládá 2. vojenské mapování (1842–1852) a pro roky 1877–1952 3. vojenské mapování
(1877–1880). Dlaždice se načítají za běhu z Virtuální mapové sbírky Chartae Antiquae (© VÚGTK, v.v.i.,
https://www.chartae-antiquae.cz/), do repozitáře se nekopírují (`js/hist.js`).

## Stáří budov podle dobových map

U každé dnešní budovy se z 2. vojenského mapování (1842–1852) a 3. vojenského mapování (1877–1880) zjišťuje,
zda na jejím místě stála zástavba (`tools/build_hist.py`). Budovy, které na mapách nejsou, se v rekonstrukci objeví
až po roce 1880. Tvar mostu z roku 1910, kostela Narození P. Marie a Kratochvílovy rozhledny vychází z dobových
fotografií projektu Historická Roudnice nad Labem (https://historicka.roudnice.eu/).

## Poznámka k přesnosti

Tok Labe, železnice, silnice a půdorysy dnešních budov (Roudnice, Vědomice, Dobříň, Podlusky, Kyškovice…)
pocházejí z OpenStreetMap (© přispěvatelé OpenStreetMap, ODbL). Doba vzniku jednotlivých domů je odhadnutá podle
polohy (Staré Město, předměstí, vilové čtvrti, sídliště), podoba zaniklých staveb je schematická a vzdálenější obce
jsou znázorněny jen orientačně. Počty obyvatel před rokem 1869 jsou odhady. Zdroje jsou uvedeny přímo na stránce (tlačítko „i“).
