# 📦 Handoff – Treningsloggbok

Appen er **ferdig og klar til å tas i bruk**. Dette dokumentet tar deg gjennom de
siste stegene: sette opp databasen, legge appen ut på nett (GitHub Pages), og
installere den på iPhone. Beregn ca. 10 minutter.

> Innlogging skjer med **marteri9@gmail.com** (forhåndsutfylt i appen).
> Du logger inn med en engangskode du får på e-post – ingen passord.

---

## ✅ Status – hva som er laget

- **Logg**-fane: ukedag + dato øverst (settes automatisk til i dag), energimåler
  (Syk/Slapp/Ok/Flott), og innføring av kondisjon (minutter + «hva så du på?»),
  styrke (kg × reps × sett) og matte/kropp (reps × sett).
- **Progresjon**-fane: graf + tabell per øvelse. Punktene er **fargelagt etter
  dagsform**: 🟢 Ok/Flott = grønn, 🟠 Slapp = oransje, 🔴 Syk = rød.
- **Øvelser**-fane: legg til egne øvelser, arkiver dem du ikke bruker.
- Standardrutinen din er lagt inn automatisk ved første innlogging.
- Føring av **gamle logger**: bare velg en tidligere dato i Logg-fanen.
- Alt lagres privat i din egen Supabase (kun du har tilgang).
- Installerbar på iPhone som app (eget ikon, fullskjerm, fungerer offline for selve appen).

---

## Steg 1 – Sett opp Supabase (database)

1. Lag gratis konto på [supabase.com](https://supabase.com) → **New project**
   (velg et passord for databasen og en region, f.eks. *Europe (Frankfurt)*).
2. Når prosjektet er klart: åpne **SQL Editor** (venstremenyen) → **New query**.
3. Åpne fila [`supabase_schema.sql`](./supabase_schema.sql) her i repoet, kopier
   **alt** innholdet, lim inn i SQL-editoren og trykk **Run**.
   Du skal få «Success». (Trygt å kjøre om igjen senere.)
4. Gå til **Project Settings** (tannhjulet) → **API** og noter:
   - **Project URL** – ser ut som `https://xxxxxxxx.supabase.co`
   - **anon public** – en lang nøkkel som starter med `eyJ...`
5. Gå til **Authentication → Sign In / Providers → Email** og bekreft at **Email**
   er på (det er standard). Det er alt som trengs for engangskode på e-post.

---

## Steg 2 – Legg appen ut på GitHub Pages

Du sa du vil lage en GitHub Page med riktig navn selv. Når du er der, har du
**to enkle alternativer** – velg ett:

### Alternativ A (enklest): Deploy fra branch
1. På GitHub: **Settings → Pages**.
2. Under **Build and deployment → Source**, velg **Deploy from a branch**.
3. Velg branch (`main` eller `claude/iphone-workout-logger-c5QK4`) og mappe
   **`/ (root)`**. Trykk **Save**.
4. Etter ~1 minutt får du en URL, f.eks.
   `https://<brukernavn>.github.io/<repo-navn>/`.

### Alternativ B: GitHub Actions
1. **Settings → Pages → Source: GitHub Actions**.
2. Gå til fanen **Actions → «Deploy to GitHub Pages» → Run workflow**.
   (Workflowen ligger klar i `.github/workflows/deploy-pages.yml` og kjører kun
   når du starter den selv.)

> 📁 Alle filstier i appen er relative, så den fungerer uansett hvilket repo-navn
> eller hvilken undermappe URL-en havner på. Du trenger ikke endre noe i koden.

---

## Steg 3 – Installer på iPhone

1. Åpne URL-en fra steg 2 i **Safari** på iPhone.
2. Første gang blir du bedt om **Supabase URL** + **anon-nøkkel** – lim inn de to
   verdiene fra steg 1.4. (Lagres kun på telefonen din.)
3. Trykk **Del**-knappen (firkanten med pil opp) → **Legg til på Hjem-skjerm**.
   Nå har du et app-ikon (en blå manual) som åpner loggboken i fullskjerm.

---

## Steg 4 – Logg inn og kom i gang

1. Åpne appen fra Hjem-skjermen. E-posten din er forhåndsutfylt.
2. Trykk **Send engangskode** → sjekk e-posten → skriv inn den 6-sifrede koden.
3. Standardøvelsene dine ligger klare. Velg dagsform, fyll inn økta, **Lagre økt**. 🎉

---

## Daglig bruk

- **Ny økt:** åpne Logg-fanen (dato = i dag automatisk), velg dagsform, fyll inn,
  trykk Lagre.
- **Gammel økt:** endre datoen øverst og fyll inn som vanlig.
- **Se utvikling:** Progresjon-fanen → velg øvelse. For styrke kan du bytte
  mellom maks vekt, volum og maks reps. Fargen på punktene viser dagsformen din.

## Legge til skulderøvelsene (når du vet hvilke)

Øvelser-fanen → skriv navn → velg type **Styrke** (med vekt) eller **Kropp/matte**
(reps, vekt valgfri) → **Legg til øvelse**. De dukker opp i Logg-fanen med en gang.

---

## Feilsøking

| Problem | Løsning |
| --- | --- |
| Får ikke engangskode | Sjekk søppelpost. Supabase gratis-SMTP har en rate-grense; vent litt og prøv igjen. For mye e-post kan du sette opp egen SMTP i Supabase senere. |
| «row-level security»-feil ved lagring | Kjør `supabase_schema.sql` på nytt – da blir policy-ene satt opp riktig. |
| Tom progresjonsgraf | Du må ha lagret minst én økt på den øvelsen. |
| Vil bytte Supabase-prosjekt | Innstillinger-fanen → lim inn ny URL/nøkkel → Lagre. |
| Appen viser gammel versjon | Lukk appen helt og åpne på nytt (service worker henter ny versjon ved nett). |

## Filoversikt

| Fil | Hva |
| --- | --- |
| `index.html` | App-skall og faner |
| `app.js` | All logikk (innlogging, lagring, grafer, farger) |
| `styles.css` | Design (mørkt, mobiltilpasset) |
| `config.js` | Forhåndsutfylt e-post + valgfrie Supabase-nøkler |
| `supabase_schema.sql` | Databaseoppsett – kjøres i Supabase |
| `manifest.webmanifest`, `service-worker.js`, `icons/` | Gjør den installerbar som app |
| `.github/workflows/deploy-pages.yml` | Valgfri auto-deploy til GitHub Pages |
