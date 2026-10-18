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
- `js/main.js` – 3D scéna (terén, generovaná zástavba podle období, památky) a ovládání

## Poznámka k přesnosti

Model je schematický: polohy staveb odpovídají skutečnosti přibližně a běžná zástavba je generovaná procedurálně
podle období. Počty obyvatel před rokem 1869 jsou odhady. Zdroje jsou uvedeny přímo na stránce (tlačítko „i“).
