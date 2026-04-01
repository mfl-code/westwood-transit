/**
 * @file transit.js
 * @description Core client-side engine for the TransLink GTFS Dashboard.
 * Handles UI orchestration, real-time Protobuf decoding, and Web Worker management.
 * @author Michael Frankel-Lopez
 * @copyright 2026
 */

/**
 * Global variable to store the loaded Protobuf root.
 * Acts as a singleton to ensure the schema is only parsed once.
 * @type {protobuf.Root|null}
 */
let GTFS_ROOT = null;

/** @type {string} 
 * The proxy URL used to bypass CORS restrictions for fetching GTFS data. 
 */
const PROXY = "https://cors-anywhere.herokuapp.com/";

/** @type {string} 
 * The complete URL to fetch TransLink's static GTFS ZIP file through the proxy. 
 */
const GTFS_URL = PROXY + "https://gtfs-static.translink.ca/gtfs/google_transit.zip";

/** @type {string} 
 * The key under which the processed GTFS schedule data is stored in the browser's localStorage. 
 */
const CACHE_KEY = "translink_dynamic_cache";

/** @type {number} 
 * The time-to-live for the cached schedule data, defined in milliseconds (1 hour). 
 */
const CACHE_DURATION = 60 * 60 * 1000; // 1 Hour in milliseconds

/** @type {number} 
 * The time window (in minutes) to search forward for upcoming bus departures. 
 */
const BUS_ARRIVAL_WINDOW_MINS = 120; // Default window for looking up upcoming buses

/** @type {string} 
 * Formatted message to show when cors-anywhere permission need to be updated. 
 */
const CORS_ERROR_MESSAGE = `
            <div class="api-warning" style="background: #fff3cd; color: #856404; padding: 15px; border-radius: 6px; border: 1px solid #ffeeba;">
                <strong>⚠ Action Required: Enable Data Access</strong><br>
                The temporary connection to the transit data server has expired. 
                <ol style="margin-top: 10px;">
                    <li>Click this link: <a href="https://cors-anywhere.herokuapp.com/corsdemo" target="_blank" style="text-decoration: underline; font-weight: bold;">CORS Anywhere Demo Page</a></li>
                    <li>Click the button that says <strong>"Request temporary access to the demo server"</strong>.</li>
                    <li>Return here and refresh the page.</li>
                </ol>
            </div>`;

// ------------------------------------------------------------------------
// Configuration & Target Data
// ------------------------------------------------------------------------

/** @type {Array<{name: string, time: number}>} 
 * List of Millennium Line SkyTrain stations and their relative travel times (in minutes) from VCC-Clark. 
 */
const stations = [
    { name: "VCC-Clark", time: 0 },
    { name: "Commercial-Broadway", time: 1 },
    { name: "Renfrew", time: 4 },
    { name: "Rupert", time: 5 },
    { name: "Gilmore", time: 7 },
    { name: "Brentwood Town Centre", time: 9 },
    { name: "Holdom", time: 11 },
    { name: "Sperling-Burnaby Lake", time: 13 },
    { name: "Lake City Way", time: 16 },
    { name: "Production Way-University", time: 18 },
    { name: "Lougheed Town Centre", time: 20 },
    { name: "Burquitlam", time: 23 },
    { name: "Moody Centre", time: 28 },
    { name: "Inlet Centre", time: 30 },
    { name: "Coquitlam Central", time: 33 },
    { name: "Lincoln", time: 35 },
    { name: "Lafarge Lake-Douglas", time: 36 }
];

/** @type {Array<{name: string, bus: string, stop: string}>} 
 * Bus transfer targets at major SkyTrain hubs, including route numbers and GTFS stop codes. 
 */
const milleniumTargets = [
    { name: "Moody Centre", bus: "183", stop: "61911" },
    { name: "Inlet Centre", bus: "184", stop: "59569" },
    { name: "Coquitlam Central", bus: "185", stop: "53357" },
    { name: "Lafarge Lake-Douglas", bus: "183", stop: "59565" }
];

/** @type {Array<{name: string, stop: string, line: string}>} 
 * Specific neighborhood bus stop targets for the Westwood Plateau departures dashboard. 
 */
const westwoodTargets = [
    { name: "Across Bramblewood", stop: "53923", line: "183" },
    { name: "Bramblewood Park", stop: "58869", line: "183" },
    { name: "Bramblewood Park", stop: "58869", line: "184" },
    { name: "Landsdowne / Panorama", stop: "53903", line: "185" },
    { name: "Parkway / Panorama", stop: "58838", line: "187" }
];

