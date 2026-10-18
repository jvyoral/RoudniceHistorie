// Historická data pro vizualizaci Roudnice nad Labem.
// Souřadnice v 3D scéně: 1 jednotka ≈ 10 m, osa x = východ, osa z = jih (sever = -z).
// Náměstí (Karlovo nám.) leží zhruba v bodě [5, 15], zámek v [-14, -6], most v x ≈ 2.

export const YEAR_MIN = 0;
export const YEAR_MAX = 2026;

// Kategorie událostí – barva značky na časové ose.
export const CATEGORIES = {
  osidleni: { label: 'Osídlení', color: '#8fbf6a' },
  stavba:   { label: 'Stavby',   color: '#e0b25c' },
  valka:    { label: 'Války a pohromy', color: '#e0645c' },
  panstvi:  { label: 'Majitelé a správa', color: '#7aa7e0' },
  kultura:  { label: 'Kultura', color: '#c48fe0' },
  doprava:  { label: 'Doprava a průmysl', color: '#5cc8c8' },
};

// Události. `focus` = [x, z, vzdálenost kamery] – kam se při kliknutí podívat.
export const EVENTS = [
  {
    year: 1, label: 'kolem přelomu letopočtu', cat: 'osidleni',
    title: 'Germáni v Polabí',
    text: 'Úrodné Podřipsko patří k nejstarším trvale osídleným krajinám Čech. Na přelomu letopočtu sem přicházejí germánští Markomani; u labského brodu, kde dnes stojí zámek, archeologové dokládají pravěké a římskodobé osídlení.',
    focus: [-30, 2, 120],
  },
  {
    year: 375, label: 'po roce 375', cat: 'osidleni',
    title: 'Doba stěhování národů',
    text: 'Germánské osídlení řídne, krajina u brodu zarůstá. Pole se mění v louky a lesy.',
    focus: [0, 0, 220],
  },
  {
    year: 568, label: '6. století', cat: 'osidleni',
    title: 'Příchod Slovanů',
    text: 'Do Polabí přicházejí Slované. Okolí hory Říp se stává jádrem kmene Čechů – podle něj později dostala jméno celá země.',
    focus: [90, 200, 560],
  },
  {
    year: 1039, label: 'kolem 1039 (?)', cat: 'stavba',
    title: 'Kaple sv. Vojtěcha na Řípu',
    text: 'Na vrcholu Řípu vzniká románská kaple zasvěcená sv. Vojtěchovi. Přesné datum neznáme – bývá spojována s přenesením Vojtěchových ostatků do Prahy roku 1039. Písemně je doložena až roku 1126.',
    focus: [197, 429, 90],
  },
  {
    year: 1125, cat: 'kultura',
    title: 'Kosmova kronika a praotec Čech',
    text: 'Kosmas zapisuje pověst o praotci Čechovi, který z hory Říp přehlédl zemi „oplývající mlékem a strdím“. Říp se stává symbolem českých dějin.',
    focus: [197, 429, 170],
  },
  {
    year: 1126, cat: 'stavba',
    title: 'Rotunda sv. Jiří na Řípu',
    text: 'První písemná zpráva o kapli na Řípu: kníže Soběslav I. ji po vítězství nad Lotharem III. u Chlumce nechává opravit a rozšířit o západní kruhovou věž. Vysvětil ji biskup Jindřich Zdík. Zasvěcení sv. Jiří je doloženo až od 16. století.',
    focus: [197, 429, 90],
  },
  {
    year: 1167, cat: 'panstvi',
    title: 'První písemná zmínka',
    text: 'Roudnice se v pramenech objevuje v letech 1167 a 1176 jako majetek pražských biskupů. Jméno se odvozuje od „rudného“ (železitého) pramene pod pozdějším augustiniánským klášterem.',
    focus: [-14, 8, 110],
  },
  {
    year: 1189, label: '1189/90', cat: 'stavba',
    title: 'Románský biskupský hrad',
    text: 'Biskup Jindřich Břetislav zahajuje stavbu kamenného románského hradu na skalní terase nad Labem (dendrochronologicky 1189/90). Hrad měl obdélníkový půdorys a sedm bašt.',
    focus: [-1.5, -3.5, 60],
  },
  {
    year: 1250, label: '13. století', cat: 'panstvi',
    title: 'Roudnice městem',
    text: 'Osada pod hradem získává ve 13. století městská práva. Kolem obdélníkového náměstí vzniká Staré Město.',
    focus: [-14, 8, 90],
  },
  {
    year: 1295, cat: 'osidleni',
    title: 'První zmínka o Dobříni',
    text: 'Ves Dobříň na levém břehu Labe, severovýchodně od Roudnice, se poprvé objevuje v písemných pramenech. Později přes 200 let patří k lobkovickému roudnickému panství.',
    focus: [226, -136, 90],
  },
  {
    year: 1333, cat: 'kultura',
    title: 'Augustiniánský klášter',
    text: 'Biskup Jan IV. z Dražic zakládá (základní kámen 25. 5. 1333) první klášter augustiniánských kanovníků v českých zemích s kostelem Narození Panny Marie.',
    focus: [-35, -14, 60],
  },
  {
    year: 1340, label: '1333–1340', cat: 'stavba',
    title: 'Kamenný most přes Labe',
    text: 'Jan IV. z Dražic povolává mistra Viléma z Avignonu. Vzniká první kamenný most přes Labe a třetí nejstarší kamenný most v Čechách.',
    focus: [-2, -34, 70],
  },
  {
    year: 1350, cat: 'panstvi',
    title: 'Cola di Rienzo v Roudnici',
    text: 'Karel IV. pobývá na roudnickém hradě a nechává zde internovat římského tribuna Colu di Rienzo.',
    focus: [-1.5, -3.5, 60],
  },
  {
    year: 1390, label: 'konec 14. století', cat: 'stavba',
    title: 'Nové Město a hradby',
    text: 'Východně od Starého Města vzniká Nové Město roudnické. Obě části jsou obehnány hradbami s branami.',
    focus: [-22, 8, 110],
  },
  {
    year: 1421, cat: 'valka',
    title: 'Husité dobývají Roudnici',
    text: 'Město dobývá a plení Jan Žižka. Augustiniánský klášter je zničen a už nebyl obnoven v původní podobě.',
    focus: [-22, 5, 110],
  },
  {
    year: 1425, cat: 'valka',
    title: 'Jan Roháč z Dubé',
    text: 'Roudnici znovu dobývá a plení husitský hejtman Jan Roháč z Dubé.',
    focus: [-22, 5, 110],
  },
  {
    year: 1428, cat: 'valka',
    title: 'Václav Carda z Petrovic',
    text: 'Třetí husitské vyplenění města během jediného desetiletí.',
    focus: [-22, 5, 110],
  },
  {
    year: 1431, cat: 'panstvi',
    title: 'Smiřičtí',
    text: 'Roudnici drží Jan Smiřický; arcibiskupové o panství definitivně přicházejí.',
    focus: [-1.5, -3.5, 90],
  },
  {
    year: 1453, cat: 'panstvi',
    title: 'Zdeněk Konopišťský ze Šternberka',
    text: 'Panství přechází na mocného Zdeňka Konopišťského ze Šternberka.',
    focus: [-1.5, -3.5, 90],
  },
  {
    year: 1467, cat: 'panstvi',
    title: 'Královské město',
    text: 'Od roku 1467 je Roudnice uváděna jako královské město.',
    focus: [-14, 8, 100],
  },
  {
    year: 1475, label: '15. století', cat: 'stavba',
    title: 'Městská věž Hláska',
    text: 'Vzniká branská věž Hláska. Dnes slouží s ochozem a barokní střechou jako rozhledna a galerie.',
    focus: [-18, -4, 50],
  },
  {
    year: 1505, cat: 'osidleni',
    title: 'Vědomice v pramenech',
    text: 'Vědomice v labské nivě naproti Roudnici, na pravém břehu přes most, se objevují v pramenech v souvislosti s roudnickým panstvím Švihovských. Do zemských desek jsou zapsány roku 1555.',
    focus: [-56, -95, 90],
  },
  {
    year: 1577, cat: 'panstvi',
    title: 'Vilém z Rožmberka',
    text: 'Panství kupuje Vilém z Rožmberka. Přestavuje hrad renesančně a zřizuje zde alchymistické dílny.',
    focus: [-1.5, -3.5, 60],
  },
  {
    year: 1603, cat: 'panstvi',
    title: 'Lobkovicové',
    text: 'Vdova po Vilémovi, Polyxena z Pernštejna, se provdává za Zdeňka Vojtěcha Popela z Lobkovic. Roudnice se na staletí stává sídlem Lobkoviců.',
    focus: [-1.5, -3.5, 70],
  },
  {
    year: 1615, label: '1615–1628', cat: 'stavba',
    title: 'Kapucínský klášter',
    text: 'Raně barokní kapucínský klášter s kostelem sv. Václava. Kvůli jeho stavbě se museli Židé v letech 1613–1614 vystěhovat ze své první čtvrti.',
    focus: [14, 3, 55],
  },
  {
    year: 1619, cat: 'kultura',
    title: 'Synagoga v nové židovské čtvrti',
    text: 'V nové židovské čtvrti vzniká synagoga; roku 1718 tu stojí 51 domů.',
    focus: [-60, -24, 60],
  },
  {
    year: 1634, cat: 'valka',
    title: 'Třicetiletá válka',
    text: 'Švédská vojska město vypalují. Kamenný most je po válce poničen a postupně chátrá.',
    focus: [-20, 5, 120],
  },
  {
    year: 1639, cat: 'valka',
    title: 'Švédové znovu',
    text: 'Další vypálení a zpustošení města švédskými vojsky.',
    focus: [-20, 5, 120],
  },
  {
    year: 1652, label: '1652–1684', cat: 'stavba',
    title: 'Barokní zámek',
    text: 'Václav Eusebius z Lobkovic nechává středověký hrad přestavět na monumentální raně barokní zámek (dokončen 1684). Zavádí fideikomis, který platí až do roku 1945.',
    focus: [-1.5, -3.5, 55],
  },
  {
    year: 1850, cat: 'doprava',
    title: 'Železnice Praha – Drážďany',
    text: 'Severní státní dráha z Prahy do Lovosic (dál na Podmokly a Drážďany) je slavnostně otevřena 4. 5. 1850. Stavba si vyžádala zbourání části centra, pivovaru i staré synagogy.',
    focus: [14, -12, 150],
  },
  {
    year: 1853, label: '1852–1853', cat: 'kultura',
    title: 'Novorománská synagoga',
    text: 'Židovská obec staví třetí, novorománskou synagogu. Po 2. světové válce byla přestavěna na internát.',
    focus: [-52, -24, 50],
  },
  {
    year: 1870, label: '2. pol. 19. století', cat: 'doprava',
    title: 'Průmyslové centrum Podřipska',
    text: 'Podél železnice vyrůstají strojírenské továrny (mj. firma Bratři Klementové). Město se rozrůstá na jih k nádraží.',
    focus: [0, 50, 160],
  },
  {
    year: 1890, cat: 'kultura',
    title: 'Nový židovský hřbitov',
    text: 'Je založen nový židovský hřbitov.',
    focus: [-171, -19, 80],
  },
  {
    year: 1900, cat: 'doprava',
    title: 'Trať do Zlonic',
    text: 'Zprovozněna odbočná trať Roudnice nad Labem – Zlonice. V letech 1900–1901 vzniká také Podřipské muzeum.',
    focus: [-60, 100, 220],
  },
  {
    year: 1910, label: '1906–1910', cat: 'stavba',
    title: 'Železný most',
    text: 'Na místě zbořených zbytků gotického mostu vzniká nový železný most přes Labe. Téhož roku odkazem sbírky vzniká Galerie moderního umění – třetí nejstarší galerie v Česku.',
    focus: [-2, -34, 70],
  },
  {
    year: 1924, label: 'první republika', cat: 'osidleni',
    title: 'Vilové čtvrti',
    text: 'Za první republiky se město rozšiřuje o vilové čtvrti na západ a jih od centra.',
    focus: [-40, 110, 160],
  },
  {
    year: 1935, cat: 'stavba',
    title: 'Kratochvílova rozhledna',
    text: 'Rolnická záložna podřipská staví v jižní části města Kratochvílovu rozhlednu.',
    focus: [-5, 40, 60],
  },
  {
    year: 1939, label: '1939–1945', cat: 'valka',
    title: 'Okupace',
    text: 'Za protektorátu nacisté zabavují Lobkovicům zámek i sbírky. Roudnická židovská obec je téměř zcela vyvražděna.',
    focus: [-1.5, -3.5, 90],
  },
  {
    year: 1948, cat: 'panstvi',
    title: 'Zestátnění zámku',
    text: 'Zámek přechází do rukou státu; cenný lobkovický depozitář je z velké části zničen či rozptýlen. Max Lobkowicz, čestný občan města, odchází do exilu.',
    focus: [-1.5, -3.5, 70],
  },
  {
    year: 1957, label: '1957–2008', cat: 'kultura',
    title: 'Vojenská hudební škola',
    text: 'V zámku sídlí Vojenská hudební škola Víta Nejedlého.',
    focus: [-1.5, -3.5, 60],
  },
  {
    year: 1965, cat: 'kultura',
    title: 'Galerie v zámecké jízdárně',
    text: 'Galerie moderního umění se stěhuje do bývalé zámecké jízdárny.',
    focus: [-1.5, -3.5, 60],
  },
  {
    year: 1975, label: '70. a 80. léta', cat: 'osidleni',
    title: 'Panelová sídliště',
    text: 'Výstavba panelových sídlišť. V srpnu 1986 dosahuje město historického maxima 14 067 obyvatel; v letech 1986–1990 je k Roudnici připojen i Dobříň.',
    focus: [-30, 100, 260],
  },
  {
    year: 2002, cat: 'valka',
    title: 'Povodeň 2002',
    text: 'Během katastrofální povodně je roudnický most jediným otevřeným silničním mostem přes Labe v širokém okolí.',
    focus: [-40, -90, 260],
  },
  {
    year: 2012, cat: 'kultura',
    title: 'Zámek otevřen veřejnosti',
    text: 'Po odchodu armády se zámek vrací Lobkovicům a je zpřístupněn veřejnosti. V jízdárně sídlí Galerie moderního umění.',
    focus: [-1.5, -3.5, 60],
  },
  {
    year: 2013, cat: 'valka',
    title: 'Povodeň 2013',
    text: 'Labe se opět rozlévá do nivy uvnitř svého oblouku; zasaženy jsou mimo jiné Vědomice a Dobříň.',
    focus: [-40, -90, 260],
  },
  {
    year: 2018, cat: 'kultura',
    title: 'Vinařská obec',
    text: 'Roudnice nad Labem získává statut vinařské obce – navazuje na vinařskou tradici Lobkoviců.',
    focus: [-1.5, -3.5, 80],
  },
  {
    year: 2021, cat: 'doprava',
    title: 'Obchvat města',
    text: 'V září 2021 je otevřena hlavní část městského obchvatu.',
    focus: [-100, 140, 330],
  },
  {
    year: 2026, cat: 'osidleni',
    title: 'Roudnice dnes',
    text: 'Město s necelými 13 tisíci obyvateli, zámkem Lobkoviců, vinařstvím a výhledem na Říp.',
    focus: [0, 30, 320],
  },
];

