# FestFlow

An all-in-one music festival planner with a personalized dashboard, festival dates and ticket prices, flight prices, hotel and Airbnb rates, Uber/Lyft and rental car costs, a set-time planner and a calendar that exports to `.ics`.

## Run it

```bash
node server.js
```

Then open http://localhost:5173. You need Node 18 or newer. There are no packages to install.

## Live flight and hotel prices (optional)

Live prices come from SerpApi's [Google Flights](https://serpapi.com/google-flights-api) and [Google Hotels](https://serpapi.com/google-hotels-api) APIs. Google Hotels covers both hotels and vacation rentals (Airbnb/Vrbo-style homes). One key works for both, and the free plan includes 250 searches a month.

1. Sign up at https://serpapi.com/users/sign_up.
2. Copy your key from https://serpapi.com/manage-api-key.
3. Copy `.env.example` to `.env` and paste the key in:
   ```
   SERPAPI_KEY=your_key_here
   ```
4. Restart `node server.js`. The console should print `Live fares: ON`.

The key stays in `server.js` on your machine. The browser only calls `/api/fares` and `/api/stays`, and the server never serves `.env`.

How searches are spent:

- **Festival page:** looks up the live fare automatically for the selected weekend and origin airport. It also looks up live rates for your chosen stay type (hotel or vacation rental), which costs 2 searches per festival page in total. Live prices replace the estimates in your trip total and on your dashboard.
- **Flights page:** looks up a fare only when you tap "Live price" on a row.
- Each search is cached for 6 hours in `.fare-cache.json`, so reloading pages doesn't spend searches.

Without a key, the app falls back to its built-in estimates and shows links to Google Flights, Kayak, Skyscanner, Google Hotels, Booking.com, Airbnb and Vrbo.

## Data notes

- **Dates:** 2027 festival dates are projected from each festival's usual pattern. Confirm them on the official site.
- **Tickets:** ticket prices are the last edition's face value in approximate USD, before fees.
- **Stays:** estimated festival-week rates per night, in `js/data.js`. Hotels assume 2 people per room, and Airbnb homes sleep 4–6 depending on the area. Stay costs are split across your group.
- **Uber/Lyft:** modeled at about $5.50 + $2.80 per mile, with a 1.2× festival bump and about 2× surge when leaving at close, and 4 people per car. Rides cost about 20% less in Europe.
- **Rental car:** daily rate plus about 30% for taxes and fees, gas at 28 mpg, and festival parking per day. It assumes 5 people per car. If you're camping, the car stays at the campsite, so there's no daily driving or parking.
- **Your data:** your profile, plans and calendar are stored in your browser's localStorage.
