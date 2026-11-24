# FestFlow

An all-in-one music festival planner with a personalized dashboard, festival dates and ticket prices, flight prices, hotel and Airbnb rates, Uber/Lyft and rental car costs, a set-time planner and a calendar that exports to `.ics`.

## Use it online

https://mileslagman.github.io/festflow/

The website is this repo served by GitHub Pages, and it updates when `main` is pushed. Pages can only serve files, so live fares, live hotel rates and Google festival lookup aren't available there; it uses the built-in estimates and links instead. Map lookups and driving routes still work, because the browser asks OpenStreetMap directly. Plans are saved in your own browser and aren't shared between the website and `localhost`.

## Run it on your computer

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

- **Festival lookup:** searching for a festival that isn't built in offers "Look it up". That runs one Google search, which fills in the name, dates, venue, website and ticket price when Google shows them. If Google only shows a past edition, the next one is projected for the same weekdays a year later. You review the details before saving.
- **Map lookups** (finding the nearest airport to a venue) use OpenStreetMap and don't need a key.

Without a key, the app falls back to its built-in estimates and shows links to Google Flights, Kayak, Skyscanner, Google Hotels, Booking.com, Airbnb and Vrbo.

## Data notes

- **Dates:** 2027 festival dates are projected from each festival's usual pattern. Confirm them on the official site.
- **Tickets:** ticket prices are the last edition's face value in approximate USD, before fees.
- **Stays:** estimated festival-week rates per night, in `js/data.js`. Hotels start at one room per 2 people, which you can change under Where to stay, and Airbnb homes sleep 4–6 depending on the area. Stay costs are split across your group. Stays default to one night before through one night after the festival. Change the check-in, check-out or number of nights under Where to stay, and choose whether your travel dates follow. To use what you're actually paying, choose "Your own price" and enter it per night or as a total for the stay.
- **Uber/Lyft:** modeled at about $5.50 + $2.80 per mile, with a 1.2× festival bump and about 2× surge when leaving at close, and 4 people per car. Rides cost about 20% less in Europe.
- **Crew & cost split:** name everyone going, then set who paid each shared cost and who's in on it. Shared costs are the stay, gas and Uber/rental/parking, plus any extras you add. Tickets, flights and food count as each person's own costs. FestFlow shows each person's total and the fewest payments needed to settle up, with a summary you can copy for the group chat.
- **Driving:** offered when the venue is within about 900 straight-line miles of home and on the same continent. Road distance and time come from OpenStreetMap routing, which is free and needs no key. Gas is round-trip miles ÷ your car's MPG × the gas price, both editable, with up to 5 people per car. When you drive, your own car replaces Uber, rental cars and transit at the festival. Set a home city in your profile for more accurate distances; otherwise driving starts from your home airport.
- **Rental car:** daily rate plus about 30% for taxes and fees, gas at 28 mpg, and festival parking per day. It assumes 5 people per car. If you're camping, the car stays at the campsite, so there's no daily driving or parking.
- **Your data:** your profile, plans, calendar and the festivals you add are stored in your browser's localStorage. Home cities and driving start points you enter are sent to OpenStreetMap's public services to find them on the map and measure the drive.
