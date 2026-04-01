\# TransLink Dynamic GTFS Transit Dashboard



A high-performance, client-side web application providing hyper-local transit coordination for Coquitlam commuters. This dashboard synchronizes static General Transit Feed Specification (GTFS) data with live Protobuf real-time feeds to coordinate transfers between the Millennium Line SkyTrain and Westwood Plateau bus routes.



\## 🛰️ Technical Architecture



The application employs a hybrid data strategy to balance heavy schedule processing with low-latency updates:



\### 1. Static GTFS (The Backbone)

The engine fetches TransLink's \~30MB static GTFS bundle. Using \*\*JSZip\*\*, it extracts and parses CSV files (`stop\_times.txt`, `trips.txt`, `calendar.txt`) entirely in-memory. This allows for complex relational queries—such as calculating catchable buses based on SkyTrain travel offsets—without a backend database.



\### 2. GTFS Realtime (The Live Layer)

Live service updates (delays, position, and cancellations) are fetched as binary Protobuf encoded streams.

\- \*\*Decoding:\*\* Uses `protobuf.js` (v7.2.4) to decode TransLink's binary `FeedMessage` payloads.

\- \*\*Performance Optimization:\*\* The GTFS schema (`.proto`) is loaded using a singleton pattern. It is fetched and parsed once upon initialization and cached globally, ensuring that subsequent "Refresh" actions only fetch the minimal binary delta from TransLink.







\## ✨ Key Features



\- \*\*Smart Transfer Logic:\*\* Dynamically calculates the next "catchable" bus at major hubs (Moody Centre, Coquitlam Central) by applying SkyTrain travel time offsets to your current location.

\- \*\*Live Status Indicators:\*\*

&#x20;   - 🕒 \*\*Verified:\*\* Confirmed static timing points.

&#x20;   - 🛜 \*\*Real-time:\*\* Live arrival data decoded from Protobuf.

&#x20;   - \~\~\*\*00:00\*\*\~\~ \*\*Cancelled:\*\* Trips explicitly flagged as removed in the live feed.

\- \*\*Over-Midnight Support:\*\* Robust handling of GTFS time formats (e.g., 25:30:00) to ensure late-night commuters see accurate data.

\- \*\*Local Persistence:\*\* Uses `localStorage` to cache processed schedules for 1 hour, minimizing redundant 30MB downloads.



\## 📂 Project Structure



\- `index.html`: The central hub and API key management portal.

\- `millenium.html`: The transfer engine for SkyTrain-to-bus connections.

\- `westwood.html`: Neighborhood-specific real-time departure board.

\- `transit.js`: The core logic engine (GTFS parsing, Protobuf decoding, and arrival algorithms).

\- `style.css`: Unified, responsive design optimized for mobile "on-the-go" viewing.



\## 🛠️ Setup \& Access



This application is purely client-side but requires a CORS proxy and a developer key to access TransLink's restricted feeds.



1\. \*\*CORS Proxy:\*\* Visit \[CORS Anywhere](https://cors-anywhere.herokuapp.com/corsdemo) and click \*\*"Request temporary access"\*\* to enable browser-based data fetching.

2\. \*\*API Key:\*\* Obtain a free API key from the \[TransLink Developer Portal](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/register).

3\. \*\*Configuration:\*\* Enter your key into the "Real-Time Data Configuration" section on the dashboard homepage.



\## ⚖️ Disclaimer



This is an independent project by \*\*Michael Frankel-Lopez\*\* and is not affiliated with TransLink. Data is provided "as-is" for informational purposes. For official service alerts, always consult \[TransLink.ca](https://www.translink.ca).



\&copy; 2026 Michael Frankel-Lopez. All rights reserved.