// ------------------------------------------------------------------------
// Public API Functions// ------------------------------------------------------------------------

/**
 * Calculates travel times from a starting SkyTrain station to specific transfer hubs
 * and fetches the subsequent bus connections.
 * @param {string} startStationName - The name of the boarding SkyTrain station.
 * @param {Date} [referenceTime=new Date()] - The baseline time to calculate travel offsets from.
 * @returns {Promise<Array>} Array of formatted HTML arrival data for the UI.
 */
async function getSchedulesForStation(startStationName, referenceTime = new Date()) {
    const startStation = stations.find(station => station.name === startStationName);

    if (!startStation) throw new Error("Station not found");

    // Filter targets that are further down the line, and calculate ETA for transfer
    const batchRequest = milleniumTargets
        .filter(target => {
            const destinationStation = stations.find(station => station.name === target.name);
            return destinationStation.time >= startStation.time;
        })
        .map(target => {
            const targetStation = stations.find(station => station.name === target.name);
            const travelTimeMinutes = targetStation.time - startStation.time;
            return {
                name: target.name,
                line: target.bus,
                stop: target.stop,
                startTime: new Date(referenceTime.getTime() + travelTimeMinutes * 60000),
                period: BUS_ARRIVAL_WINDOW_MINS
            };
        });

    return await getBusArrivals(batchRequest);
}

/**
 * Fetches and flattens all immediate departures for the Westwood Plateau specific stops.
 * Refactored to use the central getBusArrivals logic.
 * @param {Date} [referenceTime=new Date()] - The baseline time to calculate waits from.
 * @returns {Promise<Array>} Chronologically sorted array of all upcoming bus arrivals.
 */
async function getSchedulesForStops(referenceTime = new Date()) {
    // Map Westwood targets to the standard request format
    const requestArray = westwoodTargets.map(target => ({
        ...target,
        startTime: referenceTime,
        period: BUS_ARRIVAL_WINDOW_MINS
    }));

    // Use the central processor
    const results = await getBusArrivals(requestArray);

    // Filter out entries with no upcoming buses and sort chronologically
    return results
        .filter(r => r.wait !== -1)
        .sort((a, b) => a.wait - b.wait);
}

// ------------------------------------------------------------------------
// Internal GTFS Processing Logic
// ------------------------------------------------------------------------

/**
 * Core processor for grouped bus arrivals. Compares requested times against the cached schedule 
 * and generates HTML output fragments for the UI.
 * @param {Array<{name: string, line: string, stop: string, startTime: Date, period: number}>} requestArray 
 * - An array of configuration objects dictating which stops and routes to query.
 * @returns {Promise<Array>} An array of processed arrival objects containing timing, status, and HTML strings.
 */
