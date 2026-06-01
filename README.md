# 🏋️ Treningsloggbok

En enkel treningsloggbok laget for iPhone. Du fører inn **kondisjon** (minutter på
sykling, roing, jogging) og **styrke** (kg × reps × sett på legpress, nedtrekk osv.),
samt **matte/kropp**-øvelser (situps, knebøy knelende, skulder …). Du kan legge til
egne øvelser, føre inn gamle logger ved å velge dato, og se **progresjon** på hver
øvelse over tid i en egen fane.

Alt lagres i din egen **Supabase**, og loggene er private (innlogging med e-post).

Når du logger kondisjon kan du også skrive inn **hva du så på** mens du trente –
feltet husker det du har skrevet tidligere og foreslår det neste gang.

---

## 1. Sett opp Supabase (gjøres én gang, ca. 5 min)

1. Lag en gratis konto på [supabase.com](https://supabase.com) og opprett et nytt prosjekt.
2. Åpne **SQL Editor** → **New query**, lim inn hele innholdet i
   [`supabase_schema.sql`](./supabase_schema.sql), og trykk **Run**.
   Dette lager tabellene og sikrer at bare du ser dine egne data.
3. Gå til **Project Settings → API** og kopier:
   - **Project URL** (f.eks. `https://abcd.supabase.co`)
   - **anon public** nøkkelen
4. *(Anbefalt)* Gå til **Authentication → Providers → Email** og sørg for at
   **Email** er på. Standard «magic link / OTP» fungerer rett ut av boksen.

> 💡 anon-nøkkelen er trygg å bruke i en nettside – tabellene er beskyttet med
> «Row Level Security», så ingen kommer til dataene dine uten å være logget inn som deg.

## 2. Få appen på iPhone

Appen er en helt vanlig nettside (PWA). Du må legge filene et sted de kan åpnes i Safari.
Enkleste alternativ – **GitHub Pages**:

1. Push dette repoet til GitHub (er allerede gjort hvis du leser dette der).
2. På GitHub: **Settings → Pages → Build and deployment**, velg branch
   `claude/iphone-workout-logger-c5QK4` (eller `main`) og mappe `/ (root)`. Lagre.
3. Etter et minutt får du en URL som `https://<brukernavn>.github.io/desktop-tutorial/`.

Åpne URL-en i **Safari** på iPhone → trykk **Del**-knappen → **Legg til på Hjem-skjerm**.
Nå har du et app-ikon som åpner loggboken i fullskjerm.

> Alternativ uten GitHub Pages: dra hele mappen inn på
> [app.netlify.com/drop](https://app.netlify.com/drop) for en gratis URL.

## 3. Første gang i appen

1. Åpne appen. Første gang blir du bedt om **Supabase URL** og **anon-nøkkel** –
   lim inn de to verdiene fra steg 1. (Lagres kun på telefonen din.)
   Du kan også fylle dem inn på forhånd i [`config.js`](./config.js).
2. Skriv inn **e-posten din**, trykk *Send engangskode*, og skriv inn den
   6-sifrede koden du får på e-post.
3. Standardøvelsene dine er allerede lagt inn. Sett i gang! 🎉

## Slik bruker du den

- **Logg** – velg dato (i dag som standard, eller en gammel dato for tidligere økter),
  fyll inn minutter eller sett/reps/kg, trykk **Lagre økt**.
- **Progresjon** – velg en øvelse for å se graf og tabell over utviklingen.
  For styrke kan du bytte mellom maks vekt, volum og maks reps.
- **Øvelser** – legg til nye øvelser eller arkiver dem du ikke bruker
  (gamle logger beholdes).
- **Innstillinger** – bytt Supabase-tilkobling eller logg ut.

## Filer

| Fil | Hva |
| --- | --- |
| `index.html` | App-skallet og fanene |
| `app.js` | All logikk (innlogging, lagring, grafer) |
| `styles.css` | Design (mørkt, mobiltilpasset) |
| `config.js` | Valgfrie Supabase-nøkler |
| `supabase_schema.sql` | Databaseoppsett – kjøres i Supabase |
| `manifest.webmanifest`, `service-worker.js`, `icons/` | Gjør den installerbar som app |