// Období pro popisek pod letopočtem.
export const ERAS = [
  [0, 'Doba římská – Germáni'],
  [375, 'Doba stěhování národů'],
  [568, 'Raný středověk – Slované'],
  [900, 'Přemyslovské Čechy'],
  [1167, 'Biskupská Roudnice'],
  [1310, 'Lucemburkové'],
  [1419, 'Husitské války'],
  [1436, 'Pozdní středověk'],
  [1526, 'Renesance'],
  [1618, 'Třicetiletá válka'],
  [1648, 'Baroko'],
  [1780, 'Osvícenství a obrození'],
  [1848, 'Průmyslová éra'],
  [1918, 'První republika'],
  [1939, 'Protektorát'],
  [1945, 'Poválečné a komunistické období'],
  [1989, 'Současnost'],
];

// Orientační počet obyvatel na území dnešního města.
// Před rokem 1869 jde o odhady (osady u brodu, středověké město, válečné propady);
// od roku 1869 vychází z výsledků sčítání lidu (celé město včetně místních částí).
export const POPULATION = [
  [0, 60], [350, 80], [450, 20], [600, 40], [800, 90], [1000, 150], [1100, 200],
  [1167, 260], [1250, 700], [1333, 1300], [1400, 2000], [1420, 2100],
  [1421, 1300], [1425, 1100], [1428, 900], [1440, 1000], [1500, 1500], [1600, 2300],
  [1634, 2000], [1639, 900], [1648, 800], [1700, 1500], [1750, 2100], [1800, 2800],
  [1850, 4000], [1869, 5600], [1880, 6700], [1890, 7450], [1900, 8900], [1910, 10300],
  [1921, 9950], [1930, 10350], [1939, 10500], [1945, 9300], [1950, 9500], [1961, 10750],
  [1970, 11500], [1980, 13700], [1986, 14067], [1991, 13700], [2001, 13300],
  [2011, 12900], [2021, 12600], [2025, 12668], [2026, 12650],
];