async function getBusArrivals(requestArray) {
    let scheduleData = getCachedSchedule();

	if (!scheduleData) {
        // Request a cross-tab lock named 'gtfs_update'
        await navigator.locks.request('gtfs_update', async () => {
            // Double-check the cache inside the lock in case another tab just filled it
            scheduleData = getCachedSchedule();
            if (!scheduleData) {
                scheduleData = await refreshGTFSCache();
            }
        });
    }

    const realTimeEntries = await fetchRealTimeData();

    return requestArray.map(request => {
        const rawArrivals = (scheduleData[request.stop] && scheduleData[request.stop][request.line]) || [];
        const windowEnd = new Date(request.startTime.getTime() + (request.period * 60000));

        const processedArrivals = rawArrivals
            .map(entry => {
                let arrivalTime = parseTransitTime(entry.time);
                let status = entry.isTimePoint ? 'timepoint' : 'scheduled';
                
                // Check if there is a live update for this specific Trip ID
                const update = realTimeEntries?.find(entity => {
                    const trip = entity.tripUpdate?.trip;
                    if (!trip) return false;

                    // 1. Match by Trip ID (most reliable)
                    if (trip.tripId && trip.tripId === entry.tripId) return true;

                    // 2. Match by Trip Descriptor (for unscheduled/added trips)
                    const entryStartTime = entry.time.split(':').slice(0,2).join(':'); // HH:MM
                    if (trip.routeId === entry.routeId && trip.startTime === entryStartTime) {
                       return true;
                    }
                    return false;
                })?.tripUpdate;

                if (update) {
                    if (update.trip.scheduleRelationship === 'CANCELED') {
                        status = 'cancelled';
                    } else {
                        // Find specific stop delay
                        const stopUpdate = update.stopTimeUpdate?.find(st => 
                            st.stopId === entry.stopId || st.stopSequence === entry.stopSequence
                        );
                        if (stopUpdate?.arrival?.time) {
                            arrivalTime = new Date(stopUpdate.arrival.time * 1000);
                            status = 'updated';
                        }
                    }
                }

                return { time: arrivalTime, status: status };
            })

            // Filter only for arrivals within our time window (ignoring cancelled ones for the "next bus" logic)
            .filter(arrival => arrival.time >= request.startTime && arrival.time <= windowEnd)
            .sort((a, b) => a.time - b.time);

        const firstCatchable = processedArrivals[0] || null;

        // Construct HTML fragment for the UI
        let htmlFragment = '<div class="arrival-list">';
        if (processedArrivals.length === 0) {
            htmlFragment += `<span class="time-entry">No buses in ${request.period}m window</span>`;
        } else {
            processedArrivals.slice(0, 5).forEach(arrival => {
                const timeStr = arrival.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                const catchableClass = (arrival === firstCatchable) ? 'target-bus' : '';
                let statusClass = '';
                if (arrival.status === 'timepoint') statusClass = 'status-timepoint';
                if (arrival.status === 'updated') statusClass = 'status-updated';
                if (arrival.status === 'cancelled') statusClass = 'status-cancelled';
                htmlFragment += `<span class="time-entry ${statusClass} ${catchableClass}">${timeStr}</span>`;
            });
        }
        htmlFragment += '</div>';

        const waitMinutes = firstCatchable ? Math.round((firstCatchable.time - request.startTime) / 60000) : -1;

        return {
            name: request.name,
            busRoute: request.line,
            stopCode: request.stop,
            startTimeStr: request.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),

            timeStr: firstCatchable ? firstCatchable.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--',
            status: firstCatchable ? firstCatchable.status : 'scheduled',
            busHtml: htmlFragment,
            wait: waitMinutes,
            sortKey: waitMinutes === -1 ? 999 : waitMinutes
        };
    });
}

/**
 * Downloads, unzips, and parses the TransLink GTFS archive.
 * Filters a massive dataset down to only the requested routes and stops for optimal local storage.
 * Automatically aggregates targets from both `milleniumTargets` and `westwoodTargets`.
 * @returns {Promise<Object>} A dictionary of parsed schedules keyed by stop code and route.
 * @throws {string} Throws an error if CORS access is denied or if the server response fails.
 */
/**
 * Initiates the Web Worker to download and parse the GTFS archive.
 */
async function refreshGTFSCache() {
    return new Promise((resolve, reject) => {
        // Collect required parameters to pass to the worker
        const allBusLines = [...new Set([...milleniumTargets.map(t => t.bus), ...westwoodTargets.map(t => t.line)])];
        const allStopCodes = [...new Set([...milleniumTargets.map(t => t.stop), ...westwoodTargets.map(t => t.stop)])];

        // Instantiate the worker
        const worker = new Worker('gtfs-worker.js');

        // Listen for the worker to finish
        worker.onmessage = function(e) {
			try {
	            if (e.data.success) {
	                const finalSchedule = e.data.schedule;
	                // Cache the optimized dataset in the main thread
	                localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), schedule: finalSchedule }));
	                resolve(finalSchedule);
	            } else {
	                if (e.data.error === "CORS_403") {
						showCorsProxyWarning();
						resolve({});
	                } else {
						reject(e.data.error);
	                }
	            }
			}  finally {
		        worker.terminate();
		    }
        };

        // Handle catastrophic worker failures
        worker.onerror = function(error) {
            console.error("Worker Error:", error);
            reject("A critical error occurred while processing transit data.");
            worker.terminate();
        };

        // Start the worker and pass the necessary configuration
        worker.postMessage({
            url: GTFS_URL,
            allBusLines: allBusLines,
            allStopCodes: allStopCodes
        });
    });
}

// ------------------------------------------------------------------------
// Utility Functions
// ------------------------------------------------------------------------

/**
 * Parses GTFS formatted time (HH:MM:SS) into a standard JS Date object.
 * Correctly handles over-midnight GTFS times (e.g., "25:30:00" translates to 1:30 AM the next day).
 * @param {string} timeStr - The time string extracted from the GTFS feed.
 * @returns {Date} A JavaScript Date object set to the corresponding local time.
 */
function parseTransitTime(timeStr) {
    let [hours, minutes, seconds] = timeStr.split(':').map(Number);
    const dateObj = new Date();
    
    if (hours >= 24) { 
        dateObj.setDate(dateObj.getDate() + 1); 
        hours -= 24; 
    }
    
    dateObj.setHours(hours, minutes, seconds, 0);
    return dateObj;
}

