# Exam Platform — PWA + Deployment Guide

## Ee update lo emi chesam
Project ni ippudu full PWA (Progressive Web App) laaga convert chesam. Deploy chesaka, idi Android, iPhone, laptop — anni lo browser nunchi "app laaga" install cheskovacchu, home screen icon vastundi, offline lo kuda basic pages open avutayi.

Files added/changed:
- `frontend/next.config.js` — service worker generate chestundi (next-pwa)
- `frontend/public/manifest.json` — app name, icons, colors
- `frontend/public/icons/*` — app icon (192, 512, maskable, apple, favicon)
- `frontend/public/offline.html` — internet లేకపోతే chూపించే fallback page
- `frontend/components/InstallPrompt.jsx` — "Install app" banner (Android/desktop). iPhone lo "Add to Home Screen" instructions chupistundi.
- `frontend/app/layout.jsx` — PWA meta tags add chesam
- `frontend/lib/api.js` — backend URL ippudu `NEXT_PUBLIC_API_URL` env var nunchi vastundi (localhost hardcoded kaadu ippudu)
- `backend/app/main.py` — CORS ippudu `ALLOWED_ORIGINS` env var accept chestundi (deployed frontend ni allow cheyadaniki)
- `render.yaml` — backend ni Render.com meeda deploy cheyadaniki ready config

**Important**: `frontend/public/sw.js`, `workbox-*.js` files build time lo automatic ga generate avutayi — meeru repo lo pettalsina pani ledu (`.gitignore` lo already unnayi).

---

## Step 1 — GitHub కి push cheyyi
Ide repo GitHub lo pettandi (private repo pettochu). Deployment services (Vercel/Render) rendu ikkada nunchi automatic ga build chestayi.

```
git init
git add .
git commit -m "Milestone 3 + PWA"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## Step 2 — Backend deploy (Render.com — free)
1. https://render.com lo sign up → "New +" → "Blueprint" → mee GitHub repo select cheyandi. `render.yaml` already unnadi kabatti settings auto-fill avutayi.
2. Deploy ayyaka, backend ki oka URL vastundi — example: `https://exam-platform-backend.onrender.com`
3. Render dashboard → Environment tab lo ee values fill cheyandi:
   - `FRONTEND_URL` → step 3 lo vachhe Vercel URL (ippudu blank pettinaa parledu, tarvata update chesukovachu)
   - `ALLOWED_ORIGINS` → same Vercel URL
   - `ANTHROPIC_API_KEY`, `RESEND_API_KEY` → optional, unte fill cheyandi

## Step 3 — Frontend deploy (Vercel — free)
1. https://vercel.com → "Add New Project" → same GitHub repo import cheyandi.
2. **Root Directory** ni `frontend` ga set cheyandi (important — repo root kaadu).
3. Environment Variables lo add cheyandi:
   - `NEXT_PUBLIC_API_URL` = Step 2 backend URL (e.g. `https://exam-platform-backend.onrender.com`)
4. Deploy nokkandi. Konni nimushallo mee app ki oka public URL vastundi — e.g. `https://exam-platform.vercel.app`
5. Ippudu vెనakki వెళ్ళి Render lో `ALLOWED_ORIGINS` and `FRONTEND_URL` ni ee exact Vercel URL తో update చేయండి, backend ni redeploy cheyandi (env var change chesaka auto-redeploy avutundi).

Deploy ayyaka mee app ye URL nunchi (mobile, laptop, ekkadi nunchi ayina) open avutundi — same URL, same login, anywhere.

---

## Step 4 — App laaga install cheyyadam (users kosam)

**Android (Chrome):** Site open cheyandi → mūడు-dots menu → "Install app" / "Add to Home screen". Ledante mee InstallPrompt banner automatic ga bottom lo kanipistundi, "Install" button నొక్కితే chalu.

**iPhone (Safari — required, Chrome pani cheyadu ఇక్కడ):** Site open cheyandi → Share button (square with up-arrow) → "Add to Home Screen" → "Add". Bottom banner kuda ee instructions chupistundi.

**Laptop/Desktop (Chrome, Edge):** Address bar right side lo oka "Install" icon vastundi (⊕ or computer icon), leda 3-dot menu → "Install Exam Platform". 

Install chesaka, app separate window/icon la open avutundi — browser tabs/address bar undadu, normal app la anipistundi.

---

## Local testing (deploy చేసే ముందు, optional)
Service worker `next dev` lo active kaadu (intentional — dev lo stale cache వద్దు కదా), so PWA behavior test cheyalante production build run cheyandi:

```
cd frontend
npm install
npm run build
npm run start
```

Tarvata `http://localhost:3000` open chesi, Chrome DevTools → Application tab → "Manifest" & "Service Workers" sections lo anni సరిగ్గా register అయ్యాయో చూడొచ్చు.

---

## Notes / limitations
- Exam-taking (attempt) pages eppudu **live internet** tho matrame nadapali — offline fallback kevalam "site reachable kaadu" ani cheppడానికే, offline lo exam submit cheyadaniki kaadu (`/api/*` calls eppudu NetworkOnly, never cached — idi intentional, exam integrity kosam).
- Face-api.js proctoring models (`public/models/`) already precache list lo unnayi, so once app open chesaka avi cache lo untayi.
- Render free tier backend konchem sepu idle unte "sleep" avutundi, first request slow ga vastundi — ide free hosting normal behavior, paid tier ki upgrade chesthe fix avutundi.
