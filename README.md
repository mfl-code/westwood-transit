# TransLink GTFS Transit Dashboard

A client-side web application providing specific transit connection data for Coquitlam commuters. This dashboard processes static General Transit Feed Specification (GTFS) data to help travelers coordinate transfers between the Millennium Line SkyTrain and local Westwood Plateau bus routes.

## Features
- **Dynamic GTFS Engine:** Downloads and parses TransLink's 20MB+ static schedule ZIP file entirely in the browser using `JSZip`.
- **Smart Transfer Logic:** Calculates the next catchable bus based on your current SkyTrain station and relative travel times.
- **Local Persistence:** Uses `localStorage` to cache parsed schedules for 1 hour, reducing data usage and processing overhead.
- **Over-Midnight Support:** Correctly handles GTFS time formats that exceed 24:00:00.
- **Verified Timing Points:** Identifies "Timing Points" where buses are scheduled to hold, marked with a 🕒 icon.

## Project Structure
- `index.html`: The central hub for navigation.
- `millenium.html`: Calculates SkyTrain-to-bus transfers at major hubs (Moody Centre, Coquitlam Central, etc.).
- `westwood.html`: Displays real-time departures for specific neighborhood stops in Westwood Plateau.
- `transit.js`: The core logic engine handling GTFS parsing, caching, and arrival calculations.
- `style.css`: Unified professional styling for all dashboard views.

## Setup & Access
Due to CORS (Cross-Origin Resource Sharing) restrictions on the official TransLink data feed, this project uses a proxy.
1. Open the application in a modern web browser.
2. If data fails to load, visit [CORS Anywhere](https://cors-anywhere.herokuapp.com/corsdemo).
3. Click the **"Request temporary access to the demo server"** button.
4. Return to the dashboard and refresh.

## Disclaimer
This is an independent project by **Michael Frankel-Lopez** and is not affiliated with TransLink. Data is provided "as-is" for informational purposes.

© 2026 Michael Frankel-Lopez. All rights reserved.
