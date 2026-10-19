# FestFlow

An all-in-one music festival planner with a personalized dashboard, festival dates and ticket prices, flight prices, a set-time planner and a calendar that exports to `.ics`.

## Run it

```bash
node server.js
```

Then open http://localhost:5173. You need Node 18 or newer. There are no packages to install.

## Live flight prices (optional)

Live fares come from [SerpApi's Google Flights API](https://serpapi.com/google-flights-api). Its free plan includes 250 searches a month.

1. Sign up at https://serpapi.com/users/sign_up.
2. Copy your key from https://serpapi.com/manage-api-key.
3. Copy `.env.example` to `.env` and paste the key in:
   ```
   SERPAPI_KEY=your_key_here
   ```
4. Restart `node server.js`. The console should print `Live fares: ON`.

The key stays in `server.js` on your machine. The browser only calls `/api/fares`, and the server never serves `.env`.

How searches are spent:

- **Festival page:** looks up the live fare automatically for the selected weekend and origin airport. The live price replaces the estimate in your trip total and on your dashboard.
- **Flights page:** looks up a fare only when you tap "Live price" on a row.
- Each route and date pair is cached for 6 hours in `.fare-cache.json`, so reloading pages doesn't spend searches.

Without a key, the app falls back to its built-in fare model and shows links to Google Flights, Kayak and Skyscanner.

## Data notes

- **Dates:** 2027 festival dates are projected from each festival's usual pattern. Confirm them on the official site.
- **Tickets:** ticket prices are the last edition's face value in approximate USD, before fees.
- **Your data:** your profile, plans and calendar are stored in your browser's localStorage.
