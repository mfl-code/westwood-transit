## 🛰️ Real-Time Engine & Data Processing

The dashboard employs a hybrid data architecture to balance heavy schedule processing with low-latency updates:

### 1. Static GTFS (The Backbone)
We fetch the full TransLink GTFS static ZIP via a CORS proxy. Using **JSZip**, we extract and parse CSV files (`stop_times.txt`, `trips.txt`, etc.) directly in the browser to build an in-memory relational model of the day's schedule.

### 2. GTFS Realtime (The Live Layer)
Live updates are fetched as binary Protobuf encoded streams. 
- **Library:** `protobuf.js` (v7.2.4)
- **Optimization:** To ensure high performance, the GTFS schema is loaded lazily and cached globally. This prevents redundant network hits to GitHub's proto repository, ensuring that "Refresh" actions only fetch the ~50KB delta from TransLink.



### 3. Arrival Logic
The engine joins the live `TripUpdate` entities with the static schedule based on `trip_id` and `route_id`. 
- **Verified (●):** Static schedule data.
- **Real-time (📶):** Live data confirmed via Protobuf.
- **Cancelled:** Trips explicitly flagged as removed in the feed.