/**
 * Retrieves and validates the cache duration from localStorage.
 * @returns {Object|null} The parsed JSON schedule object, or null if empty/expired.
 */
function getCachedSchedule() {
    const cachedData = localStorage.getItem(CACHE_KEY);
    if (!cachedData) return null;
    
    const parsedData = JSON.parse(cachedData);
    // Invalidate cache if older than defined CACHE_DURATION
    if (Date.now() - parsedData.timestamp > CACHE_DURATION) return null;
    
    return parsedData.schedule;
}

/**
 * Helper function to retrieve the FeedMessage type.
 * Uses an async "lazy-load" pattern to fetch the schema only when needed,
 * then caches it for all subsequent calls.
 */
async function getGtfsType() {
    if (!GTFS_ROOT) {
        const PROTO_URL = PROXY + "https://raw.githubusercontent.com/google/transit/master/gtfs-realtime/proto/gtfs-realtime.proto";
        
        try {
            const response = await fetch(PROTO_URL, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            if (response.status === 403) {
                // This specific status usually indicates the CORS Anywhere "Demo" access has expired
                showCorsProxyWarning();
               return null;
            }

            if (!response.ok) throw new Error("Failed to fetch Protobuf schema.");
            
            const protoText = await response.text();
            GTFS_ROOT = protobuf.parse(protoText).root;
            
        } catch (e) {
            console.error("Schema Fetch Error:", e);
            throw e; 
        }
    }
    return GTFS_ROOT.lookupType("transit_realtime.FeedMessage");
}

/**
 * Displays a specific warning when the CORS proxy requires manual activation.
 */
function showCorsProxyWarning() {
    const errorBox = document.getElementById('error-box');
    if (errorBox) {
        errorBox.innerHTML = CORS_ERROR_MESSAGE;
        errorBox.style.display = 'block';
    }
}

/**
 * Safely escapes HTML special characters in a string using the browser's DOM.
 * @param {string} str - The raw string containing potential HTML tags or entities.
 * @returns {string} The escaped string safe for insertion into innerHTML.
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
/**
 * Fetches and decodes the GTFS Realtime Protobuf feed.
 */
async function fetchRealTimeData() {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const RT_URL = `${PROXY}https://gtfsapi.translink.ca/v3/gtfsrealtime?apikey=${apiKey}`;

	const errorBox = document.getElementById('error-box');
    try {
        const response = await fetch(RT_URL);
		if (response.status == 403) {
		    showCorsProxyWarning();
	        return null;
        }

        if (!response.ok) {
            if (errorBox) {
		errorBox.innerHTML = `<div class="api-warning">
                    Real-time data is currently unavailable 
                    <a href="index.html">Update your API Key here</a>.
                </div>`;
            }
            return null;
        }

        // TransLink returns binary data (ArrayBuffer), not JSON
        const buffer = await response.arrayBuffer();
        
        // Optimization: Use the cached schema type instead of calling protobuf.load() again
        const feedMessage = await getGtfsType();
        if (!feedMessage) {
            if (errorBox) {
		errorBox.innerHTML = `<div class="api-warning">
                    Real-time data is currently unavailable. Can't download GTFS Types. 
                </div>`;
            }
        }
        
        // Decode the binary buffer into a Protobuf Message object
        const message = feedMessage.decode(new Uint8Array(buffer));
        
        // Convert the Message object into a plain JavaScript object for easier manipulation
        // We convert Enums and Longs to Strings to avoid precision issues and simplify matching
        const object = feedMessage.toObject(message, { enums: String, longs: String });

        return object.entity || [];
    } catch (e) {
        console.error("Protobuf Error:", e);
        if (errorBox) {
            let message = escapeHTML(e);
            errorBox.innerHTML = `<div class="api-warning">
                Real-time data is currently unavailable: ${message}. 
            </div>`;
        }
        return null;
    }
}

/**
 * Saves the API key to a cookie valid for 365 days.
 * @param {string} key - TransLink API Key.
 */
function saveApiKey(key) {
    const d = new Date();
    d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
    document.cookie = `translink_api_key=${key};expires=${d.toUTCString()};path=/;Secure;SameSite=Strict`;
}

/**
 * Gets the API key from the cookie.
 */
function getApiKey() {
    const name = "translink_api_key=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i].trim();
        if (c.indexOf(name) == 0) return c.substring(name.length, c.length);
    }
    return "";
}