export function populationAt(year) {
  const p = POPULATION;
  if (year <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (year <= p[i][0]) {
      const [y0, v0] = p[i - 1];
      const [y1, v1] = p[i];
      return v0 + (v1 - v0) * (year - y0) / (y1 - y0);
    }
  }
  return p[p.length - 1][1];
}

export function eraAt(year) {
  let name = ERAS[0][1];
  for (const [y, n] of ERAS) if (year >= y) name = n;
  return name;
}

export const SOURCES = [
  ['Roudnice nad Labem – Wikipedie', 'https://cs.wikipedia.org/wiki/Roudnice_nad_Labem'],
  ['Roudnice nad Labem – Wikipedia (EN)', 'https://en.wikipedia.org/wiki/Roudnice_nad_Labem'],
  ['Acta Musei Nationalis Pragae – augustiniánský klášter (NM)', 'https://publikace.nm.cz/file/36b71a9f5af2a2a8fdf30da63fab0a49/20371/NM_ACTA_c3_4_2019_web_-48-55.pdf'],
  ['ČT24 – Roudnická galerie slaví 100 let', 'https://ct24.ceskatelevize.cz/clanek/kultura/roudnicka-galerie-predstavuje-sbirku-slavickovych-obrazu-207417'],
  ['K. Sellner – Historie trati Praha–Drážďany (Univerzita Pardubice)', 'https://dfjp.upce.cz/sites/default/files/public/zlso3117/praha_-_drazdany-_historie_sellner_200107_-_kopie_142934.pdf'],
  ['Lidé města – obnova Podřipského muzea (UK)', 'https://medusa.is.cuni.cz/lidemesta/article/download/4117/3332/18086'],
  ['ČSÚ – Historický lexikon obcí / počet obyvatel', 'https://www.czso.cz/'],
  ['Rotunda sv. Jiří (Říp) – Wikipedie', 'https://cs.wikipedia.org/wiki/Rotunda_svat%C3%A9ho_Ji%C5%99%C3%AD_(%C5%98%C3%ADp)'],
  ['Dobříň – Wikipedie', 'https://cs.wikipedia.org/wiki/Dob%C5%99%C3%AD%C5%88'],
  ['Vědomice – Wikipedie', 'https://cs.wikipedia.org/wiki/V%C4%9Bdomice'],
  ['Mapová data © přispěvatelé OpenStreetMap (ODbL)', 'https://www.openstreetmap.org/copyright'],
  ['ČÚZK – Ortofotomapa ČR (© ČÚZK, CC BY 4.0)', 'https://geoportal.cuzk.cz/'],
  ['ČÚZK – Digitální model reliéfu DMR 5G a model povrchu DMP 1G (© ČÚZK, CC BY 4.0)', 'https://geoportal.cuzk.cz/'],
  ['II. a III. vojenské mapování – Virtuální mapová sbírka Chartae Antiquae (© VÚGTK, v.v.i.)', 'https://www.chartae-antiquae.cz/'],
];
